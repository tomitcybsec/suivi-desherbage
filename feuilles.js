/* Suivi désherbage — module « feuilles mortes ».
   Rues avec arbres : l'appli estime chaque jour la chute des feuilles (saison + gelées + vent),
   l'additionne depuis le dernier ramassage (coordonné ou pompage uniquement) et prévient
   quand il faut repasser.
   Les valeurs sont des estimations de départ, à caler avec le terrain (Réglages). */
'use strict';

const Feuilles = (() => {
  state.feuilles = Object.assign({ rues: null, seuil: 500, stop: {}, mode: 'simple' }, state.feuilles || {});
  if (!state.feuilles.stop) state.feuilles.stop = {};
  const N = s => Dictee.norm(s);

  const ruesDefaut = () => secteur()?.ruesFeuilles || [];
  const rues = () => state.feuilles.rues || ruesDefaut();
  const modeSimple = () => state.feuilles.mode !== 'complet';
  const estRue = id => rues().includes(id);
  function basculer(id, oui) {
    const l = new Set(rues());
    oui ? l.add(id) : l.delete(id);
    state.feuilles.rues = [...l];
    persist(); invalider();
  }

  // « Plus de feuilles sur les arbres » : le suivi de la rue est coupé jusqu'au 1er août suivant, puis repart tout seul
  const reprise = d => { const a = +d.slice(0, 4), m = +d.slice(5, 7); return `${m >= 8 ? a + 1 : a}-08-01`; };
  const stoppee = id => { const d = state.feuilles.stop[id]; return !!d && aujourdhui() < reprise(d); };
  function stopper(id, oui) {
    if (oui) state.feuilles.stop[id] = aujourdhui(); else delete state.feuilles.stop[id];
    persist(); invalider();
  }

  // interventions qui enlèvent les feuilles : seulement le coordonné et le pompage
  // (le souffleur seul et le balayage manuel ne comptent pas)
  const estRamassage = (type, texte) => /coordonn|pompage|pomper/.test(N(`${type} ${texte}`));
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
    // été sec (1er août → 30 septembre) : quelques feuilles tombent avec la sécheresse et le vent, niveau faible
    let seche = false;
    const m = +d.slice(5, 7);
    if (m === 8 || m === 9) {
      let pluie30 = 0;
      for (let k = 0; k < 30; k++) pluie30 += jourMeteo(addJours(d, -k)).pluie || 0;
      if (pluie30 < 30 && j.tmax >= 25) {
        seche = true;
        x = Math.max(x, (6 + 9 * (1 - pluie30 / 30)) * (j.vent != null && j.vent >= 40 ? 1.4 : 1)); // 6 à 21 : reste « faible »
      }
    }
    const r = { x, gel, seche, vent: j.vent != null && j.vent >= 40 ? j.vent : null, source: j.source };
    cache.set(d, r);
    return r;
  }
  const niveau = x => x < 25 ? 'faible' : x < 60 ? 'moyenne' : x < 100 ? 'forte' : 'très forte';

  function statut(rueId) {
    const today = aujourdhui(), seuil = state.feuilles.seuil;
    const der = dernier(rueId);
    if (stoppee(rueId)) return { dernier: der, cumul: 0, pct: 0, echeance: null, etat: 'stop', reprise: reprise(state.feuilles.stop[rueId]) };
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
    // 10 prochains jours travaillés (lundi → vendredi) : le week-end n'est pas affiché
    for (let k = 0; l.length < 10 && k < 20; k++) {
      const d = addJours(today, k), w = new Date(toUTC(d)).getUTCDay();
      if (w !== 0 && w !== 6) l.push({ d, ...indice(d) });
    }
    return l;
  }

  // prévision sur 15 jours, regroupée par semaine de travail (lundi → vendredi)
  function previsions() {
    const today = aujourdhui(), sem = new Map(), maintenant = [];
    rues().forEach(id => {
      if (stoppee(id)) return;
      const s = statut(id);
      if (s.etat === 'afaire') { maintenant.push(id); return; }
      if (!s.echeance || ecartJours(today, s.echeance) > 15) return;
      let d = s.echeance, w = new Date(toUTC(d)).getUTCDay();
      if (w === 6) d = addJours(d, -1); else if (w === 0) d = addJours(d, -2); // week-end : on agit avant, le vendredi
      if (d < today) d = today;
      w = new Date(toUTC(d)).getUTCDay();
      const lundi = addJours(d, -((w + 6) % 7));
      const g = sem.get(lundi) || { lundi, vendredi: addJours(lundi, 4), premier: d, ids: [] };
      if (d < g.premier) g.premier = d;
      g.ids.push(id); sem.set(lundi, g);
    });
    const classe = delta => delta <= 0 ? 'rouge' : delta <= 3 ? 'orange' : delta <= 10 ? 'jaune' : 'bleu';
    const confiance = delta => delta <= 5 ? 'assez fiable' : delta <= 10 ? 'probable' : 'à confirmer';
    const semaines = [...sem.values()].sort((a, b) => a.lundi < b.lundi ? -1 : 1).map(g => {
      const delta = ecartJours(today, g.premier);
      return { ...g, delta, classe: classe(delta), confiance: confiance(delta) };
    });
    return { maintenant, semaines };
  }

  function invalider2() { cache.clear(); }
  return { rues, estRue, modeSimple, previsions, basculer, stoppee, stopper, reprise, dernier, indice, niveau, statut, semaine, invalider: invalider2, estRamassage };
})();

