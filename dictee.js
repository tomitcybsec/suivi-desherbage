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

  // sens : 'passe' (saisie d'un passage), 'futur' (planning), 'auto' (date explicite la plus proche d'aujourd'hui)
  function lireDate(texte, today, sens = 'passe') {
    const n = ' ' + norm(texte) + ' ';
    const ajout = (s, k) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + k)); return d.toISOString().slice(0, 10); };
    const ecart = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
    const choisir = (s, y) => { // s = date avec l'année courante
      const avant = `${y - 1}${s.slice(4)}`, apres = `${y + 1}${s.slice(4)}`;
      if (sens === 'futur') return s >= today ? s : apres;
      if (sens === 'passe') return s <= today ? s : avant;
      return [avant, s, apres].sort((u, v) => ecart(u, today) - ecart(v, today))[0];
    };
    if (/ aujourd hui /.test(n)) return today;
    if (/ apres demain /.test(n)) return ajout(today, 2);
    if (/ demain /.test(n)) return ajout(today, 1);
    if (/ avant hier /.test(n)) return ajout(today, -2);
    if (/ hier /.test(n)) return ajout(today, -1);
    let m = n.match(new RegExp(` (\\d{1,2}|1er|premier) (${MOIS.join('|')})(?: (\\d{4}))? `));
    if (m) {
      const j = /^\d+$/.test(m[1]) ? +m[1] : 1, mo = MOIS.indexOf(m[2]) + 1;
      const y = +today.slice(0, 4);
      const s = `${m[3] || y}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
      if (j >= 1 && j <= 31) return m[3] ? s : choisir(s, y);
    }
    m = String(texte).match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) {
      const y = +today.slice(0, 4);
      const yy = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : y;
      const s = `${yy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return m[3] ? s : choisir(s, y);
    }
    const futurJour = sens === 'futur' || / prochain/.test(n);
    for (let k = futurJour ? 1 : 0; futurJour ? k <= 7 : k < 7; k++) {
      const d = ajout(today, futurJour ? k : -k);
      const nomJour = JOURS[new Date(d + 'T12:00:00Z').getUTCDay()];
      if (n.includes(' ' + nomJour + ' ')) return d;
    }
    return null;
  }
  // ce que la phrase demande : planifier, valider une intervention prévue, la reporter, l'annuler
  function lireIntention(texte) {
    const n = ' ' + norm(texte) + ' ';
    if (/ annul/.test(n)) return 'annuler';
    if (/ report| decal/.test(n)) return 'reporter';
    if (/ c est fait | cest fait | (est |c est )?(termine|terminee|fini|finie|realise|realisee) | fait /.test(n)) return 'valider';
    if (/ (je )?prevoi| prevu| prevoir| planifi| programm| on fera | il faudra | a faire /.test(n)) return 'planifier';
    return null;
  }
  const TYPES_INTER = [
    { re: / coordonn/, type: 'Coordonné balayeuse' },
    { re: / pompage| pomper| pompe /, type: 'Pompage de feuilles' },
    { re: / rotofil| roto fil| desherb| debroussaill/, type: 'Rotofil herbe' },
    { re: / balayage manuel| balayage /, type: 'Balayage manuel' },
    { re: / incident| urgence| voiture brulee/, type: 'Incident / urgence' },
  ];
  function lireType(texte) {
    const n = ' ' + norm(texte) + ' ';
    for (const t of TYPES_INTER) if (t.re.test(n)) return t.type;
    return null;
  }
  const ROLES = [
    { motifs: ['micro balayeuse', 'microbalayeuse'], role: 'micro-balayeuse', mat: 'micro-balayeuse' },
    { motifs: ['balayeuse'], role: 'balayeuse', mat: 'balayeuse' },
    { motifs: ['rotofil', 'roto fil', 'debroussailleuse'], role: 'rotofil', mat: 'rotofil' },
    { motifs: ['souffleur', 'souffleuse', 'soufflage'], role: 'souffleur à dos', mat: 'souffleur à dos' },
    { motifs: ['chauffeur'], role: 'chauffeur', mat: null },
    { motifs: ['camion'], role: 'camion', mat: 'camion' },
    { motifs: ['pompe', 'pompage'], role: 'pompe', mat: 'gros camion' },
    { motifs: ['balai', 'balayage manuel'], role: 'balayage manuel', mat: 'balayage manuel' },
  ];
  // prénoms connus (annuaire local) + rôle dit juste après : « Michel au rotofil, Pascal en balayeuse »
  function lireAgents(texte, annuaire = []) {
    const T = norm(texte).split(' ').filter(Boolean), out = [];
    const cles = annuaire.map(a => ({ ...a, toks: a.cle.split(' ') }));
    const estAgent = (i) => cles.filter(a => {
      const bout = T.slice(i, i + a.toks.length).join(' ');
      if (bout === a.cle) return true;
      return a.toks.length === 1 && a.cle.length >= 5 && T[i] && T[i][0] === a.cle[0] && lev(T[i], a.cle) <= 1;
    });
    for (let i = 0; i < T.length; i++) {
      if (i > 0 && TYPES[T[i - 1]]) continue; // « rue Pierre Cazeneuve » : Pierre est un nom de rue, pas un agent
      const c = estAgent(i); if (!c.length) continue;
      let nom = c[0].prenom, saut = c[0].toks.length - 1;
      const suite = ' ' + T.slice(i + c[0].toks.length, i + c[0].toks.length + 3).join(' ') + ' ';
      const avecNom = c.find(x => x.nomFam && suite.startsWith(' ' + norm(x.nomFam) + ' '));
      if (avecNom) { nom = avecNom.complet; saut += norm(avecNom.nomFam).split(' ').length; }
      const fen = [];
      for (let j = i + saut + 1; j < Math.min(T.length, i + saut + 6); j++) { if (estAgent(j).length) break; fen.push(T[j]); }
      const f = ' ' + fen.join(' ') + ' ';
      const r = ROLES.find(r => r.motifs.some(m => f.includes(' ' + m)));
      if (!out.some(o => o.nom === nom)) out.push({ nom, role: r ? r.role : null, mat: r ? r.mat : null });
      i += saut;
    }
    return out;
  }
  const formatAgents = ags => ags.map(a => a.role ? `${a.nom} (${a.role})` : a.nom).join(', ');
  function materiel(ags) {
    const n = {};
    ags.forEach(a => { if (a.mat) n[a.mat] = (n[a.mat] || 0) + 1; });
    const l = Object.entries(n).map(([m, k]) => k > 1 ? `${k} ${m.replace(/^(\S+)/, '$1s')}` : m).join(', ');
    return l ? l[0].toUpperCase() + l.slice(1) : '';
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
  function analyser(texte, rues, today, opts = {}) {
    const idx = indexer(rues);
    const n0 = ' ' + norm(texte) + ' ';
    const zones = (opts.zones || []).filter(z => z.motifs.some(m => n0.includes(norm(m)))).map(z => z.nom);
    for (const a of opts.alias || []) if (a.motifs.some(m => n0.includes(' ' + norm(m) + ' '))) texte += ', ' + a.voie;
    const surs = new Map(), ambigus = [], nonTrouves = [];
    const motsIgnores = new Set(['aujourd', 'hui', 'hier', 'avant', 'ce', 'matin', 'soir', 'apres', 'midi', 'equipe', 'on', 'a', 'fait', 'faits', 'passage', 'passe',
      'beaucoup', 'herbe', 'un', 'peu', 'propre', 'presque', 'et', 'de', 'la', 'le', 'les', 'des', 'du', 'd', 'l', 'en', 'il', 'y', 'avait', 'c', 'etait', 'tres', 'pas', 'mal', 'rien', 'plein',
      ...MOIS, ...JOURS, 'demain', 'prochain', 'prochaine', 'semaine', 'je', 'prevois', 'prevoit', 'prevu', 'prevue', 'prevoir', 'planifie', 'sur', 'avec', 'pour', 'au', 'aux',
      'rotofil', 'souffleur', 'souffleurs', 'balayeuse', 'micro', 'camion', 'camions', 'chauffeur', 'pompage', 'pompe', 'coordonne', 'balayage', 'manuel', 'est', 'termine', 'fini', 'reporte', 'annule', 'decale',
      ...(opts.ignorer || [])]);
    const connus = [...(opts.zones || []).flatMap(z => z.motifs), ...(opts.alias || []).flatMap(a => a.motifs)].map(norm);
    // mots qui ne peuvent pas être des noms de rue (jours, mois, matériel, verbes) : écartés avant la recherche,
    // sinon « mardi » ressemble à « Marty » et « coordonné » à « Cordeau »
    const STOP = new Set([...JOURS, ...MOIS, 'coordonne', 'coordonnee', 'rotofil', 'balayeuse', 'souffleur', 'souffleurs', 'pompage', 'pompe', 'balayage',
      'prevois', 'prevoit', 'prevu', 'prevue', 'prevoir', 'planifie', 'demain', 'prochain', 'prochaine', 'fait', 'termine', 'reporte', 'annule', 'decale', 'chauffeur', 'camion', ...(opts.ignorer || [])]);
    for (const T0 of segmenter(texte)) {
      const T = T0.filter(t => !STOP.has(t));
      if (!T.length) continue;
      const groupes = analyserSegment(T, idx);
      if (!groupes.length) {
        const reste = T.filter((t, i) => !motsIgnores.has(t) && !/^\d+$/.test(t) && t.length > 1 && T[i - 1] !== 'equipe' && !(TYPES[t] && T.length === 1));
        const equipeSeule = T[0] === 'equipe';
        const deZone = connus.some(m => T.join(' ').includes(m) || m.includes(T.join(' ')));
        if (reste.length && !equipeSeule && !deZone) nonTrouves.push(T.join(' '));
        continue;
      }
      for (const g of groupes) {
        if (g.sur) g.top.forEach(h => surs.set(h.e.rue.id, h.e.rue));
        else ambigus.push(g.top.map(h => h.e.rue));
      }
    }
    // une ambiguïté déjà résolue ailleurs dans la phrase est retirée
    const amb = ambigus.filter(l => !l.some(r => surs.has(r.id)));
    return { rues: [...surs.values()], ambigus: amb, nonTrouves, zones, date: lireDate(texte, today, opts.sens || 'passe'), etat: lireEtat(texte), equipe: lireEquipe(texte) };
  }

  return { analyser, norm, phon, segmenter, lireDate, lireIntention, lireType, lireAgents, formatAgents, materiel, lireEtat };
})();
if (typeof module !== 'undefined') module.exports = Dictee;

