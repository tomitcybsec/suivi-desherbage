/* Suivi désherbage — planning (interventions prévues, puis validées).
   - On prévoit à la voix (ou en tapant) dans la fenêtre « Dicter », mode « Planifier ».
   - Le jour J : « c'est fait », « reporté », « annulé » à la voix, ou boutons Fait / Reporter / Annuler.
   - Un rotofil validé nourrit la prédiction de repousse.
   - « Copier pour mon tableau » : lignes au format exact du tableau Excel, à coller dedans.
   Tout reste enregistré sur l'appareil. */
'use strict';

const Planning = (() => {
  state.planning = state.planning || [];
  state.agentsManuels = state.agentsManuels || '';
  const N = s => Dictee.norm(s);
  const JOURS_LONGS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const STATUT_TXT = { prevu: 'Prévu', realise: 'Réalisé', reporte: 'Reporté', annule: 'Annulé' };
  const ETAT_TXT = { propre: 'Presque propre', peu: "Un peu d'herbe", beaucoup: "Beaucoup d'herbe" };
  const estHerbe = it => /rotofil/i.test(`${it.type} ${it.materiel} ${it.agents}`);

  /* ---------- Annuaire des agents (construit sur l'appareil, jamais envoyé) ---------- */
  function annuaire() {
    const brut = [...(state.interventions || []).map(l => l.agents || ''), ...state.planning.map(p => p.agents || ''), state.agentsManuels].join(',');
    const vus = new Map();
    brut.split(/[,+\n;]| et /).forEach(m => {
      let x = m.replace(/\(.*?\)/g, ' ').replace(/quand il est l[aà]|le plus souvent|en renfort|renfort/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!x || /\d|int[ée]rim/i.test(x)) return;
      const mots = x.split(' ');
      const prenom = mots[0];
      if (prenom.length < 3 || !/^[A-ZÉÈÀÂÎÔÛÇ]/.test(prenom)) return;
      const complet = mots.slice(0, 3).join(' ');
      if (!vus.has(complet)) vus.set(complet, { prenom, cle: N(prenom), nomFam: mots.slice(1, 3).join(' '), complet });
    });
    return [...vus.values()];
  }
  const motsAgents = () => [...new Set(annuaire().flatMap(a => N(a.complet).split(' ')))];

  /* ---------- Données ---------- */
  function lieuTexte(it) {
    const voies = [...new Set(it.rueIds.map(id => rueParId(id)?.voie).filter(Boolean))];
    return [...voies, ...(it.zones || [])].join(', ') || it.lieuLibre || '';
  }
  // passages de repousse liés à une intervention validée (recalculés à chaque changement)
  function majPassages(it) {
    state.passages = state.passages.filter(p => !(p.source === 'planning' && p.ref === it.id));
    if (it.statut === 'realise' && estHerbe(it)) {
      const date = it.dateRealise || it.date;
      if (date <= aujourdhui()) it.rueIds.forEach(rueId => state.passages.push({
        id: `pl-${it.id}-${rueId}`, rueId, date, etat: it.etat || '', equipe: it.agents, remarque: it.type, auteur: state.auteur || '', creeLe: Date.now(), source: 'planning', ref: it.id,
      }));
    }
  }
  function enregistrer() { persist(); invalider(); if (typeof besoinArchive === 'function' && besoinArchive()) majMeteo(); rendre(); }

  function ajouter(d) {
    const it = { id: uid(), creeLe: Date.now(), modifieLe: Date.now(), copieLe: 0, statut: 'prevu', etat: '', observations: '', ...d };
    state.planning.push(it); majPassages(it); enregistrer(); return it;
  }
  // interventions déjà prévues qui ressemblent à une nouvelle : même type, au moins une rue en commun
  //   - même jour (planning ou tableau importé) : « c'est peut-être la même »
  //   - à 1-3 jours (planning seulement) : on peut proposer de la déplacer
  function doublons(d) {
    if (!d || !d.type || N(d.type) === 'autre') return { memeJour: [], proches: [] };
    const rues = new Set(d.rueIds || []), type = N(d.type);
    const commun = it => (it.rueIds || []).filter(id => rues.has(id));
    const memeJour = [], proches = [];
    (state.planning || []).forEach(p => {
      if (p.statut !== 'prevu' || N(p.type) !== type || !commun(p).length) return;
      const ecart = Math.abs(ecartJours(d.date, p.date));
      if (ecart === 0) memeJour.push({ source: 'planning', it: p });
      else if (ecart <= 3) proches.push({ source: 'planning', it: p, ecart });
    });
    (state.interventions || []).forEach(l => {
      if (l.date !== d.date || N(l.type) !== type || /annul/.test(N(l.statutTexte || l.statut || '')) || !commun(l).length) return;
      memeJour.push({ source: 'tableau', it: l });
    });
    proches.sort((a, b) => a.ecart - b.ecart);
    return { memeJour, proches };
  }
  function changer(id, modif) {
    const it = state.planning.find(p => p.id === id); if (!it) return;
    Object.assign(it, modif, { modifieLe: Date.now() });
    majPassages(it); enregistrer();
  }
  const valider = (id, etat, date) => changer(id, { statut: 'realise', etat: etat || '', dateRealise: date || aujourdhui() });
  function reporter(id, nouvelleDate) {
    const it = state.planning.find(p => p.id === id); if (!it) return;
    // l'ancienne ligne reste « Reportée » (trace pour le tableau) ; une nouvelle ligne « Prévue » est créée
    changer(id, { statut: 'reporte', observations: [it.observations, `Reporté au ${fmtJM(nouvelleDate)}`].filter(Boolean).join(' · ') });
    ajouter({ date: nouvelleDate, type: it.type, rueIds: it.rueIds, zones: it.zones, agents: it.agents, materiel: it.materiel, intervention: it.intervention, observations: `Reporté du ${fmtJM(it.date)}` });
  }
  const annuler = id => changer(id, { statut: 'annule' });
  function supprimer(id) {
    const it = state.planning.find(p => p.id === id); if (!it) return;
    it.statut = 'annule'; majPassages(it);
    state.planning = state.planning.filter(p => p.id !== id); enregistrer();
  }

  // interventions prévues qui correspondent à ce qui est dit le jour J
  function candidats(rueIds, zones, type, agents) {
    const today = aujourdhui();
    const r = new Set(rueIds), z = new Set(zones), ag = new Set(agents.map(a => N(a).split(' ')[0]));
    return state.planning.filter(p => p.statut === 'prevu').map(p => {
      let score = p.rueIds.filter(id => r.has(id)).length * 3 + (p.zones || []).filter(x => z.has(x)).length * 3;
      if (type && p.type === type) score += 2;
      score += N(p.agents).split(' ').filter(t => ag.has(t)).length;
      const ecart = Math.abs(ecartJours(today, p.date));
      return { p, score, ecart };
    }).filter(c => c.score > 0 && c.ecart <= 21).sort((a, b) => b.score - a.score || a.ecart - b.ecart);
  }

  /* ---------- Copie vers le tableau Excel ---------- */
  function ligneTableau(it) {
    const d = it.statut === 'realise' && it.dateRealise ? it.dateRealise : it.date;
    const [y, m, j] = d.split('-');
    return ['', `${j}/${m}/${y}`, JOURS_LONGS[new Date(toUTC(d)).getUTCDay()], it.type || 'Autre', lieuTexte(it), it.intervention || it.type || '',
      it.materiel || '', '', it.agents || '', STATUT_TXT[it.statut] || '', it.observations || '', it.etat ? ETAT_TXT[it.etat] : '']
      .map(v => String(v).replace(/[\t\n]+/g, ' ')).join('\t');
  }
  async function copier(items) {
    if (!items.length) { toast('Rien à copier.'); return; }
    const texte = [...items].sort((a, b) => a.date.localeCompare(b.date)).map(ligneTableau).join('\n');
    let ok = false;
    try { await navigator.clipboard.writeText(texte); ok = true; } catch {
      const ta = document.createElement('textarea'); ta.value = texte; document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {} ta.remove();
    }
    if (!ok) { toast('Copie impossible sur ce navigateur.'); return; }
    const t = Date.now(); items.forEach(it => { it.copieLe = t; }); persist(); rendre();
    toast(`${items.length} ligne${items.length > 1 ? 's' : ''} copiée${items.length > 1 ? 's' : ''} : colle-les dans ton tableau (colonne N°).`);
  }
  const aCopier = () => state.planning.filter(p => !p.copieLe || p.modifieLe > p.copieLe);

  return { annuaire, motsAgents, lieuTexte, ajouter, doublons, changer, valider, reporter, annuler, supprimer, candidats, copier, aCopier, estHerbe, STATUT_TXT, ETAT_TXT };
})();