/* ================= Interface ================= */
(() => {
  // l'indice dépend de la météo : on le recalcule quand l'appli recalcule
  const inv0 = window.invalider;
  if (typeof inv0 === 'function') window.invalider = function () { Feuilles.invalider(); return inv0.apply(this, arguments); };

  const nomR = id => { const r = rueParId(id); return r ? r.voie + (r.troncon ? ` (${r.troncon})` : '') : '?'; };

  // rues d'une même zone (ex. La Vache) regroupées sous le nom du quartier
  function nomsGroupes(ids) {
    const reste = new Set(ids), out = [];
    (secteur()?.zones || []).forEach(z => {
      const dedans = (z.rues || []).filter(id => reste.has(id));
      if (dedans.length >= 2) { out.push(`${z.nom} (${dedans.length} rues)`); dedans.forEach(id => reste.delete(id)); }
    });
    return [...out, ...[...reste].map(nomR)];
  }
  // « déjà prévu jeudi » : rues de la carte déjà au planning pour un coordonné ou un pompage
  function dejaTexte(ids) {
    if (typeof dejaPrevu !== 'function') return '';
    const m = dejaPrevu(p => Feuilles.estRamassage(p.type, `${p.intervention} ${p.materiel}`));
    const l = ids.filter(id => m[id]); if (!l.length) return '';
    const dates = [...new Set(l.map(id => m[id]))].sort().map(d => `${JOURS_COURTS[new Date(toUTC(d)).getUTCDay()]} ${fmtJM(d)}`);
    return `<div class="small"><strong>Déjà prévu ${dates.join(', ')}</strong> (${l.length} rue${l.length > 1 ? 's' : ''} sur ${ids.length})</div>`;
  }
  const delaiTexte = n => n <= 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`;
  function blocPrevision() {
    const p = Feuilles.previsions();
    let h = `<h3 class="fp-titre">Prévision sur 15 jours <span class="fp-est">estimation</span></h3>`;
    if (p.maintenant.length) h += `<div class="fprev c-rouge"><div class="fp-tete"><b>À ramasser maintenant</b><span class="fp-delai">aujourd'hui</span></div>
      <div>Prévoir coordonné ou pompage</div><div class="small">${nomsGroupes(p.maintenant).map(esc).join(', ')}</div></div>`;
    h += p.semaines.map(s => `<div class="fprev c-${s.classe}"><div class="fp-tete"><b>Semaine du ${fmtJour(s.lundi)} au ${fmtJour(s.vendredi)}</b><span class="fp-delai">${delaiTexte(s.delta)}</span></div>
      <div>Prévoir coordonné ou pompage</div><div class="small">${nomsGroupes(s.ids).map(esc).join(', ')}</div>${dejaTexte(s.ids)}
      ${Feuilles.modeSimple() ? '' : `<div class="muted small">Estimation · fiabilité : ${s.confiance}</div>`}
      <button class="btn" type="button" data-ics="${s.lundi}" style="margin-top:8px">Ajouter à mon agenda (rappel 3 jours avant)</button></div>`).join('');
    if (!p.maintenant.length && !p.semaines.length) h += '<p class="muted small" style="margin:0 0 8px">Rien à prévoir sur les 15 prochains jours (estimation).</p>';
    return h;
  }

  // Priorités : une seule ligne qui renvoie vers Suivi > Feuilles
  window.blocFeuillesResume = function () {
    if (!Feuilles.rues().length) return '';
    const p = Feuilles.previsions();
    const n = p.maintenant.length, s = p.semaines[0];
    const texte = n ? `<strong>${n} rue${n > 1 ? 's' : ''} à ramasser maintenant</strong> (feuilles)` : s ? `Feuilles : prochaine semaine à prévoir, du ${fmtJour(s.lundi)} au ${fmtJour(s.vendredi)}` : 'Feuilles : rien à prévoir sur 15 jours';
    return `<div class="notice${n ? ' warn' : ''}">${texte} <button class="btn" type="button" data-feuilles-voir style="margin-top:6px">Voir les feuilles</button></div>`;
  };
  window.vueFeuilles = function () { return window.blocFeuilles() || '<div class="notice">Aucune rue avec arbres. Ouvre la fiche d\'une rue et coche « Rue avec arbres ».</div>'; };
  document.getElementById('view').addEventListener('click', e => {
    if (!e.target.closest('[data-feuilles-voir]')) return;
    ui.suiviVue = 'feuilles';
    const b = document.querySelector('nav.tabs [data-tab="historique"]'); if (b) b.click(); else rendre();
  });

  // « Ajouter à mon agenda » : fichier .ics (l'agenda du téléphone l'ouvre), rappel 3 jours avant
  const icsTxt = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  document.getElementById('view').addEventListener('click', e => {
    const b = e.target.closest('[data-ics]'); if (!b) return;
    const s = Feuilles.previsions().semaines.find(x => x.lundi === b.dataset.ics); if (!s) return;
    const ymd = d => d.replace(/-/g, '');
    const titre = 'Feuilles : prévoir coordonné ou pompage (estimation)';
    const desc = `Semaine du ${fmtJour(s.lundi)} au ${fmtJour(s.vendredi)}. Rues : ${nomsGroupes(s.ids).join(', ')}. Estimation d'après la météo, à confirmer.`;
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Helping Hand//FR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:feuilles-${s.lundi}-${Date.now()}@helpinghand`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${ymd(s.premier)}`, `DTEND;VALUE=DATE:${ymd(addJours(s.premier, 1))}`,
      `SUMMARY:${icsTxt(titre)}`, `DESCRIPTION:${icsTxt(desc)}`,
      'BEGIN:VALARM', 'TRIGGER:-P3D', 'ACTION:DISPLAY', `DESCRIPTION:${icsTxt(titre)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a'); a.href = url; a.download = `feuilles-${s.premier}.ics`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Fichier agenda créé : ouvre-le pour l\'ajouter à ton agenda.');
  });

  // réglage « Affichage des feuilles » (Réglages) : simple par défaut
  document.getElementById('view').addEventListener('click', e => {
    const b = e.target.closest('[data-fmode]'); if (!b) return;
    state.feuilles.mode = b.dataset.fmode; persist(); rendre();
    toast(state.feuilles.mode === 'simple' ? 'Affichage des feuilles : simple.' : 'Affichage des feuilles : complet.');
  });

  window.blocFeuilles = function () {
    Feuilles.invalider();
    const ids = Feuilles.rues(); if (!ids.length) return '';
    const sem = Feuilles.semaine();
    const rows = ids.map(id => ({ id, s: Feuilles.statut(id) })).sort((a, b) => b.s.pct - a.s.pct);
    const bande = sem.map(j => {
      const n = Feuilles.niveau(j.x);
      const cl = n === 'très forte' ? 'tres-forte' : n;
      const vent = j.vent ? `<i class="vent">vent ${Math.round(j.vent)}</i>` : '';
      return `<div class="fj ${cl}"><span>${JOURS_COURTS[new Date(toUTC(j.d)).getUTCDay()]} ${+j.d.slice(8)}</span><b>${n === 'très forte' ? '+++' : n === 'forte' ? '++' : n === 'moyenne' ? '+' : '·'}</b>${j.gel ? '<i class="gel">GEL</i>' : ''}${vent}</div>`;
    }).join('');
    const sec = sem.some(j => j.seche);
    let h = `<h2>Feuilles mortes <span class="muted">(${ids.length} rue${ids.length > 1 ? 's' : ''} avec arbres)</span></h2>
      ${Feuilles.modeSimple() ? '' : `<div class="fsem">${bande}</div>`}
      ${sec ? '<div class="notice" style="margin:8px 0"><strong>Été sec</strong> : quelques feuilles peuvent tomber avec la sécheresse et le vent. Rien d\'alarmant (estimation).</div>' : ''}
      ${Feuilles.modeSimple() ? '' : '<p class="muted small" style="margin:4px 0 8px">Chute estimée par jour travaillé : · faible, + moyenne, ++ forte, +++ très forte.</p>'}`;
    // alerte avaloirs : forte pluie à venir alors que des feuilles se sont accumulées
    const today = aujourdhui();
    const pluie = [0, 1, 2, 3].map(k => addJours(today, k)).find(d => { const j = meteo.jours[d]; return j && (d === today || j.prev) && (j.pluie || 0) >= 10; });
    const chargees = rows.filter(r => r.s.pct >= 0.7);
    if (pluie && chargees.length) h += `<div class="notice warn"><strong>Risque d'avaloirs bouchés</strong> : forte pluie prévue le ${fmtJour(pluie)} (${virgule(meteo.jours[pluie].pluie)} mm) alors que des feuilles se sont accumulées sur ${chargees.map(r => esc(nomR(r.id))).join(', ')}. Un ramassage avant la pluie limite le risque.</div>`;
    h += blocPrevision();
    h += `<div class="list">${rows.map(({ id, s }) => {
      const droite = s.etat === 'stop' ? '<span class="muted small">Plus de feuilles</span>' : s.etat === 'afaire' ? '<span class="tag">À ramasser</span>' : s.echeance ? `<span class="n"${s.etat === 'bientot' ? ' style="font-weight:700"' : ''}>${ecartJours(today, s.echeance) <= 15 ? fmtJour(s.echeance) : fmtDateCourt(s.echeance)}</span>` : '—';
      return `<div class="rue" data-rue="${id}" role="button" tabindex="0"><div class="main"><div class="nom">${esc(nomR(id))}</div>
        <div class="meta">${s.etat === 'stop' ? `suivi coupé · reprise le ${fmtJour(s.reprise)}` : ''}${s.etat === 'stop' ? '' : s.dernier ? `dernier ramassage le ${fmtJM(s.dernier)}` : 'aucun ramassage connu'} · ${Math.round(s.pct * 100)} %</div></div>
        <div class="right">${droite}</div></div>`;
    }).join('')}</div>`;
    return h;
  };

  // section dans la fiche d'une rue
  window.blocFeuillesRue = function (id) {
    const oui = Feuilles.estRue(id);
    let h = `<h3 style="font-size:15px;margin:14px 0 6px">Feuilles mortes</h3>
      <label class="dict-item" style="cursor:pointer"><input type="checkbox" data-feuilles="${id}" ${oui ? 'checked' : ''}><span class="grow">Rue avec arbres (suivi des feuilles)</span></label>`;
    if (oui && Feuilles.stoppee(id)) {
      h += `<p class="small" style="margin:6px 0 0"><strong>Plus de feuilles sur les arbres.</strong> Suivi coupé, il reprend tout seul le ${fmtJour(Feuilles.reprise(state.feuilles.stop[id]))}.</p>
        <button class="btn" type="button" data-feuilles-stop="${id}" data-oui="0" style="margin-top:6px">Reprendre le suivi maintenant</button>`;
    } else if (oui) {
      const s = Feuilles.statut(id);
      h += `<p class="small" style="margin:6px 0 0">${s.dernier ? `Dernier ramassage : ${fmtDate(s.dernier)}` : 'Aucun ramassage connu (compté sur 3 semaines)'} · feuilles accumulées : <strong>${Math.round(s.pct * 100)} %</strong>
        ${s.etat === 'afaire' ? ' — <strong>à ramasser</strong>' : s.echeance ? ` — prochain ramassage conseillé le ${fmtJour(s.echeance)}` : ''}</p>
        <button class="btn" type="button" data-feuilles-stop="${id}" data-oui="1" style="margin-top:6px">Plus de feuilles sur les arbres</button>`;
    }
    return h;
  };

  document.getElementById('drBody').addEventListener('click', e => {
    const b = e.target.closest('[data-feuilles-stop]'); if (!b) return;
    const oui = b.dataset.oui === '1', id = b.dataset.feuillesStop;
    Feuilles.stopper(id, oui);
    toast(oui ? `Suivi des feuilles coupé jusqu'au ${fmtJour(Feuilles.reprise(state.feuilles.stop[id]))}.` : 'Suivi des feuilles repris.');
    rendre();
    if (typeof ouvrirRue === 'function') ouvrirRue(id);
  });

  document.getElementById('drBody').addEventListener('change', e => {
    const c = e.target.closest('[data-feuilles]'); if (!c) return;
    Feuilles.basculer(c.dataset.feuilles, c.checked);
    toast(c.checked ? 'Rue ajoutée au suivi des feuilles.' : 'Rue retirée du suivi des feuilles.');
    rendre();
    if (typeof ouvrirRue === 'function') ouvrirRue(c.dataset.feuilles);
  });
})();