/* ================= Interface ================= */
if (typeof document !== 'undefined' && document.getElementById('dlgDictee')) (() => {
  const $ = s => document.querySelector(s);
  const dlg = $('#dlgDictee'), zone = $('#dictTexte'), btn = $('#micBtn');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let res = null;
  const choix = new Map();            // id rue -> coché ou non (choix manuels)
  const champs = { mode: 'passage', date: null, equipe: null, etat: null, type: '', agents: '', materiel: '', observations: '', touche: {} };
  const choixPlan = new Map();        // id intervention prévue -> cochée ou non (mode Valider)
  const MODES = { passage: 'Passage fait', planifier: 'Planifier', valider: 'Valider un prévu' };
  const TYPES_LISTE = ['Rotofil herbe', 'Coordonné balayeuse', 'Pompage de feuilles', 'Balayage manuel', 'Incident / urgence', 'Autre'];

  function majFab() {
    const fab = $('#fabDictee');
    // caché dans Réglages, et remplacé par la barre de sélection quand des rues sont cochées
    fab.hidden = onglet === 'reglages' || !$('#selbar').hidden;
  }
  // l'appli redessine souvent : on observe les changements pour placer le bouton
  new MutationObserver(majFab).observe($('#selbar'), { attributes: true });
  document.querySelector('nav.tabs').addEventListener('click', () => setTimeout(majFab));

  function ouvrir(mode) {
    zone.value = ''; res = null; choix.clear(); choixPlan.clear(); direct(''); etat('');
    Object.assign(champs, { mode: 'passage', date: null, equipe: null, etat: null, type: '', agents: '', materiel: '', observations: '', touche: {} });
    if (typeof mode === 'string' && MODES[mode]) { champs.mode = mode; champs.touche.mode = true; }
    $('#micAide').textContent = SR
      ? 'Dicte un passage fait (« hier, rue de Tunis, beaucoup d\'herbe »), une intervention à prévoir (« mardi, je prévois rotofil rue Baque, Michel au rotofil ») ou une validation (« rotofil rue Baque, c\'est fait »). Le micro reste ouvert jusqu\'à « Stop ».'
      : 'Ce navigateur ne fait pas la dictée (c\'est le cas de Firefox). Utilise le micro du clavier de ton téléphone dans la zone ci-dessous, ou ouvre l\'appli dans Chrome ou Edge. Tu peux aussi taper les rues.';
    btn.hidden = !SR; $('#micUndo').hidden = !SR;
    $('#micEtat').textContent = '';
    analyser();
    dlg.showModal();
    if (!SR) zone.focus();
  }
  function fermer() { arreter(); dlg.close(); }

  /* ---------- Reconnaissance vocale « robuste » ----------
     Problèmes connus des navigateurs (surtout Chrome sur Android) :
     - le micro se coupe tout seul au moindre silence ou quand il ne comprend pas ;
     - en mode continu, la même phrase revient plusieurs fois (phrases cumulées).
     Corrections : redémarrage automatique tant qu'on n'a pas appuyé sur « Stop »,
     suppression des répétitions, texte provisoire affiché à part, arrêt après un long silence. */
  const SILENCE_MAX = 30000;
  let veutEcouter = false, dernierSon = 0, dernierCommis = '', nbSegments = 0, veille = null;
  const nz = s => Dictee.norm(s);
  const etat = t => { $('#micEtat').textContent = t; };
  const direct = t => { const d = $('#micDirect'); d.textContent = t ? '… ' + t : ''; };
  const mots = s => s.trim().split(/\s+/).filter(Boolean);

  // supprime les répétitions et ne garde que la version la plus complète d'une phrase cumulée
  function fusionner(phrases, depart = '') {
    const out = [], nd = nz(depart);
    for (const brut of phrases) {
      let f = brut.trim(); if (!f) continue;
      const prev = out.length ? out[out.length - 1] : dernierCommis;
      const nf = nz(f), np = nz(prev);
      if (!out.length && nd && nd.endsWith(nf)) continue; // déjà à la fin du texte (répétition après redémarrage)
      if (np) {
        if (nf === np || np.endsWith(nf)) continue;
        if (nf.startsWith(np)) {
          if (out.length) { out[out.length - 1] = f; continue; }
          f = mots(f).slice(mots(prev).length).join(' ');
          if (!f) continue;
        }
      }
      out.push(f);
    }
    return out;
  }
  const joindre = (debut, segs) => [debut.trim().replace(/[,\s]+$/, ''), ...segs].filter(Boolean).join(', ');

  function majBouton() {
    btn.classList.toggle('ecoute', veutEcouter);
    $('#micLabel').textContent = veutEcouter ? 'Stop' : 'Parler';
  }

  function session() {
    rec = new SR();
    rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    const depart = zone.value;
    let segs = [];
    rec.onresult = e => {
      dernierSon = Date.now();
      const finals = [], provisoire = [];
      for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? finals : provisoire).push(e.results[i][0].transcript);
      const avant = segs.length;
      segs = fusionner(finals, depart);
      zone.value = joindre(depart, segs);
      direct(provisoire.join(' '));
      if (segs.length > avant && navigator.vibrate) navigator.vibrate(25);
      analyser();
    };
    rec.onerror = e => {
      if (['not-allowed', 'service-not-allowed'].includes(e.error)) { veutEcouter = false; etat('Micro refusé : autorise le micro pour ce site (icône à gauche de l\'adresse).'); }
      else if (e.error === 'audio-capture') { veutEcouter = false; etat('Aucun micro détecté.'); }
      else if (e.error === 'network') { veutEcouter = false; etat('Dictée indisponible sans réseau. Tu peux taper le texte.'); }
      // « no-speech » et « aborted » : on ignore, le micro redémarre tout seul
    };
    rec.onend = () => {
      if (segs.length) dernierCommis = segs[segs.length - 1];
      direct('');
      if (veutEcouter && Date.now() - dernierSon < SILENCE_MAX) {
        setTimeout(() => { if (veutEcouter) { try { session(); } catch { arreter(); } } }, 200);
      } else {
        if (veutEcouter) etat('Micro coupé après 30 s de silence. Appuie sur « Parler » pour continuer.');
        veutEcouter = false; majBouton(); clearInterval(veille);
      }
    };
    rec.start();
  }

  function demarrer() {
    if (!SR || veutEcouter) return;
    veutEcouter = true; dernierSon = Date.now(); dernierCommis = '';
    try { session(); } catch { veutEcouter = false; etat('Impossible de démarrer le micro.'); return; }
    majBouton();
    etat('J\'écoute… Fais des pauses entre les rues, je continue jusqu\'à « Stop ».');
    clearInterval(veille);
    veille = setInterval(() => { if (veutEcouter && Date.now() - dernierSon > SILENCE_MAX) arreter('Micro coupé après 30 s de silence. Appuie sur « Parler » pour continuer.'); }, 1000);
  }
  function arreter(message) {
    const etaitActif = veutEcouter;
    veutEcouter = false; clearInterval(veille); majBouton();
    if (rec) { try { rec.stop(); } catch {} }
    if (etaitActif) etat(message || '');
  }
  // retire la dernière phrase dictée (quand la reconnaissance s'est trompée)
  function annulerDerniere() {
    arreter();
    const parts = zone.value.split(',');
    parts.pop();
    zone.value = parts.join(',').trim();
    dernierCommis = '';
    direct('');
    analyser();
  }

  const P = () => (typeof Planning !== 'undefined' ? Planning : null);
  let cands = [];
  function analyser() {
    const sect = secteur(), rues = sect?.rues || [], today = aujourdhui(), texte = zone.value;
    const intention = Dictee.lireIntention(texte);
    const annu = P() ? P().annuaire() : [];
    const opts = { alias: sect?.alias, zones: sect?.zones, ignorer: P() ? P().motsAgents() : [] };
    // mode deviné, sauf si l'utilisateur l'a choisi
    let mode = champs.mode;
    const dFutur = Dictee.lireDate(texte, today, 'futur'), dAuto = Dictee.lireDate(texte, today, 'auto');
    res = Dictee.analyser(texte, rues, today, { ...opts, sens: intention === 'planifier' ? 'futur' : 'auto' });
    const type = Dictee.lireType(texte);
    const agents = Dictee.lireAgents(texte, annu);
    cands = P() ? P().candidats(res.rues.map(r => r.id), res.zones, type, agents.map(a => a.nom)) : [];
    if (!champs.touche.mode) {
      if (['valider', 'reporter', 'annuler'].includes(intention) && cands.length) mode = 'valider';
      else if (intention === 'planifier' || (dAuto && dAuto > today)) mode = 'planifier';
      else mode = 'passage';
      champs.mode = mode;
    }
    if (!champs.touche.date) {
      if (mode === 'planifier') champs.date = (intention === 'planifier' ? dFutur : dAuto) || addJours(today, 1);
      else if (mode === 'valider') champs.date = intention === 'reporter' ? (dFutur || addJours(today, 1)) : today;
      else champs.date = res.date && res.date <= today ? res.date : today;
    }
    if (!champs.touche.statut) champs.statut = intention === 'reporter' ? 'reporte' : intention === 'annuler' ? 'annule' : 'realise';
    if (!champs.touche.equipe) champs.equipe = res.equipe ?? (agents.length ? Dictee.formatAgents(agents) : (champs.equipe ?? state.equipe ?? ''));
    if (!champs.touche.etat) champs.etat = res.etat ?? '';
    if (!champs.touche.type) champs.type = type || (champs.type || '');
    if (!champs.touche.agents) champs.agents = Dictee.formatAgents(agents);
    if (!champs.touche.materiel) champs.materiel = Dictee.materiel(agents);
    afficher();
  }
  const coche = (id, defaut) => choix.has(id) ? choix.get(id) : defaut;
  function idsRetenus() {
    if (!res) return [];
    const ids = res.rues.filter(r => coche(r.id, true)).map(r => r.id);
    res.ambigus.forEach(l => l.forEach(r => { if (coche(r.id, false) && !ids.includes(r.id)) ids.push(r.id); }));
    return ids;
  }
  function plansRetenus() {
    const best = cands.length ? cands[0].score : 0;
    return cands.filter(c => choixPlan.has(c.p.id) ? choixPlan.get(c.p.id) : c.score === best).map(c => c.p);
  }
  function ligne(r, defaut) {
    const s = statutRue(r);
    const info = s.dernier ? `dernier passage ${fmtDateCourt(s.dernier.date)}` : 'jamais saisie';
    return `<label class="dict-item"><input type="checkbox" data-dr="${r.id}" ${coche(r.id, defaut) ? 'checked' : ''}>
      <span class="grow"><strong>${esc(r.voie)}</strong>${r.troncon ? ` <span class="muted small">(${esc(r.troncon)})</span>` : ''}
      <br><span class="muted small">Classe ${r.classe} · ${r.longueur ? r.longueur + ' m · ' : ''}${info}</span></span></label>`;
  }
  const selEtat = () => `<label class="f">État de l'herbe<select id="ddEtat">
        <option value="" ${!champs.etat ? 'selected' : ''}>Non renseigné</option>
        ${Object.entries(ETATS).map(([k, v]) => `<option value="${k}" ${champs.etat === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select></label>`;
  function blocRues() {
    let h = `<div class="dict-sec"><h4>Rues reconnues (${res.rues.length})</h4>${res.rues.length ? res.rues.map(r => ligne(r, true)).join('') : '<p class="muted small">Aucune pour l\'instant.</p>'}</div>`;
    if (res.zones && res.zones.length) h += `<p class="small">Zone : <strong>${res.zones.map(esc).join(', ')}</strong> <span class="muted">(suivie, sans prédiction)</span></p>`;
    if (res.ambigus.length) h += `<div class="dict-sec"><h4>À préciser (${res.ambigus.length})</h4>${res.ambigus.map(l => `<div class="dict-ambi"><p>Plusieurs voies possibles : coche la bonne</p>${l.map(r => ligne(r, false)).join('')}</div>`).join('')}</div>`;
    if (res.nonTrouves.length) h += `<div class="dict-sec"><h4>Pas compris</h4>${res.nonTrouves.map(t => `<div class="dict-non">« ${esc(t)} »</div>`).join('')}
        <p class="muted small">Corrige le texte ci-dessus (orthographe du nom de la rue ou du prénom) : la liste se met à jour toute seule.</p></div>`;
    return h;
  }
  function afficher() {
    const out = $('#dictResultat');
    const ok = $('#dictOk');
    if (!zone.value.trim() && champs.mode !== 'planifier') { out.innerHTML = ''; ok.disabled = true; ok.textContent = 'Enregistrer'; return; }
    let h = `<div class="seg dict-sec">${Object.entries(MODES).map(([k, t]) => `<button class="btn${champs.mode === k ? ' primary' : ''}" data-mode="${k}" type="button">${t}</button>`).join('')}</div>`;
    let n = 0, libelle = 'Enregistrer';
    if (champs.mode === 'passage') {
      h += `<div class="form-grid">
        <label class="f">Date du passage<input type="date" id="ddDate" value="${esc(champs.date)}" max="${aujourdhui()}"></label>
        <label class="f">Équipe / agents<input type="text" id="ddEquipe" value="${esc(champs.equipe)}" autocomplete="off"></label>
        ${selEtat()}</div>` + blocRues();
      n = idsRetenus().length; libelle = n ? `Enregistrer ${n} passage${n > 1 ? 's' : ''}` : 'Enregistrer';
    } else if (champs.mode === 'planifier') {
      h += `<div class="form-grid">
        <label class="f">Date prévue<input type="date" id="ddDate" value="${esc(champs.date)}" min="${aujourdhui()}"></label>
        <label class="f">Type<select id="ddType">${TYPES_LISTE.map(t => `<option ${champs.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="f" style="grid-column:1/-1">Agents (et rôle)<input type="text" id="ddAgents" value="${esc(champs.agents)}" placeholder="ex. Michel (rotofil), Pascal (balayeuse)" autocomplete="off"></label>
        <label class="f">Matériel<input type="text" id="ddMateriel" value="${esc(champs.materiel)}" autocomplete="off"></label>
        <label class="f">Observations<input type="text" id="ddObs" value="${esc(champs.observations)}" autocomplete="off"></label></div>` + blocRues();
      n = idsRetenus().length + (res && res.zones ? res.zones.length : 0);
      libelle = n ? `Ajouter au planning (${fmtJour(champs.date)})` : 'Ajouter au planning';
    } else {
      const statuts = { realise: 'Fait', reporte: 'Reporté', annule: 'Annulé' };
      h += `<div class="form-grid">
        <label class="f">Résultat<select id="ddStatut">${Object.entries(statuts).map(([k, t]) => `<option value="${k}" ${champs.statut === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        ${champs.statut === 'annule' ? '' : `<label class="f">${champs.statut === 'reporte' ? 'Nouvelle date' : 'Date de réalisation'}<input type="date" id="ddDate" value="${esc(champs.date)}" ${champs.statut === 'reporte' ? `min="${aujourdhui()}"` : `max="${aujourdhui()}"`}></label>`}
        ${champs.statut === 'realise' ? selEtat() : ''}</div>`;
      if (!cands.length) h += `<div class="notice">Aucune intervention prévue ne correspond à ce que tu as dit. Dis le nom de la rue ou le type (« rotofil rue Baque, c'est fait »), ou passe en <strong>Passage fait</strong>.</div>`;
      else h += `<div class="dict-sec"><h4>Interventions prévues correspondantes</h4>${cands.map(c => {
        const p = c.p, coche2 = choixPlan.has(p.id) ? choixPlan.get(p.id) : c.score === cands[0].score;
        return `<label class="dict-item"><input type="checkbox" data-dp="${p.id}" ${coche2 ? 'checked' : ''}><span class="grow"><strong>${esc(Planning.lieuTexte(p))}</strong>
          <br><span class="muted small">${fmtJour(p.date)} · ${esc(p.type)}${p.agents ? ' · ' + esc(p.agents) : ''}</span></span></label>`;
      }).join('')}</div>`;
      n = plansRetenus().length;
      libelle = n ? `${{ realise: 'Valider', reporte: 'Reporter', annule: 'Annuler' }[champs.statut]} ${n} intervention${n > 1 ? 's' : ''}` : 'Valider';
    }
    out.innerHTML = h;
    ok.disabled = n === 0; ok.textContent = libelle;
  }

  $('#fabDictee').addEventListener('click', () => ouvrir());
  window.ouvrirDictee = ouvrir;
  $('#dictClose').addEventListener('click', fermer);
  $('#dictAnnuler').addEventListener('click', fermer);
  dlg.addEventListener('close', arreter);
  btn.addEventListener('click', () => veutEcouter ? arreter() : demarrer());
  $('#micUndo').addEventListener('click', annulerDerniere);
  zone.addEventListener('focus', () => { if (veutEcouter) arreter('Dictée en pause pendant que tu corriges le texte.'); });
  let t = null;
  zone.addEventListener('input', () => { clearTimeout(t); t = setTimeout(analyser, 250); });
  $('#dictResultat').addEventListener('click', e => {
    const m = e.target.closest('[data-mode]'); if (!m) return;
    champs.mode = m.dataset.mode; champs.touche.mode = true; champs.touche.date = false; analyser();
  });
  $('#dictResultat').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.dr) { choix.set(el.dataset.dr, el.checked); afficher(); return; }
    if (el.dataset.dp) { choixPlan.set(el.dataset.dp, el.checked); afficher(); return; }
    if (el.id === 'ddDate') { champs.date = el.value; champs.touche.date = true; afficher(); }
    if (el.id === 'ddEtat') { champs.etat = el.value; champs.touche.etat = true; }
    if (el.id === 'ddType') { champs.type = el.value; champs.touche.type = true; }
    if (el.id === 'ddStatut') { champs.statut = el.value; champs.touche.statut = true; champs.touche.date = false; analyser(); }
  });
  $('#dictResultat').addEventListener('input', e => {
    const id = e.target.id, v = e.target.value;
    if (id === 'ddEquipe') { champs.equipe = v; champs.touche.equipe = true; }
    if (id === 'ddAgents') { champs.agents = v; champs.touche.agents = true; }
    if (id === 'ddMateriel') { champs.materiel = v; champs.touche.materiel = true; }
    if (id === 'ddObs') { champs.observations = v; champs.touche.observations = true; }
  });

  $('#dictOk').addEventListener('click', () => {
    const date = champs.date, today = aujourdhui();
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date || '');
    if (champs.mode === 'planifier') {
      const ids = idsRetenus(), zones = res?.zones || [];
      if (!ids.length && !zones.length) return;
      if (!dateOk || date < today) { toast('Date prévue invalide (aujourd\'hui ou plus tard).'); return; }
      Planning.ajouter({ date, type: champs.type || 'Autre', rueIds: ids, zones, agents: champs.agents.trim(), materiel: champs.materiel.trim(), intervention: '', observations: champs.observations.trim() });
      fermer(); toast(`Ajouté au planning : ${fmtJour(date)}.`); return;
    }
    if (champs.mode === 'valider') {
      const plans = plansRetenus(); if (!plans.length) return;
      if (champs.statut === 'realise') {
        if (!dateOk || date > today) { toast('Date de réalisation invalide (pas de date future).'); return; }
        plans.forEach(p => Planning.valider(p.id, champs.etat, date));
        toast(`${plans.length} intervention${plans.length > 1 ? 's' : ''} validée${plans.length > 1 ? 's' : ''}.`);
      } else if (champs.statut === 'reporte') {
        if (!dateOk || date < today) { toast('Nouvelle date invalide.'); return; }
        plans.forEach(p => Planning.reporter(p.id, date));
        toast(`Reporté au ${fmtJour(date)}.`);
      } else {
        plans.forEach(p => Planning.annuler(p.id));
        toast('Annulé.');
      }
      fermer(); return;
    }
    const ids = idsRetenus(); if (!ids.length) return;
    if (!dateOk || date > today) { toast('Date invalide (pas de date future).'); return; }
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
