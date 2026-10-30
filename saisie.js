/* Suivi désherbage — saisie « à cocher » (remplace la dictée vocale).
   Fait ou À prévoir → date en un toucher → interventions cochées → rues → agents → état de l'herbe.
   Ouverte depuis : la barre « + Saisir », la sélection de rues (onglet Rues), la fiche d'une rue, « + Prévoir ». */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  // interventions proposées : type pour le tableau Excel, matériel, libellé
  const INTERVENTIONS = [
    { k: 'rotofil', label: 'Rotofil (désherbage)', type: 'Rotofil herbe', mat: 'rotofil', role: 'rotofil' },
    { k: 'souffleur', label: 'Souffleur', type: 'Autre', mat: 'souffleur à dos', role: 'souffleur à dos' },
    { k: 'coordonne', label: 'Coordonné balayeuse', type: 'Coordonné balayeuse', mat: 'balayeuse', role: 'balayeuse' },
    { k: 'pompage', label: 'Pompage de feuilles', type: 'Pompage de feuilles', mat: 'gros camion', role: 'pompe' },
    { k: 'manuel', label: 'Balayage manuel', type: 'Balayage manuel', mat: 'balayage manuel', role: 'balayage manuel' },
    { k: 'encombrants', label: 'Collecte encombrants', type: 'Autre', mat: 'camion', role: 'camion' },
    { k: 'incident', label: 'Incident / urgence', type: 'Incident / urgence', mat: '', role: '' },
    { k: 'autre', label: 'Autre', type: 'Autre', mat: '', role: '' },
  ];
  // priorité pour la colonne « Type » quand plusieurs cases sont cochées
  const PRIORITE_TYPE = ['coordonne', 'pompage', 'rotofil', 'manuel', 'incident', 'encombrants', 'souffleur', 'autre'];
  const ROLES = ['', 'rotofil', 'souffleur à dos', 'balayeuse', 'micro-balayeuse', 'camion', 'chauffeur', 'balayage manuel'];

  const dlg = document.createElement('dialog');
  dlg.id = 'dlgSaisie';
  document.body.appendChild(dlg);
  let f = null; // état du formulaire

  function ouvrir(opts = {}) {
    f = {
      mode: opts.mode || 'fait', date: null, inter: new Set(opts.inter || []), rues: [...(opts.rueIds || [])],
      agents: new Map(), etat: '', obs: '', q: '',
    };
    f.date = f.mode === 'fait' ? aujourdhui() : addJours(aujourdhui(), 1);
    rendreForm();
    dlg.showModal();
  }
  window.ouvrirSaisie = ouvrir;

  const jourCourt = d => `${JOURS_COURTS[new Date(toUTC(d)).getUTCDay()]} ${fmtJM(d)}`;
  function choixDates() {
    const t = aujourdhui();
    if (f.mode === 'fait') return [[t, "Aujourd'hui"], [addJours(t, -1), 'Hier'], [addJours(t, -2), 'Avant-hier']];
    const l = [[addJours(t, 1), 'Demain']];
    for (let k = 2; l.length < 6 && k < 12; k++) { const d = addJours(t, k); if (new Date(toUTC(d)).getUTCDay() % 6) l.push([d, jourCourt(d)]); }
    return [[t, "Aujourd'hui"], ...l];
  }

  // un bouton par personne : « Michel » et « Michel Buron » ne font qu'un ;
  // le nom de famille n'est affiché que s'il y a plusieurs personnes du même prénom (Laurent d'Almeida / Laurent Pélissier)
  function agentsDispo() {
    const a = typeof Planning !== 'undefined' ? Planning.annuaire() : [];
    const groupes = {};
    a.forEach(x => { (groupes[x.prenom] = groupes[x.prenom] || []).push(x); });
    const out = [];
    for (const [prenom, l] of Object.entries(groupes)) {
      const avecNom = l.filter(x => x.nomFam);
      if (avecNom.length > 1) avecNom.forEach(x => out.push({ nom: x.complet }));
      else out.push({ nom: prenom });
    }
    return out.sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
  }

  function suggestions() {
    const rues = secteur()?.rues || [];
    const q = Dictee.norm(f.q);
    if (q) return rues.filter(r => Dictee.norm(r.voie + ' ' + r.troncon).includes(q) && !f.rues.includes(r.id)).slice(0, 8);
    // sans recherche : rues en retard puis à faire bientôt
    return rues.filter(r => !f.rues.includes(r.id)).map(r => ({ r, s: statutRue(r) }))
      .filter(x => ['retard', 'semaine', 'quinzaine'].includes(x.s.statut)).sort((a, b) => b.s.pct - a.s.pct).slice(0, 6).map(x => x.r);
  }

  function rendreForm() {
    const fait = f.mode === 'fait';
    const herbe = f.inter.has('rotofil');
    const ag = agentsDispo();
    const al = !fait && typeof alerteMeteo === 'function' ? alerteMeteo(f.date) : null;
    const nomR = id => { const r = rueParId(id); return r ? r.voie + (r.troncon ? ` (${r.troncon})` : '') : '?'; };
    const sugg = suggestions();
    dlg.innerHTML = `<div class="dlg-head"><h3>${fait ? 'Intervention faite' : 'Intervention à prévoir'}</h3><button class="x" data-ferme aria-label="Fermer">×</button></div>
    <div class="dlg-body">
      <div class="seg"><button class="btn${fait ? ' primary' : ''}" data-mode="fait" type="button">Fait</button><button class="btn${!fait ? ' primary' : ''}" data-mode="prevu" type="button">À prévoir</button></div>

      <h4 class="sx">Quand</h4>
      <div class="chips">${choixDates().map(([d, t]) => `<button type="button" class="chipbtn${f.date === d ? ' on' : ''}" data-date="${d}">${t}</button>`).join('')}
        <input type="date" id="sxDate" value="${f.date}" ${fait ? `max="${aujourdhui()}"` : `min="${aujourdhui()}"`} aria-label="Autre date"></div>
      ${al ? `<div class="notice ${al.niveau === 'fort' ? 'warn' : ''}" style="margin:8px 0 0"><strong>${esc(al.titre)}</strong> ${esc(al.detail)}</div>` : ''}

      <h4 class="sx">Quoi</h4>
      <div class="chips">${INTERVENTIONS.map(i => `<button type="button" class="chipbtn${f.inter.has(i.k) ? ' on' : ''}" data-inter="${i.k}">${i.label}</button>`).join('')}</div>

      <h4 class="sx">Où <span class="muted">(${f.rues.length})</span></h4>
      ${f.rues.length ? `<div class="chips">${f.rues.map(id => `<button type="button" class="chipbtn on" data-rmrue="${id}">${esc(nomR(id))} ×</button>`).join('')}</div>` : ''}
      <input type="search" id="sxQ" placeholder="Ajouter une rue : tape 2 ou 3 lettres…" value="${esc(f.q)}" autocomplete="off" style="width:100%;margin-top:6px">
      ${sugg.length ? `<div class="sx-sugg">${!f.q ? '<div class="muted small">À faire en priorité :</div>' : ''}${sugg.map(r => `<button type="button" class="sx-rue" data-addrue="${r.id}"><strong>${esc(r.voie)}</strong>${r.troncon ? ` <span class="muted small">${esc(r.troncon)}</span>` : ''}<span class="muted small"> · classe ${r.classe}</span></button>`).join('')}</div>` : (f.q ? '<p class="muted small">Aucune rue trouvée.</p>' : '')}

      <h4 class="sx">Qui</h4>
      ${ag.length ? `<div class="chips">${ag.map(a => `<button type="button" class="chipbtn${f.agents.has(a.nom) ? ' on' : ''}" data-agent="${esc(a.nom)}">${esc(a.nom)}</button>`).join('')}</div>` : '<p class="muted small">Aucun agent enregistré : ajoute-les ci-dessous (ou dans Réglages).</p>'}
      ${[...f.agents.entries()].map(([nom, role]) => `<label class="sx-role"><span>${esc(nom)}</span><select data-role="${esc(nom)}">${ROLES.map(r => `<option value="${r}" ${role === r ? 'selected' : ''}>${r || 'rôle (facultatif)'}</option>`).join('')}</select></label>`).join('')}
      <div class="sx-add"><input type="text" id="sxNouvel" placeholder="Nouvel agent (prénom nom)" autocomplete="off"><button type="button" class="btn" id="sxAjoutAgent">Ajouter</button></div>

      ${fait && herbe ? `<h4 class="sx">État de l'herbe en arrivant</h4>
      <div class="chips etat">${Object.entries({ propre: 'Presque propre', peu: "Un peu d'herbe", beaucoup: "Beaucoup d'herbe" }).map(([k, t]) => `<button type="button" class="chipbtn big${f.etat === k ? ' on' : ''}" data-etat="${k}">${t}</button>`).join('')}</div>` : ''}

      <h4 class="sx">Observations <span class="muted">(facultatif)</span></h4>
      <input type="text" id="sxObs" value="${esc(f.obs)}" autocomplete="off" style="width:100%">
    </div>
    <div class="dlg-foot"><button class="btn" data-ferme type="button">Annuler</button><button class="btn primary" id="sxOk" type="button">${fait ? 'Enregistrer' : 'Ajouter au planning'}${f.rues.length ? ` (${f.rues.length} rue${f.rues.length > 1 ? 's' : ''})` : ''}</button></div>`;
    const ok = dlg.querySelector('#sxOk');
    ok.disabled = !f.rues.length || !f.inter.size;
  }

  // garde la position de défilement et le focus quand on redessine
  function redessiner(focusId) {
    const body = dlg.querySelector('.dlg-body'), top = body ? body.scrollTop : 0;
    const pos = focusId ? dlg.querySelector('#' + focusId)?.selectionStart : null;
    rendreForm();
    const b2 = dlg.querySelector('.dlg-body'); if (b2) b2.scrollTop = top;
    if (focusId) { const el = dlg.querySelector('#' + focusId); if (el) { el.focus(); if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos); } }
  }

  dlg.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-ferme')) { dlg.close(); return; }
    if (t.dataset.mode) { f.mode = t.dataset.mode; f.date = f.mode === 'fait' ? aujourdhui() : addJours(aujourdhui(), 1); if (f.mode !== 'fait') f.etat = ''; redessiner(); return; }
    if (t.dataset.date) { f.date = t.dataset.date; redessiner(); return; }
    if (t.dataset.inter) { const k = t.dataset.inter; f.inter.has(k) ? f.inter.delete(k) : f.inter.add(k); redessiner(); return; }
    if (t.dataset.addrue) { if (!f.rues.includes(t.dataset.addrue)) f.rues.push(t.dataset.addrue); f.q = ''; redessiner(); return; }
    if (t.dataset.rmrue) { f.rues = f.rues.filter(id => id !== t.dataset.rmrue); redessiner(); return; }
    if (t.dataset.agent) {
      const n = t.dataset.agent;
      if (f.agents.has(n)) f.agents.delete(n);
      else { // rôle proposé d'office si une seule intervention à outil est cochée
        const outils = INTERVENTIONS.filter(i => f.inter.has(i.k) && i.role);
        f.agents.set(n, outils.length === 1 ? outils[0].role : '');
      }
      redessiner(); return;
    }
    if (t.dataset.etat) { f.etat = f.etat === t.dataset.etat ? '' : t.dataset.etat; redessiner(); return; }
    if (t.id === 'sxAjoutAgent') {
      const v = dlg.querySelector('#sxNouvel').value.trim().replace(/\s+/g, ' ');
      if (!v) return;
      const propre = v.split(' ').map(m => m ? m[0].toUpperCase() + m.slice(1) : m).join(' ');
      state.agentsManuels = [state.agentsManuels, propre].filter(Boolean).join('\n'); persist();
      f.agents.set(agentsDispo().find(a => a.nom === propre || propre.startsWith(a.nom))?.nom || propre, '');
      redessiner(); return;
    }
    if (t.id === 'sxOk') enregistrer();
  });
  dlg.addEventListener('input', e => {
    if (e.target.id === 'sxQ') { f.q = e.target.value; redessiner('sxQ'); }
    if (e.target.id === 'sxObs') f.obs = e.target.value;
  });
  dlg.addEventListener('change', e => {
    if (e.target.id === 'sxDate' && e.target.value) { f.date = e.target.value; redessiner(); }
    if (e.target.dataset.role != null) f.agents.set(e.target.dataset.role, e.target.value);
  });

  function enregistrer() {
    if (!f.rues.length || !f.inter.size) return;
    const today = aujourdhui();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) { toast('Date invalide.'); return; }
    if (f.mode === 'fait' && f.date > today) { toast('Une intervention faite ne peut pas être dans le futur.'); return; }
    if (f.mode !== 'fait' && f.date < today) { toast('Une intervention prévue doit être aujourd\'hui ou plus tard.'); return; }
    const choisies = INTERVENTIONS.filter(i => f.inter.has(i.k));
    const principale = PRIORITE_TYPE.map(k => choisies.find(i => i.k === k)).find(Boolean);
    const mats = [...new Set([...choisies.map(i => i.mat), ...[...f.agents.values()].map(r => ({ rotofil: 'rotofil', 'souffleur à dos': 'souffleur à dos', balayeuse: 'balayeuse', 'micro-balayeuse': 'micro-balayeuse', camion: 'camion' }[r]))].filter(Boolean))];
    const agents = [...f.agents.entries()].map(([n, r]) => r ? `${n} (${r})` : n).join(', ');
    const d = {
      date: f.date, type: principale.type, rueIds: f.rues, zones: [],
      intervention: choisies.map(i => i.label.replace(' (désherbage)', '')).join(' + '),
      materiel: mats.length ? mats.join(', ').replace(/^./, c => c.toUpperCase()) : '',
      agents, observations: f.obs.trim(),
    };
    if (f.mode === 'fait') Object.assign(d, { statut: 'realise', dateRealise: f.date, etat: f.inter.has('rotofil') ? f.etat : '' });
    Planning.ajouter(d);
    dlg.close();
    ui.selection.clear();
    toast(f.mode === 'fait' ? `Enregistré : ${f.rues.length} rue${f.rues.length > 1 ? 's' : ''}, ${fmtJM(f.date)}.` : `Ajouté au planning : ${jourCourt(f.date)}.`);
    rendre();
  }

  /* ---------- Barre « + Saisir » ---------- */
  const fab = $('#fabSaisir');
  function majFab() { fab.hidden = onglet === 'reglages' || !$('#selbar').hidden; }
  new MutationObserver(majFab).observe($('#selbar'), { attributes: true });
  document.querySelector('nav.tabs').addEventListener('click', () => setTimeout(majFab));
  fab.addEventListener('click', () => ouvrir({ mode: 'fait' }));
  majFab();
})();
