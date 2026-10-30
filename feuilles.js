/* Suivi désherbage — module « feuilles mortes ».
   Rues avec arbres : l'appli estime chaque jour la chute des feuilles (saison + gelées + vent),
   l'additionne depuis le dernier ramassage (coordonné, pompage, souffleur, balayage manuel) et prévient
   quand il faut repasser.
   Les valeurs sont des estimations de départ, à caler avec le terrain (Réglages). */
'use strict';

const Feuilles = (() => {
  state.feuilles = Object.assign({ rues: null, seuil: 550 }, state.feuilles || {});
  const N = s => Dictee.norm(s);

  const ruesDefaut = () => secteur()?.ruesFeuilles || [];
  const rues = () => state.feuilles.rues || ruesDefaut();
  const estRue = id => rues().includes(id);
  function basculer(id, oui) {
    const l = new Set(rues());
    oui ? l.add(id) : l.delete(id);
    state.feuilles.rues = [...l];
    persist(); invalider();
  }

  // interventions qui enlèvent les feuilles
  const estRamassage = (type, texte) => /coordonn|pompage|pomper|souffl|balayage manuel|feuille/.test(N(`${type} ${texte}`));
  function dernier(rueId) {
    const dates = [];
    (state.planning || []).forEach(p => {
      if (p.statut === 'realise' && p.rueIds.includes(rueId) && estRamassage(p.type, `${p.intervention} ${p.materiel}`)) dates.push(p.dateRealise || p.date);
    });
    (state.interventions || []).forEach(l => {
      if (l.statut === 'realise' && l.rueIds.includes(rueId) && estRamassage(l.type, `${l.intervention} ${l.materiel}`)) dates.push(l.date);
    });
    const today = aujourdhui();
    return dates.filter(d => d <= today).sort().pop() || null;
  }

  // indice de chute du jour (0 à ~170) : courbe de saison (pic mi-novembre à Toulouse) × gel × vent
  const cache = new Map();
  function indice(d) {
    if (cache.has(d)) return cache.get(d);
    const t = toUTC(d), debutAn = Date.UTC(+d.slice(0, 4), 0, 1);
    const doy = Math.round((t - debutAn) / 86400000) + 1;
    const z = (doy - 314) / 18;
    let x = 100 * Math.exp(-z * z / 2);
    const j = jourMeteo(d);
    let gel = false;
    for (let k = 0; k < 4; k++) if (jourMeteo(addJours(d, -k)).tmin <= 1) gel = true;
    if (gel) x *= 1.5;                      // une gelée fait tomber beaucoup de feuilles les jours suivants
    if (j.vent != null) { if (j.vent >= 60) x *= 1.7; else if (j.vent >= 40) x *= 1.4; }
    const r = { x, gel, vent: j.vent != null && j.vent >= 40 ? j.vent : null, source: j.source };
    cache.set(d, r);
    return r;
  }
  const niveau = x => x < 25 ? 'faible' : x < 60 ? 'moyenne' : x < 100 ? 'forte' : 'très forte';

  function statut(rueId) {
    const today = aujourdhui(), seuil = state.feuilles.seuil;
    const der = dernier(rueId);
    const depart = der || addJours(today, -21); // sans ramassage connu : on compte 3 semaines
    let cumul = 0;
    for (let d = addJours(depart, 1); d <= today; d = addJours(d, 1)) cumul += indice(d).x;
    let echeance = null, acc = cumul;
    if (cumul < seuil) for (let k = 1; k <= 60; k++) { const d = addJours(today, k); acc += indice(d).x; if (acc >= seuil) { echeance = d; break; } }
    const pct = cumul / seuil;
    return { dernier: der, cumul, pct, echeance, etat: pct >= 1 ? 'afaire' : pct >= 0.7 ? 'bientot' : 'ok' };
  }

  function semaine() {
    const today = aujourdhui(), l = [];
    for (let k = 0; k < 7; k++) { const d = addJours(today, k); l.push({ d, ...indice(d) }); }
    return l;
  }

  function invalider2() { cache.clear(); }
  return { rues, estRue, basculer, dernier, indice, niveau, statut, semaine, invalider: invalider2, estRamassage };
})();

