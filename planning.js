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

  return { annuaire, motsAgents, lieuTexte, ajouter, changer, valider, reporter, annuler, supprimer, candidats, copier, aCopier, estHerbe, STATUT_TXT, ETAT_TXT };
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
    const titre = type === 'fait' ? 'Intervention faite' : 'Reporter l\'intervention';
    let corps = `<p style="margin-top:0"><strong>${esc(it.type || 'Intervention')}</strong> — ${esc(Planning.lieuTexte(it))}<br><span class="muted small">prévue le ${fmtJour(it.date)}${it.agents ? ' · ' + esc(it.agents) : ''}</span></p>`;
    if (type === 'fait') {
      corps += `<label class="f">Date de réalisation<input type="date" id="paDate" value="${aujourdhui()}" max="${aujourdhui()}"></label>`;
      if (Planning.estHerbe(it)) corps += `<p class="small" style="margin:14px 0 6px"><strong>État de l'herbe en arrivant</strong></p><div class="radios">
        ${Object.entries(Planning.ETAT_TXT).map(([k, v]) => `<label><input type="radio" name="paEtat" value="${k}"><span>${esc(v)}</span></label>`).join('')}
        <label><input type="radio" name="paEtat" value="" checked><span>Non renseigné</span></label></div>`;
    } else {
      corps += `<label class="f">Nouvelle date<input type="date" id="paDate" value="${addJours(aujourdhui(), 1)}" min="${aujourdhui()}"></label>`;
    }
    dlg.innerHTML = `<div class="dlg-head"><h3>${titre}</h3><button class="x" data-ferme aria-label="Fermer">×</button></div>
      <div class="dlg-body">${corps}</div>
      <div class="dlg-foot"><button class="btn" data-ferme>Annuler</button><button class="btn primary" id="paOk">${type === 'fait' ? 'Valider' : 'Reporter'}</button></div>`;
    dlg.showModal();
  }
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-ferme]')) { dlg.close(); return; }
    if (e.target.id !== 'paOk' || !action) return;
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
          <button class="btn" data-pl="reporter" data-id="${it.id}">Reporter</button>
          <button class="btn danger" data-pl="annuler" data-id="${it.id}">Annuler</button></div>` : ''}
        ${actions && it.statut !== 'prevu' ? `<div class="actions" style="margin-top:8px"><button class="btn" data-pl="rouvrir" data-id="${it.id}">Remettre en « Prévu »</button></div>` : ''}
      </div>
      <div class="right">${etiquette}</div></div>`;
  }

  /* ---------- Alertes météo (pluie, vent) ----------
     Pluie probable : ≥ 2 mm ou probabilité ≥ 60 %. Forte pluie : ≥ 10 mm. Vent fort : rafales moyennes ≥ 50 km/h.
     Seulement pour les jours couverts par la prévision (16 jours) ; plus fiable à 2–3 jours. */
  const SEUILS = { pluie: 2, proba: 60, forte: 10, vent: 50 };
  window.alerteMeteo = function (date) {
    const today = aujourdhui();
    if (!date || date < today) return null;
    const j = meteo.jours[date];
    if (!j || (date > today && !j.prev)) return null;
    const pl = j.pluie || 0, pr = j.proba, v = j.vent;
    const pluie = pl >= SEUILS.pluie || (pr != null && pr >= SEUILS.proba);
    const vent = v != null && v >= SEUILS.vent;
    if (!pluie && !vent) return null;
    const dans = ecartJours(today, date);
    const fiab = dans <= 3 ? '' : ' (prévision lointaine, à reconfirmer)';
    const morceaux = [];
    if (pluie) morceaux.push(`${virgule(pl)} mm${pr != null ? `, ${pr} % de risque` : ''}${j.heuresPluie ? `, ${Math.round(j.heuresPluie)} h de pluie` : ''}`);
    if (vent) morceaux.push(`vent jusqu'à ${Math.round(v)} km/h`);
    const fort = pl >= SEUILS.forte || (pr != null && pr >= 80 && pl >= 5) || vent;
    return { niveau: fort ? 'fort' : 'moyen', titre: pluie ? (fort ? 'Forte pluie prévue' : 'Pluie probable') : 'Vent fort prévu', detail: `le ${fmtJour(date)} : ${morceaux.join(' · ')}${fiab}.` };
  };
  // bandeau dans Priorités : les 3 prochains jours
  function alertesPluie() {
    const today = aujourdhui(), lignes = [];
    for (let k = 0; k <= 3; k++) {
      const d = addJours(today, k), al = alerteMeteo(d); if (!al) continue;
      const prevus = state.planning.filter(p => p.statut === 'prevu' && p.date === d);
      lignes.push(`<div><strong>${esc(al.titre)}</strong> ${esc(al.detail)}${prevus.length ? `<br><span class="small">⚠ ${prevus.length} intervention${prevus.length > 1 ? 's' : ''} prévue${prevus.length > 1 ? 's' : ''} ce jour-là : ${prevus.map(p => esc((p.intervention || p.type) + ' · ' + Planning.lieuTexte(p))).join(' ; ')} — à reporter ou à remplacer ?</span>` : ''}</div>`);
    }
    return lignes.length ? `<div class="notice warn" style="margin-top:12px"><div class="small muted" style="margin-bottom:4px">Alerte météo — 3 prochains jours</div>${lignes.join('<div style="height:6px"></div>')}</div>` : '';
  }

  // bloc en haut de « Priorités » : à valider + 7 prochains jours
  window.blocPlanning = function () {
    const today = aujourdhui(), fin = addJours(today, 7);
    const L = state.planning.filter(p => p.statut === 'prevu' && p.date <= fin).sort((a, b) => a.date.localeCompare(b.date));
    const head = `<h2 style="display:flex;justify-content:space-between;align-items:center;gap:8px">Planning des 7 jours <button class="btn" data-pl="prevoir">+ Prévoir</button></h2>`;
    const alertes = alertesPluie();
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
    if (a === 'annuler' && confirm('Annuler cette intervention prévue ?')) { Planning.annuler(id); toast('Intervention annulée.'); }
    if (a === 'rouvrir') Planning.changer(id, { statut: 'prevu', dateRealise: null, etat: '' });
  });
})();