/* ================= Interface ================= */
(() => {
  const $ = s => document.querySelector(s);

  // petite fenêtre pour « Fait » (état de l'herbe) et « Reporter » (nouvelle date)
  const dlg = document.createElement('dialog');
  document.body.appendChild(dlg);
  let action = null;
  function ouvrirAction(type, id) {
    const it = state.planning.find(p => p.id === id); if (!it) return;
    action = { type, id };
    const titre = type === 'fait' ? 'Intervention faite' : type === 'modifier' ? 'Modifier l\'intervention' : 'Reporter l\'intervention';
    let corps = `<p style="margin-top:0"><strong>${esc(it.type || 'Intervention')}</strong> — ${esc(Planning.lieuTexte(it))}<br><span class="muted small">prévue le ${fmtJour(it.date)}${it.agents ? ' · ' + esc(it.agents) : ''}</span></p>`;
    if (type === 'fait') {
      corps += `<label class="f">Date de réalisation<input type="date" id="paDate" value="${aujourdhui()}" max="${aujourdhui()}"></label>`;
      if (Planning.estHerbe(it)) corps += `<p class="small" style="margin:14px 0 6px"><strong>État de l'herbe en arrivant</strong></p><div class="radios">
        ${Object.entries(Planning.ETAT_TXT).map(([k, v]) => `<label><input type="radio" name="paEtat" value="${k}"><span>${esc(v)}</span></label>`).join('')}
        <label><input type="radio" name="paEtat" value="" checked><span>Non renseigné</span></label></div>`;
    } else if (type === 'modifier') {
      const prevu = it.statut === 'prevu';
      corps += prevu ? `<label class="f">Date prévue<input type="date" id="paDate" value="${it.date}" min="${aujourdhui()}"></label>` : '';
      corps += `<label class="f">Agents<input type="text" id="paAgents" value="${esc(it.agents || '')}" autocomplete="off"></label>
        <div class="chips" style="margin:6px 0 10px">${Planning.annuaire().map(a => `<button type="button" class="chipbtn" data-agentadd="${esc(a.complet)}">+ ${esc(a.complet)}</button>`).join('')}</div>
        <p class="muted small" style="margin:-4px 0 10px">Pour remplacer un agent (malade, absent) : corrige le texte ci-dessus, ou touche un nom pour l'ajouter.</p>
        <label class="f">Matériel<input type="text" id="paMateriel" value="${esc(it.materiel || '')}" autocomplete="off"></label>
        <label class="f">Observations<input type="text" id="paObs" value="${esc(it.observations || '')}" autocomplete="off"></label>`;
    } else {
      corps += `<label class="f">Nouvelle date<input type="date" id="paDate" value="${addJours(aujourdhui(), 1)}" min="${aujourdhui()}"></label>`;
    }
    dlg.innerHTML = `<div class="dlg-head"><h3>${titre}</h3><button class="x" data-ferme aria-label="Fermer">×</button></div>
      <div class="dlg-body">${corps}</div>
      <div class="dlg-foot"><button class="btn" data-ferme>Annuler</button><button class="btn primary" id="paOk">${type === 'fait' ? 'Valider' : type === 'modifier' ? 'Enregistrer' : 'Reporter'}</button></div>`;
    dlg.showModal();
  }
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-ferme]')) { dlg.close(); return; }
    const ajout = e.target.closest('[data-agentadd]');
    if (ajout) { const c = dlg.querySelector('#paAgents'); if (c) c.value = [c.value.trim(), ajout.dataset.agentadd].filter(Boolean).join(', '); return; }
    if (e.target.id !== 'paOk' || !action) return;
    if (action.type === 'modifier') {
      const it = state.planning.find(x => x.id === action.id); if (!it) { dlg.close(); return; }
      const modif = { agents: dlg.querySelector('#paAgents').value.trim(), materiel: dlg.querySelector('#paMateriel').value.trim(), observations: dlg.querySelector('#paObs').value.trim() };
      const champDate = dlg.querySelector('#paDate');
      if (champDate) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(champDate.value)) { toast('Date invalide.'); return; }
        modif.date = champDate.value;
      }
      Planning.changer(action.id, modif); dlg.close(); toast('Modifications enregistrées.'); return;
    }
    const date = dlg.querySelector('#paDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('Date invalide.'); return; }
    if (action.type === 'fait') {
      if (date > aujourdhui()) { toast('Pas de date future pour une intervention faite.'); return; }
      Planning.valider(action.id, dlg.querySelector('input[name=paEtat]:checked')?.value || '', date);
      toast('Intervention validée.');
    } else {
      Planning.reporter(action.id, date);
      toast(`Reportée au ${fmtJour(date)}.`);
    }
    dlg.close();
  });

  function carte(it, { actions = true } = {}) {
    const today = aujourdhui();
    const enRetard = it.statut === 'prevu' && it.date < today;
    const etiquette = it.statut === 'prevu'
      ? (enRetard ? '<span class="tag">À valider</span>' : `<span class="n"><strong>${fmtJour(it.date)}</strong></span>`)
      : `<span class="chip${it.statut === 'annule' ? ' inconnu' : ''}">${Planning.STATUT_TXT[it.statut]}</span>`;
    const copie = it.copieLe && it.modifieLe <= it.copieLe ? ' · copié dans le tableau' : (it.copieLe ? ' · modifié depuis la copie' : '');
    return `<div class="rue plan" style="cursor:default;align-items:flex-start">
      <div class="main">
        <div class="meta">${it.statut === 'prevu' ? '' : fmtJour(it.statut === 'realise' && it.dateRealise ? it.dateRealise : it.date) + ' · '}${esc(it.type || 'Intervention')}${it.etat ? ' · ' + esc(Planning.ETAT_TXT[it.etat]) : ''}${copie}</div>
        <div class="nom" style="white-space:normal">${esc(Planning.lieuTexte(it))}</div>
        ${it.agents ? `<div class="meta">${esc(it.agents)}</div>` : ''}
        ${it.observations ? `<div class="meta">${esc(it.observations)}</div>` : ''}
        ${it.statut === 'prevu' ? (al => al ? `<div class="pluie ${al.niveau}">${esc(al.titre)} ${esc(al.detail)}</div>` : '')(alerteMeteo(it.date)) : ''}
        ${actions && it.statut === 'prevu' ? `<div class="actions" style="margin-top:8px">
          <button class="btn primary" data-pl="fait" data-id="${it.id}">Fait</button>
          <button class="btn modif" data-pl="modifier" data-id="${it.id}">Modifier</button>
          <button class="btn" data-pl="reporter" data-id="${it.id}">Reporter</button>
          <button class="btn danger" data-pl="annuler" data-id="${it.id}">Annuler</button></div>` : ''}
        ${actions && it.statut !== 'prevu' ? `<div class="actions" style="margin-top:8px">${it.statut === 'realise' ? `<button class="btn modif" data-pl="modifier" data-id="${it.id}">Modifier</button> ` : ''}<button class="btn" data-pl="rouvrir" data-id="${it.id}">Remettre en « Prévu »</button></div>` : ''}
      </div>
      <div class="right">${etiquette}</div></div>`;
  }

  /* ---------- Alertes météo (pluie, vent) ----------
     Seuils : voir SEUILS dans app.js. La pluie est évaluée dans la plage des « Heures de travail » (Réglages), heure par heure
     quand la prévision horaire est disponible ; sinon on retombe sur les valeurs de la journée entière.
     Open-Meteo : la valeur de l'heure H est le cumul de l'heure précédente (H-1 → H), donc les valeurs H+1 … Fin couvrent Début … Fin. */
  const RANG = { possible: 1, probable: 2, forte: 3 };
  const NOM_NIVEAU = { possible: 'Pluie possible', probable: 'Pluie probable', forte: 'Forte pluie' };
  const JOURS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const dowD = d => new Date(toUTC(d)).getUTCDay();
  const ouvre = d => dowD(d) !== 0 && dowD(d) !== 6;
  const horaireOk = () => !!(meteo.horaire && meteo.horaire.le && Date.now() - meteo.horaire.le < WX_ANCIEN_MS);

  // plage évaluée ce jour-là (aujourd'hui : seulement ce qui reste de la plage de travail)
  function plage(date) {
    const R = state.reglages.heuresTravail, today = aujourdhui();
    let lo = R.debut; const hi = R.fin;
    if (date === today) lo = Math.max(lo, new Date().getHours());
    return lo < hi ? { lo, hi } : null;
  }
  // prévisions disponibles pour un jour : une liste de sources { id, nom, h } (h = tableau horaire ou null)
  function sources(date) {
    return [{ id: 'defaut', nom: 'modèle principal', h: horaireOk() ? (meteo.horaire.defaut[date] || null) : null }];
  }
  // mesure sur la plage : mm cumulés, probabilité max, rafales max, heures concernées
  function mesure(date, h) {
    const pl = plage(date); if (!pl) return null;
    if (h) {
      let mm = 0, pr = 0, g = 0; const idx = [];
      for (let i = pl.lo + 1; i <= pl.hi; i++) {
        const p = h.p[i] || 0, q = h.pr[i] || 0, w = h.g[i] || 0;
        mm += p; pr = Math.max(pr, q); g = Math.max(g, w);
        if (p >= 0.1 || q >= SEUILS.pluie.possible.proba) idx.push(i);
      }
      return { mm, proba: pr, rafales: g, horaire: true, debut: idx.length ? Math.max(pl.lo, Math.min(...idx) - 1) : null, fin: idx.length ? Math.min(pl.hi, Math.max(...idx)) : null };
    }
    const j = meteo.jours[date];
    if (!j || (date > aujourdhui() && !j.prev)) return null;
    return { mm: j.pluie || 0, proba: j.proba, rafales: j.vent, horaire: false, debut: null, fin: null };
  }
  function niveauPluie(m) {
    if (!m) return null;
    const S = SEUILS.pluie, pr = m.proba;
    if (m.mm >= S.forte.mm) return 'forte';
    if (m.mm >= S.probable.mm || (pr != null && pr >= S.probable.proba)) return 'probable';
    if (m.mm >= S.possible.mm || (pr != null && pr >= S.possible.proba)) return 'possible';
    return null;
  }
  // évaluation d'un jour : niveau de pluie (le plus prudent des sources), rafales, mesure retenue
  function evaluer(date) {
    const res = sources(date).map(s => ({ ...s, m: mesure(date, s.h) })).filter(x => x.m);
    if (!res.length) return null;
    res.forEach(x => { x.n = niveauPluie(x.m); });
    const best = res.reduce((a, b) => (RANG[b.n] || 0) > (RANG[a.n] || 0) ? b : a);
    return { niveau: best.n, m: best.m, rafales: Math.max(...res.map(x => x.m.rafales || 0)), res };
  }
  const quandTxt = d => { const n = ecartJours(aujourdhui(), d); return n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : JOURS_LONG[dowD(d)]; };
  const mmTxt = mm => mm < 0.05 ? '0 mm' : mm < 0.1 ? '< 0,1 mm' : `${virgule(Math.round(mm * 10) / 10)} mm`;
  const heuresTxt = m => (m.debut != null && m.fin != null) ? ` entre ${m.debut} h et ${m.fin} h` : '';

  // texte d'une alerte de pluie : « aujourd'hui entre 9 h et 12 h (1,8 mm, 70 %) »
  function detailPluie(date, e) {
    const m = e.m, chiffres = [mmTxt(m.mm)]; if (m.proba != null && m.proba > 0) chiffres.push(`${Math.round(m.proba)} %`);
    return `${quandTxt(date)}${heuresTxt(m)} (${chiffres.join(', ')})`;
  }
  const detailVent = (date, e) => `${quandTxt(date)} : rafales jusqu'à ${Math.round(e.rafales)} km/h`;

  // alerte d'un jour (pluie et/ou vent), au format historique { niveau, titre, detail }
  window.alerteMeteo = function (date) {
    const today = aujourdhui();
    if (!date || date < today) return null;
    const e = evaluer(date); if (!e) return null;
    const vent = e.rafales >= SEUILS.vent.rafales;
    if (!e.niveau && !vent) return null;
    if (e.niveau) {
      const fort = e.niveau === 'forte' || vent;
      return { niveau: fort ? 'fort' : 'moyen', kind: 'pluie', niv: e.niveau, titre: NOM_NIVEAU[e.niveau], detail: detailPluie(date, e) + (vent ? ` · vent fort (rafales ${Math.round(e.rafales)} km/h)` : '') + '.' };
    }
    return { niveau: 'fort', kind: 'vent', titre: 'Vent fort prévu', detail: detailVent(date, e) + '.' };
  };

  window.Pluie = { evaluer, heuresTxt, mmTxt, quandTxt }; // utilisé par la carte météo de l'Accueil (app.js)

  // bandeau tout en haut de l'Accueil : aujourd'hui et les 3 jours suivants (jours travaillés)
  window.blocAlertePluie = function () {
    const R = state.alertes || {}, today = aujourdhui(), lignes = [];
    let rouge = false;
    for (let k = 0; k <= SEUILS.joursAlerte; k++) {
      const d = addJours(today, k); if (!ouvre(d)) continue;
      const e = evaluer(d); if (!e) continue;
      const prevus = (state.planning || []).filter(p => p.statut === 'prevu' && p.date === d).length;
      const plus = prevus ? ` <span class="small">· ${prevus} intervention${prevus > 1 ? 's' : ''} prévue${prevus > 1 ? 's' : ''} ce jour-là</span>` : '';
      if (e.niveau && R.pluie !== false) {
        if (e.niveau === 'forte') rouge = true;
        lignes.push(`<div class="ap-ligne"><b>${NOM_NIVEAU[e.niveau]}</b> ${esc(detailPluie(d, e))}${plus}</div>`);
      }
      if (e.rafales >= SEUILS.vent.rafales && R.vent !== false) {
        rouge = true;
        lignes.push(`<div class="ap-ligne"><b>Vent fort</b> ${esc(detailVent(d, e))}${e.niveau ? '' : plus}</div>`);
      }
    }
    if (!lignes.length) return '';
    return `<div class="alerte-haut ${rouge ? 'rouge' : 'ambre'}" role="alert"><div class="ap-titre">Alerte météo</div>${lignes.slice(0, 5).join('')}</div>`;
  };

  // bloc en haut de « Priorités » : à valider + 7 prochains jours
  window.blocPlanning = function () {
    const today = aujourdhui(), fin = addJours(today, 7);
    const L = state.planning.filter(p => p.statut === 'prevu' && p.date <= fin).sort((a, b) => a.date.localeCompare(b.date));
    const head = `<h2 style="display:flex;justify-content:space-between;align-items:center;gap:8px">Planning des 7 jours <button class="btn" data-pl="prevoir">+ Prévoir</button></h2>`;
    const alertes = '';
    if (!L.length) return alertes + head + `<p class="muted small" style="margin-top:0">Rien de prévu. Touche « + Prévoir » ou coche des rues dans l'onglet Rues.</p>`;
    return alertes + head + `<div class="list">${L.map(it => carte(it)).join('')}</div>`;
  };

  // vue « Planning » de l'onglet Suivi
  window.vuePlanning = function () {
    const today = aujourdhui();
    const P = state.planning;
    const avalider = P.filter(p => p.statut === 'prevu' && p.date < today).sort((a, b) => a.date.localeCompare(b.date));
    const avenir = P.filter(p => p.statut === 'prevu' && p.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const faits = P.filter(p => p.statut !== 'prevu').sort((a, b) => (b.dateRealise || b.date).localeCompare(a.dateRealise || a.date)).slice(0, 30);
    const n = Planning.aCopier().length;
    let h = `<div class="actions" style="margin:0 0 12px">
      <button class="btn primary" data-pl="prevoir">+ Prévoir une intervention</button>
      <button class="btn" data-pl="copier" ${n ? '' : 'disabled'}>Copier pour mon tableau${n ? ` (${n})` : ''}</button></div>
      <p class="muted small" style="margin:-4px 0 12px">« Copier pour mon tableau » copie les lignes nouvelles ou modifiées, dans l'ordre de tes colonnes : colle-les dans Excel sur la première case vide de la colonne N°.</p>`;
    if (!P.length) h += `<div class="notice">Aucune intervention enregistrée. Appuie sur <strong>+ Prévoir une intervention</strong>, ou coche des rues dans l'onglet <strong>Rues</strong>.</div>`;
    if (avalider.length) h += `<h2>À valider (${avalider.length})</h2><div class="list">${avalider.map(it => carte(it)).join('')}</div>`;
    if (avenir.length) h += `<h2>À venir (${avenir.length})</h2><div class="list">${avenir.map(it => carte(it)).join('')}</div>`;
    if (faits.length) h += `<h2>Traitées récemment</h2><div class="list">${faits.map(it => carte(it)).join('')}</div>`;
    return h;
  };

  document.getElementById('view').addEventListener('click', e => {
    const b = e.target.closest('[data-pl]'); if (!b) return;
    const id = b.dataset.id, a = b.dataset.pl;
    if (a === 'prevoir') { if (typeof ouvrirSaisie === 'function') ouvrirSaisie({ mode: 'prevu' }); return; }
    if (a === 'copier') { Planning.copier(Planning.aCopier()); return; }
    if (a === 'fait') ouvrirAction('fait', id);
    if (a === 'reporter') ouvrirAction('reporter', id);
    if (a === 'modifier') ouvrirAction('modifier', id);
    if (a === 'annuler' && confirm('Annuler cette intervention prévue ?')) { Planning.annuler(id); toast('Intervention annulée.'); }
    if (a === 'rouvrir') Planning.changer(id, { statut: 'prevu', dateRealise: null, etat: '' });
  });
})();
