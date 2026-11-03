/* Helping Hand — sauvegarde complète des données de cet appareil.
   Les données ne sont que dans le navigateur : sans sauvegarde, tout est perdu si on vide les données ou change de téléphone.
   Le fichier contient : passages d'herbe, planning, interventions du tableau importé, réglages (herbe, feuilles, alertes), agents ajoutés, carnet (contacts, notes) si la case est cochée.
   Envoi par le menu de partage d'Android (mail, Drive…) : aucun serveur, rien ne passe par le dépôt. */
'use strict';

const Sauvegarde = (() => {
  const REGEX_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const JOURS_RAPPEL = 90; // rappel tous les 3 mois

  function periode() {
    const dates = [
      ...(state.passages || []).map(p => p.date), ...(state.planning || []).map(p => p.dateRealise || p.date),
      ...(state.interventions || []).map(l => l.date),
    ].filter(d => REGEX_DATE.test(d || '')).sort();
    return dates.length ? { du: dates[0], au: dates[dates.length - 1] } : null;
  }
  const nbDonnees = () => (state.passages || []).length + (state.planning || []).length + (state.interventions || []).length + ((state.carnet && (state.carnet.contacts.length + state.carnet.notes.length)) || 0);

  function fabriquer() {
    const per = periode(), today = aujourdhui();
    const data = {
      app: 'helping-hand', version: VERSION, exporteLe: new Date().toISOString(), periode: per,
      passages: state.passages, planning: state.planning || [], interventions: state.interventions || [], importTableau: state.importTableau || null,
      reglages: state.reglages, feuilles: state.feuilles || null, alertes: state.alertes || null, agentsManuels: state.agentsManuels || '',
      carnet: state.sauvegardeCarnet === false ? null : (state.carnet || null),
      auteur: state.auteur || '', equipe: state.equipe || '', secteurId: state.secteurId || null,
    };
    const nom = `helping-hand-sauvegarde_${today}${per ? `_donnees-du-${per.du}-au-${per.au}` : ''}.json`;
    return { data, nom, texte: JSON.stringify(data) };
  }
  function marquer() {
    state.sauvegarde = { le: Date.now(), jour: aujourdhui(), periode: periode() };
    persist(); rendre();
  }

  // télécharge le fichier (secours quand le partage n'est pas possible)
  function exporter() {
    const { nom, texte } = fabriquer();
    telecharger(nom, texte, 'application/json');
    marquer();
    toast('Sauvegarde téléchargée : garde-la sur l\'ordinateur du travail.');
  }
  // menu de partage d'Android (mail, Drive, WhatsApp…) ; sinon téléchargement
  async function envoyer() {
    const { nom, texte, data } = fabriquer();
    const per = data.periode ? `données du ${fmtDate(data.periode.du)} au ${fmtDate(data.periode.au)}` : 'aucune donnée';
    for (const type of ['application/json', 'text/plain']) {
      try {
        const fichier = new File([texte], nom, { type });
        if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
          await navigator.share({ files: [fichier], title: 'Sauvegarde Helping Hand', text: `Sauvegarde Helping Hand du ${fmtDate(aujourdhui())} (${per}).` });
          marquer(); toast('Sauvegarde envoyée.'); return;
        }
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    exporter();
  }

  // fusion d'un fichier de sauvegarde : on ajoute ce qui manque, sans rien écraser
  function restaurer(data) {
    if (!data || !Array.isArray(data.passages)) throw new Error('format');
    const ajout = (liste, cle, cible) => {
      const connus = new Set(cible.map(x => cle(x)));
      const neufs = (liste || []).filter(x => x && cle(x) != null && !connus.has(cle(x)));
      cible.push(...neufs); return neufs.length;
    };
    state.planning = state.planning || []; state.interventions = state.interventions || [];
    const nP = ajout(data.passages.filter(p => p && p.rueId && REGEX_DATE.test(p.date || '')), p => p.id, state.passages);
    const nPl = ajout(data.planning, p => p.id, state.planning);
    const nI = ajout(data.interventions, l => l.cle || l.id, state.interventions);
    if (!state.importTableau && data.importTableau) state.importTableau = data.importTableau;
    if (data.reglages && confirm('Reprendre aussi les réglages de la sauvegarde (herbe, feuilles, alertes, agents) ? « Annuler » garde ceux de cet appareil.')) {
      state.reglages = Object.assign({}, state.reglages, data.reglages);
      if (data.feuilles) state.feuilles = Object.assign({}, state.feuilles || {}, data.feuilles);
      if (data.alertes) state.alertes = Object.assign({}, state.alertes || {}, data.alertes);
      if (data.agentsManuels) state.agentsManuels = data.agentsManuels;
    }
    let nC = 0, nN = 0;
    if (data.carnet) {
      state.carnet = state.carnet || { contacts: [], notes: [] };
      nC = ajout(data.carnet.contacts, c => c.id, state.carnet.contacts);
      nN = ajout(data.carnet.notes, n => n.id, state.carnet.notes);
    }
    persist(); invalider(); rendre();
    toast(`Ajouté : ${nP} passage(s), ${nPl} intervention(s), ${nI} ligne(s) du tableau${data.carnet ? `, ${nC} contact(s), ${nN} note(s)` : ''}.`);
  }

  function joursDepuis() { return state.sauvegarde ? ecartJours(state.sauvegarde.jour, aujourdhui()) : null; }
  // rappel : jamais sauvegardé (et des données existent), ou plus de 3 mois
  function aRappeler() {
    if (nbDonnees() === 0) return false;
    const n = joursDepuis();
    return n == null || n >= JOURS_RAPPEL;
  }

  function bloc() {
    const s = state.sauvegarde, n = joursDepuis(), per = periode();
    const ligne = s
      ? `<strong>Dernière sauvegarde : le ${fmtDate(s.jour)}</strong>${s.periode ? ` (données du ${fmtDate(s.periode.du)} au ${fmtDate(s.periode.au)})` : ''}${n >= JOURS_RAPPEL ? ' — <strong>à refaire</strong>' : ''}`
      : '<strong>Aucune sauvegarde faite sur cet appareil.</strong>';
    return `<p class="small" style="margin-top:0">Tes données sont enregistrées <strong>sur cet appareil uniquement</strong> (dans ce navigateur). Si tu vides les données ou changes de téléphone, elles sont perdues.
      Fais une sauvegarde tous les 3 mois et garde-la sur l'ordinateur du travail. Elle contient tout : passages, planning, tableau importé, réglages, et le carnet (contacts et notes) si la case ci-dessous est cochée.</p>
      <label class="dict-item" style="cursor:pointer;margin-bottom:10px"><input type="checkbox" data-sauv-carnet ${state.sauvegardeCarnet === false ? '' : 'checked'}><span class="grow">Inclure le carnet (contacts, notes) dans la sauvegarde</span></label>
      <div class="notice${aRappeler() ? ' warn' : ''}" style="margin:0 0 10px">${ligne}${per ? `<br><span class="muted small">Sur cet appareil : données du ${fmtDate(per.du)} au ${fmtDate(per.au)}.</span>` : ''}</div>`;
  }

  document.getElementById('view').addEventListener('change', e => {
    const c = e.target.closest('[data-sauv-carnet]'); if (!c) return;
    state.sauvegardeCarnet = c.checked; persist();
  });

  return { exporter, envoyer, restaurer, aRappeler, joursDepuis, bloc, periode };
})();
