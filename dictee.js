/* Suivi désherbage — dictée vocale.
   1) La voix est transformée en texte par le navigateur (Chrome, Edge, Safari ; pas Firefox).
   2) Le texte est analysé ICI, sur l'appareil : rues, date, état constaté, équipe.
   3) Rien n'est enregistré sans confirmation. */
'use strict';

/* ================= Moteur de reconnaissance (sans interface) ================= */
const Dictee = (() => {
  const TYPES = { rue: 'rue', impasse: 'impasse', avenue: 'avenue', av: 'avenue', boulevard: 'boulevard', bd: 'boulevard', bld: 'boulevard',
    chemin: 'chemin', place: 'place', route: 'route', rond: 'rond', cheminement: 'cheminement', allee: 'allee', allees: 'allee', square: 'square' };
  const VIDES = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'l', 'd', 'et', 'au', 'aux', 'point']);
  const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/œ/g, 'oe').replace(/[^a-z0-9]+/g, ' ').trim();

  // clé "phonétique" simple pour tolérer les erreurs de la reconnaissance vocale
  function phon(w) {
    let s = w.replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/gu([ei])/g, 'g$1').replace(/c([eiy])/g, 's$1').replace(/c/g, 'k')
      .replace(/(eau|au|o)/g, 'o').replace(/(ai|ei|ey|ay|et$|er$|ez$)/g, 'e').replace(/y/g, 'i').replace(/h/g, '')
      .replace(/(.)\1+/g, '$1');
    while (s.length > 3 && /[estxzd]$/.test(s)) s = s.slice(0, -1);
    return s;
  }
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function proche(t, w) {
    if (t === w) return true;
    if (w.length < 4 || t.length < 3) return false;
    if (t[0] !== w[0]) return false;
    const d = lev(t, w);
    if (w.length >= 5 && d <= 1) return true;
    if (w.length >= 8 && d <= 2) return true;
    const pt = phon(t), pw = phon(w);
    return pt.length >= 3 && (pt === pw || (pw.length >= 5 && lev(pt, pw) <= 1));
  }
  // cherche le mot w dans les jetons T (aussi en recollant 2 ou 3 jetons : « nègre neys »)
  function trouver(T, w, depuis = 0) {
    for (let i = depuis; i < T.length; i++) if (proche(T[i], w)) return [i];
    // « dagonne », « larcachon » : l'apostrophe a été avalée par la dictée
    for (let i = depuis; i < T.length; i++) if (T[i].length >= 5 && /^[dl]/.test(T[i]) && proche(T[i].slice(1), w)) return [i];
    for (let i = depuis; i < T.length - 1; i++) if (proche(T[i] + T[i + 1], w)) return [i, i + 1];
    for (let i = depuis; i < T.length - 2; i++) if (proche(T[i] + T[i + 1] + T[i + 2], w)) return [i, i + 1, i + 2];
    return null;
  }

  let index = null, indexPour = null;
  function indexer(rues) {
    if (indexPour === rues) return index;
    index = rues.map(rue => {
      const toks = norm(rue.voie).split(' ');
      const type = TYPES[toks[0]] || null;
      const noms = toks.slice(type ? 1 : 0).filter(t => !VIDES.has(t) && !/^\d+$/.test(t));
      return { rue, type, noms, motdir: norm(rue.motdir) || noms[noms.length - 1] };
    });
    indexPour = rues;
    return index;
  }

  function segmenter(texte) {
    const segs = [];
    String(texte || '').split(/[,;.\n]+/).forEach(morceau => {
      let n = ' ' + norm(morceau) + ' ';
      n = n.replace(/ (rue|impasse|avenue|av|boulevard|bd|bld|chemin|place|route|rond|cheminement|allee|allees|square) /g, ' | $1 ');
      n = n.replace(/ (puis|ensuite|apres|aussi) /g, ' | ');
      n.split('|').forEach(s => { const T = s.trim().split(' ').filter(Boolean); if (T.length) segs.push(T); });
    });
    return segs;
  }

  function analyserSegment(T, idx) {
    const typeDit = TYPES[T[0]] || null;
    const hits = [];
    for (const e of idx) {
      const m = trouver(T, e.motdir); if (!m) continue;
      const used = new Set(m); let score = 3 + (m.length === 1 && T[m[0]] === e.motdir ? 1 : 0);
      for (const w of e.noms) {
        if (w === e.motdir) continue;
        const mm = trouver(T, w); if (mm) { score += 1; mm.forEach(i => used.add(i)); }
      }
      if (typeDit) score += typeDit === e.type ? 2 : -1;
      hits.push({ e, score, used });
    }
    // meilleur candidat par MOTDIR
    const parMot = new Map();
    for (const h of hits) { if (!parMot.has(h.e.motdir)) parMot.set(h.e.motdir, []); parMot.get(h.e.motdir).push(h); }
    let groupes = [...parMot.values()].map(liste => {
      const best = Math.max(...liste.map(h => h.score));
      const top = liste.filter(h => h.score === best);
      const used = new Set(top.flatMap(h => [...h.used]));
      const memeVoie = top.every(h => h.e.rue.voie === top[0].e.rue.voie);
      return { top, used, best, sur: memeVoie };
    });
    // une rue dont les mots sont inclus dans ceux d'une autre est écartée (ex. « Cordeau » dans « rue Cordeau Dany »)
    groupes = groupes.filter(g => !groupes.some(o => o !== g && [...g.used].every(i => o.used.has(i)) && (o.used.size > g.used.size ? o.best >= g.best : o.best > g.best)));
    return groupes;
  }

  function lireDate(texte, today) {
    const n = ' ' + norm(texte) + ' ';
    const ajout = (s, k) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + k)); return d.toISOString().slice(0, 10); };
    if (/ avant hier /.test(n)) return ajout(today, -2);
    if (/ hier /.test(n)) return ajout(today, -1);
    let m = n.match(new RegExp(` (\\d{1,2}|1er|premier) (${MOIS.join('|')})(?: (\\d{4}))? `));
    if (m) {
      const j = /^\d+$/.test(m[1]) ? +m[1] : 1, mo = MOIS.indexOf(m[2]) + 1;
      let y = m[3] ? +m[3] : +today.slice(0, 4);
      let s = `${y}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
      if (!m[3] && s > today) s = `${y - 1}${s.slice(4)}`;
      if (j >= 1 && j <= 31) return s;
    }
    m = String(texte).match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m) {
      let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +today.slice(0, 4);
      let s = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      if (!m[3] && s > today) s = `${y - 1}${s.slice(4)}`;
      if (+m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) return s;
    }
    for (let k = 0; k < 7; k++) {
      const d = ajout(today, -k);
      const nomJour = JOURS[new Date(d + 'T12:00:00Z').getUTCDay()];
      if (n.includes(' ' + nomJour + ' ')) return d;
    }
    return null;
  }
  function lireEtat(texte) {
    const n = ' ' + norm(texte) + ' ';
    if (/ beaucoup /.test(n) || / plein /.test(n) || / envahi/.test(n)) return 'beaucoup';
    if (/ un peu /.test(n) || / peu d herbe /.test(n) || / quelques /.test(n)) return 'peu';
    if (/ propre /.test(n) || / rien /.test(n)) return 'propre';
    return null;
  }
  function lireEquipe(texte) {
    const m = String(texte).match(/[ée]quipe\s+([\p{L}\d]+)/iu);
    if (!m) return null;
    const v = m[1].length === 1 ? m[1].toUpperCase() : m[1];
    return 'Équipe ' + v;
  }

  // analyse complète
  function analyser(texte, rues, today) {
    const idx = indexer(rues);
    const surs = new Map(), ambigus = [], nonTrouves = [];
    const motsIgnores = new Set(['aujourd', 'hui', 'hier', 'avant', 'ce', 'matin', 'soir', 'apres', 'midi', 'equipe', 'on', 'a', 'fait', 'faits', 'passage', 'passe',
      'beaucoup', 'herbe', 'un', 'peu', 'propre', 'presque', 'et', 'de', 'la', 'le', 'les', 'des', 'du', 'd', 'l', 'en', 'il', 'y', 'avait', 'c', 'etait', 'tres', 'pas', 'mal', 'rien', 'plein',
      ...MOIS, ...JOURS]);
    for (const T of segmenter(texte)) {
      const groupes = analyserSegment(T, idx);
      if (!groupes.length) {
        const reste = T.filter((t, i) => !motsIgnores.has(t) && !/^\d+$/.test(t) && t.length > 1 && T[i - 1] !== 'equipe' && !(TYPES[t] && T.length === 1));
        const equipeSeule = T[0] === 'equipe';
        if (reste.length && !equipeSeule) nonTrouves.push(T.join(' '));
        continue;
      }
      for (const g of groupes) {
        if (g.sur) g.top.forEach(h => surs.set(h.e.rue.id, h.e.rue));
        else ambigus.push(g.top.map(h => h.e.rue));
      }
    }
    // une ambiguïté déjà résolue ailleurs dans la phrase est retirée
    const amb = ambigus.filter(l => !l.some(r => surs.has(r.id)));
    return { rues: [...surs.values()], ambigus: amb, nonTrouves, date: lireDate(texte, today), etat: lireEtat(texte), equipe: lireEquipe(texte) };
  }

  return { analyser, norm, phon, segmenter };
})();
if (typeof module !== 'undefined') module.exports = Dictee;

/* ================= Interface ================= */
if (typeof document !== 'undefined' && document.getElementById('dlgDictee')) (() => {
  const $ = s => document.querySelector(s);
  const dlg = $('#dlgDictee'), zone = $('#dictTexte'), btn = $('#micBtn');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, ecoute = false, base = '';
  let res = null;
  const choix = new Map();            // id rue -> coché ou non (choix manuels)
  const champs = { date: null, equipe: null, etat: null, touche: {} };

  function majFab() {
    const fab = $('#fabDictee');
    // caché dans Réglages, et remplacé par la barre de sélection quand des rues sont cochées
    fab.hidden = onglet === 'reglages' || !$('#selbar').hidden;
  }
  // l'appli redessine souvent : on observe les changements pour placer le bouton
  new MutationObserver(majFab).observe($('#selbar'), { attributes: true });
  document.querySelector('nav.tabs').addEventListener('click', () => setTimeout(majFab));

  function ouvrir() {
    zone.value = ''; base = ''; res = null; choix.clear();
    champs.date = null; champs.equipe = null; champs.etat = null; champs.touche = {};
    $('#micAide').textContent = SR
      ? 'Appuie sur « Parler », dicte la date, l\'équipe, les rues et l\'état constaté, puis vérifie la liste avant d\'enregistrer.'
      : 'Ce navigateur ne fait pas la dictée (c\'est le cas de Firefox). Utilise le micro du clavier de ton téléphone dans la zone ci-dessous, ou ouvre l\'appli dans Chrome ou Edge. Tu peux aussi taper les rues.';
    btn.hidden = !SR;
    $('#micEtat').textContent = '';
    analyser();
    dlg.showModal();
    if (!SR) zone.focus();
  }
  function fermer() { arreter(); dlg.close(); }

  function demarrer() {
    if (!SR || ecoute) return;
    rec = new SR();
    rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = true;
    base = zone.value ? zone.value.replace(/\s*$/, ', ') : '';
    rec.onresult = e => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + (e.results[i].isFinal ? ', ' : ' ');
      zone.value = (base + t).replace(/,\s*$/, '');
      analyser();
    };
    rec.onerror = e => {
      const msg = { 'not-allowed': 'Micro refusé : autorise le micro pour ce site.', 'no-speech': 'Je n\'ai rien entendu.', 'network': 'Dictée indisponible sans réseau.', 'audio-capture': 'Aucun micro détecté.' };
      $('#micEtat').textContent = msg[e.error] || ('Erreur : ' + e.error);
    };
    rec.onend = () => { ecoute = false; btn.classList.remove('ecoute'); $('#micLabel').textContent = 'Parler'; if (!$('#micEtat').textContent.startsWith('Micro') && !$('#micEtat').textContent.startsWith('Erreur') && !$('#micEtat').textContent.startsWith('Je')) $('#micEtat').textContent = ''; };
    try { rec.start(); } catch { return; }
    ecoute = true; btn.classList.add('ecoute'); $('#micLabel').textContent = 'Stop'; $('#micEtat').textContent = 'J\'écoute…';
  }
  function arreter() { if (rec && ecoute) { try { rec.stop(); } catch {} } }

  function analyser() {
    const rues = secteur()?.rues || [];
    res = Dictee.analyser(zone.value, rues, aujourdhui());
    if (!champs.touche.date) champs.date = res.date || aujourdhui();
    if (!champs.touche.equipe) champs.equipe = res.equipe ?? (champs.equipe ?? state.equipe ?? '');
    if (!champs.touche.etat) champs.etat = res.etat ?? '';
    afficher();
  }
  const coche = (id, defaut) => choix.has(id) ? choix.get(id) : defaut;
  function idsRetenus() {
    if (!res) return [];
    const ids = res.rues.filter(r => coche(r.id, true)).map(r => r.id);
    res.ambigus.forEach(l => l.forEach(r => { if (coche(r.id, false) && !ids.includes(r.id)) ids.push(r.id); }));
    return ids;
  }
  function ligne(r, defaut) {
    const s = statutRue(r);
    const info = s.dernier ? `dernier passage ${fmtDateCourt(s.dernier.date)}` : 'jamais saisie';
    return `<label class="dict-item"><input type="checkbox" data-dr="${r.id}" ${coche(r.id, defaut) ? 'checked' : ''}>
      <span class="grow"><strong>${esc(r.voie)}</strong>${r.troncon ? ` <span class="muted small">(${esc(r.troncon)})</span>` : ''}
      <br><span class="muted small">Classe ${r.classe} · ${r.longueur ? r.longueur + ' m · ' : ''}${info}</span></span></label>`;
  }
  function afficher() {
    const out = $('#dictResultat');
    if (!zone.value.trim()) { out.innerHTML = ''; $('#dictOk').disabled = true; $('#dictOk').textContent = 'Enregistrer'; return; }
    let h = `<div class="form-grid dict-sec">
      <label class="f">Date du passage<input type="date" id="ddDate" value="${esc(champs.date)}" max="${aujourdhui()}"></label>
      <label class="f">Équipe / agents<input type="text" id="ddEquipe" value="${esc(champs.equipe)}" autocomplete="off"></label>
      <label class="f">État constaté<select id="ddEtat">
        <option value="" ${!champs.etat ? 'selected' : ''}>Non renseigné</option>
        ${Object.entries(ETATS).map(([k, v]) => `<option value="${k}" ${champs.etat === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select></label></div>`;
    h += `<div class="dict-sec"><h4>Rues reconnues (${res.rues.length})</h4>${res.rues.length ? res.rues.map(r => ligne(r, true)).join('') : '<p class="muted small">Aucune pour l\'instant.</p>'}</div>`;
    if (res.ambigus.length) {
      h += `<div class="dict-sec"><h4>À préciser (${res.ambigus.length})</h4>${res.ambigus.map(l => `<div class="dict-ambi"><p>Plusieurs voies possibles : coche la bonne</p>${l.map(r => ligne(r, false)).join('')}</div>`).join('')}</div>`;
    }
    if (res.nonTrouves.length) {
      h += `<div class="dict-sec"><h4>Pas compris</h4>${res.nonTrouves.map(t => `<div class="dict-non">« ${esc(t)} »</div>`).join('')}
        <p class="muted small">Corrige le texte ci-dessus (orthographe du nom de la rue) : la liste se met à jour toute seule.</p></div>`;
    }
    out.innerHTML = h;
    const n = idsRetenus().length;
    $('#dictOk').disabled = n === 0;
    $('#dictOk').textContent = n ? `Enregistrer ${n} passage${n > 1 ? 's' : ''}` : 'Enregistrer';
  }

  $('#fabDictee').addEventListener('click', ouvrir);
  $('#dictClose').addEventListener('click', fermer);
  $('#dictAnnuler').addEventListener('click', fermer);
  dlg.addEventListener('close', arreter);
  btn.addEventListener('click', () => ecoute ? arreter() : demarrer());
  let t = null;
  zone.addEventListener('input', () => { clearTimeout(t); t = setTimeout(analyser, 250); });
  $('#dictResultat').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.dr) { choix.set(el.dataset.dr, el.checked); afficher(); return; }
    if (el.id === 'ddDate') { champs.date = el.value; champs.touche.date = true; }
    if (el.id === 'ddEtat') { champs.etat = el.value; champs.touche.etat = true; }
  });
  $('#dictResultat').addEventListener('input', e => { if (e.target.id === 'ddEquipe') { champs.equipe = e.target.value; champs.touche.equipe = true; } });

  $('#dictOk').addEventListener('click', () => {
    const ids = idsRetenus(); if (!ids.length) return;
    const date = champs.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date > aujourdhui()) { toast('Date invalide (pas de date future).'); return; }
    const creeLe = Date.now();
    ids.forEach(rueId => state.passages.push({ id: uid(), rueId, date, etat: champs.etat || '', equipe: (champs.equipe || '').trim(), remarque: '', auteur: state.auteur || '', creeLe, source: 'dictee' }));
    if (champs.equipe) state.equipe = champs.equipe.trim();
    persist(); invalider();
    fermer();
    toast(`${ids.length} passage${ids.length > 1 ? 's' : ''} enregistré${ids.length > 1 ? 's' : ''} (${fmtDateCourt(date)}).`);
    if (besoinArchive()) majMeteo();
    rendre();
  });

  majFab();
})();
