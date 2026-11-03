/* Helping Hand — prévision de l'herbe par semaine (Suivi > Herbe).
   Reprend la date de repousse de chaque rue (statutRue, calcul existant : températures, pluie, état constaté)
   et les regroupe par semaine de travail (lundi → vendredi), sur 3 semaines. Estimation : au-delà de 16 jours,
   la météo vient des moyennes de saison. */
'use strict';

(() => {
  const JOURS3 = 21;
  const dow = d => new Date(toUTC(d)).getUTCDay();
  const delai = n => n <= 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`;
  const classeCouleur = n => n <= 0 ? 'rouge' : n <= 3 ? 'orange' : n <= 10 ? 'jaune' : 'bleu';

  // rues déjà prévues au planning (à partir d'aujourd'hui) pour un type d'intervention : { rueId → date la plus proche }
  window.dejaPrevu = function (estType) {
    const today = aujourdhui(), m = {};
    (state.planning || []).forEach(p => {
      if (p.statut !== 'prevu' || p.date < today || !estType(p)) return;
      (p.rueIds || []).forEach(id => { if (!m[id] || p.date < m[id]) m[id] = p.date; });
    });
    return m;
  };
  const jourCourt = d => `${JOURS_COURTS[dow(d)]} ${fmtJM(d)}`;
  const nomR = r => r.voie + (r.troncon ? ` (${r.troncon})` : '');

  function calcul() {
    const today = aujourdhui(), rues = secteur()?.rues || [], prevus = dejaPrevu(p => Planning.estHerbe(p));
    const retard = [], sem = new Map();
    rues.forEach(r => {
      const s = statutRue(r); if (!s || s.statut === 'inconnu') return;
      const item = { r, classe: r.classe, deja: prevus[r.id] || null };
      if (s.statut === 'retard') { retard.push(item); return; }
      if (s.jours == null || s.jours > JOURS3) return;
      let d = s.echeance, w = dow(d);
      if (w === 6) d = addJours(d, -1); else if (w === 0) d = addJours(d, -2); // week-end : on agit avant, le vendredi
      if (d < today) d = today;
      w = dow(d);
      const lundi = addJours(d, -((w + 6) % 7));
      const g = sem.get(lundi) || { lundi, vendredi: addJours(lundi, 4), premier: d, items: [] };
      if (d < g.premier) g.premier = d;
      g.items.push(item); sem.set(lundi, g);
    });
    const tri = l => l.sort((a, b) => b.classe - a.classe || a.r.voie.localeCompare(b.r.voie, 'fr'));
    const semaines = [...sem.values()].sort((a, b) => a.lundi < b.lundi ? -1 : 1).map(g => ({ ...g, items: tri(g.items), delta: ecartJours(today, g.premier) }));
    return { retard: tri(retard), semaines };
  }

  const liste = items => `<details><summary>Voir les rues</summary><ul class="small">${items.map(x => `<li>${esc(nomR(x.r))} <span class="muted">(classe ${x.classe})</span>${x.deja ? ` <strong>· déjà prévu ${esc(jourCourt(x.deja))}</strong>` : ''}</li>`).join('')}</ul></details>`;
  const resume = items => {
    const c5 = items.filter(x => x.classe === 5).length, dj = items.filter(x => x.deja).length;
    return `<strong>${items.length} rue${items.length > 1 ? 's' : ''}</strong>${c5 ? ` dont ${c5} en classe 5` : ''}${dj ? ` · <strong>${dj} déjà prévue${dj > 1 ? 's' : ''}</strong>` : ''}`;
  };
  // petite mention si de la pluie est prévue pendant la semaine (le rotofil est souvent annulé)
  const pluieSemaine = g => {
    for (let k = 0; k < 5; k++) {
      const d = addJours(g.lundi, k), a = typeof alerteMeteo === 'function' ? alerteMeteo(d) : null;
      if (a && /pluie/i.test(a.titre)) return `Pluie prévue ${JOURS_COURTS[dow(d)]} ${fmtJM(d)}`;
    }
    return '';
  };

  window.blocHerbePrevision = function () {
    const c = calcul(); window.__herbe = c;
    let h = `<h3 class="fp-titre">Prévision sur 3 semaines <span class="fp-est">estimation</span></h3>`;
    if (c.retard.length) h += `<div class="fprev c-rouge"><div class="fp-tete"><b>En retard maintenant</b><span class="fp-delai">aujourd'hui</span></div>
      <div>Prévoir rotofil</div><div class="small">${resume(c.retard)}</div>${liste(c.retard)}
      <button class="btn" type="button" data-herbe-plan="retard" style="margin-top:8px">Ajouter au planning</button></div>`;
    h += c.semaines.map(g => {
      const pl = pluieSemaine(g);
      return `<div class="fprev c-${classeCouleur(g.delta)}"><div class="fp-tete"><b>Semaine du ${fmtJour(g.lundi)} au ${fmtJour(g.vendredi)}</b><span class="fp-delai">${delai(g.delta)}</span></div>
      <div>Prévoir rotofil</div><div class="small">${resume(g.items)}</div>
      ${pl ? `<div class="small">${esc(pl)} : le rotofil peut être annulé.</div>` : ''}
      ${g.delta > 10 ? '<div class="muted small">À confirmer : prévision lointaine</div>' : ''}
      ${liste(g.items)}
      <button class="btn" type="button" data-herbe-plan="${g.lundi}" style="margin-top:8px">Ajouter au planning</button></div>`;
    }).join('');
    if (!c.retard.length && !c.semaines.length) h += '<p class="muted small" style="margin:0 0 8px">Rien à prévoir sur les 3 prochaines semaines (estimation). L\'herbe ne pousse presque pas en ce moment.</p>';
    return h;
  };

  document.getElementById('view').addEventListener('click', e => {
    const b = e.target.closest('[data-herbe-plan]'); if (!b || typeof ouvrirSaisie !== 'function') return;
    const c = window.__herbe || {}, cle = b.dataset.herbePlan;
    const items = cle === 'retard' ? c.retard : ((c.semaines || []).find(x => x.lundi === cle) || {}).items;
    const g = (c.semaines || []).find(x => x.lundi === cle);
    if (items) ouvrirSaisie({ mode: 'prevu', rueIds: items.map(x => x.r.id), inter: ['rotofil'], date: g ? g.premier : undefined });
  });

  // bouton de l'Accueil : va dans Suivi > Herbe
  document.getElementById('view').addEventListener('click', e => {
    if (!e.target.closest('[data-herbe-voir]')) return;
    ui.suiviVue = 'passages';
    const b = document.querySelector('nav.tabs [data-tab="historique"]'); if (b) b.click(); else rendre();
  });
})();