/* ================= Interface ================= */
(() => {
  // l'indice dépend de la météo : on le recalcule quand l'appli recalcule
  const inv0 = window.invalider;
  if (typeof inv0 === 'function') window.invalider = function () { Feuilles.invalider(); return inv0.apply(this, arguments); };

  const nomR = id => { const r = rueParId(id); return r ? r.voie + (r.troncon ? ` (${r.troncon})` : '') : '?'; };

  window.blocFeuilles = function () {
    Feuilles.invalider();
    const ids = Feuilles.rues(); if (!ids.length) return '';
    const sem = Feuilles.semaine();
    const rows = ids.map(id => ({ id, s: Feuilles.statut(id) })).sort((a, b) => b.s.pct - a.s.pct);
    const bande = sem.map(j => {
      const n = Feuilles.niveau(j.x);
      const pourquoi = [j.gel ? 'gel' : null, j.vent ? `vent ${Math.round(j.vent)} km/h` : null].filter(Boolean).join(', ');
      return `<div class="fj ${n === 'très forte' ? 'tres-forte' : n}" title="${esc(pourquoi)}"><span>${JOURS_COURTS[new Date(toUTC(j.d)).getUTCDay()]}</span><b>${n === 'très forte' ? '+++' : n === 'forte' ? '++' : n === 'moyenne' ? '+' : '·'}</b>${pourquoi ? `<i>${esc(pourquoi)}</i>` : ''}</div>`;
    }).join('');
    let h = `<h2>Feuilles mortes <span class="muted">(${ids.length} rue${ids.length > 1 ? 's' : ''} avec arbres)</span></h2>
      <div class="fsem">${bande}</div>
      <p class="muted small" style="margin:4px 0 8px">Chute estimée jour par jour : · faible, + moyenne, ++ forte, +++ très forte.</p>`;
    // alerte avaloirs : forte pluie à venir alors que des feuilles se sont accumulées
    const today = aujourdhui();
    const pluie = [0, 1, 2, 3].map(k => addJours(today, k)).find(d => { const j = meteo.jours[d]; return j && (d === today || j.prev) && (j.pluie || 0) >= 10; });
    const chargees = rows.filter(r => r.s.pct >= 0.7);
    if (pluie && chargees.length) h += `<div class="notice warn"><strong>Risque d'avaloirs bouchés</strong> : forte pluie prévue le ${fmtJour(pluie)} (${virgule(meteo.jours[pluie].pluie)} mm) alors que des feuilles se sont accumulées sur ${chargees.map(r => esc(nomR(r.id))).join(', ')}. Un ramassage avant la pluie limite le risque.</div>`;
    h += `<div class="list">${rows.map(({ id, s }) => {
      const droite = s.etat === 'afaire' ? '<span class="tag">À ramasser</span>' : s.echeance ? `<span class="n"${s.etat === 'bientot' ? ' style="font-weight:700"' : ''}>${ecartJours(today, s.echeance) <= 15 ? fmtJour(s.echeance) : fmtDateCourt(s.echeance)}</span>` : '—';
      return `<div class="rue" data-rue="${id}" role="button" tabindex="0"><div class="main"><div class="nom">${esc(nomR(id))}</div>
        <div class="meta">${s.dernier ? `dernier ramassage le ${fmtJM(s.dernier)}` : 'aucun ramassage connu'} · ${Math.round(s.pct * 100)} %</div></div>
        <div class="right">${droite}</div></div>`;
    }).join('')}</div>`;
    return h;
  };

  // section dans la fiche d'une rue
  window.blocFeuillesRue = function (id) {
    const oui = Feuilles.estRue(id);
    let h = `<h3 style="font-size:15px;margin:14px 0 6px">Feuilles mortes</h3>
      <label class="dict-item" style="cursor:pointer"><input type="checkbox" data-feuilles="${id}" ${oui ? 'checked' : ''}><span class="grow">Rue avec arbres (suivi des feuilles)</span></label>`;
    if (oui) {
      const s = Feuilles.statut(id);
      h += `<p class="small" style="margin:6px 0 0">${s.dernier ? `Dernier ramassage : ${fmtDate(s.dernier)}` : 'Aucun ramassage connu (compté sur 3 semaines)'} · feuilles accumulées : <strong>${Math.round(s.pct * 100)} %</strong>
        ${s.etat === 'afaire' ? ' — <strong>à ramasser</strong>' : s.echeance ? ` — prochain ramassage conseillé le ${fmtJour(s.echeance)}` : ''}</p>`;
    }
    return h;
  };

  document.getElementById('drBody').addEventListener('change', e => {
    const c = e.target.closest('[data-feuilles]'); if (!c) return;
    Feuilles.basculer(c.dataset.feuilles, c.checked);
    toast(c.checked ? 'Rue ajoutée au suivi des feuilles.' : 'Rue retirée du suivi des feuilles.');
    rendre();
    if (typeof ouvrirRue === 'function') ouvrirRue(c.dataset.feuilles);
  });
})();
