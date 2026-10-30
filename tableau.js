/* Suivi désherbage — import du tableau de suivi Excel et onglet « Suivi ».
   Le fichier est lu DANS LE NAVIGATEUR : il n'est envoyé nulle part.
   Le tableau reste la source : chaque import remplace le précédent (pas de doublons). */
'use strict';

/* ================= Lecture et analyse (sans interface) ================= */
const Tableau = (() => {
  const N = s => Dictee.norm(s);
  const COLONNES = {
    n: ['n', 'no', 'num', 'numero'], date: ['date'], type: ['type'], lieu: ['lieu', 'lieux', 'rue', 'rues', 'adresse'],
    intervention: ['intervention', 'travaux'], materiel: ['materiel'], poches: ['poches', 'nb poches', 'nombre de poches'],
    agents: ['agents', 'equipe', 'agent'], statut: ['statut', 'etat d avancement'], observations: ['observations', 'remarques', 'commentaire'],
  };

  function trouverEntete(lignes) {
    for (let i = 0; i < Math.min(lignes.length, 30); i++) {
      const cells = (lignes[i] || []).map(c => N(c));
      if (!cells.includes('date')) continue;
      const idx = {};
      for (const [cle, noms] of Object.entries(COLONNES)) {
        const j = cells.findIndex(c => noms.includes(c));
        if (j >= 0) idx[cle] = j;
      }
      // colonne d'état de l'herbe (facultative) : « État herbe avant », « État avant passage »…
      const je = cells.findIndex(c => c.startsWith('etat') && c !== 'etat d avancement');
      if (je >= 0) idx.etat = je;
      if (idx.lieu != null) return { ligne: i, idx };
    }
    return null;
  }

  const pad = n => String(n).padStart(2, '0');
  function lireDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && window.XLSX) {
      const d = XLSX.SSF.parse_date_code(v);
      if (d && d.y) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    }
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
    const m = String(v).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
    const m2 = String(v).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m2 ? m2[0] : null;
  }
  function lireStatut(v) {
    const n = N(v);
    if (n.startsWith('realis') || n === 'fait' || n === 'termine') return 'realise';
    if (n.startsWith('prev')) return 'prevu';
    if (n.startsWith('en cours')) return 'encours';
    if (n.startsWith('report')) return 'reporte';
    if (n.startsWith('annul')) return 'annule';
    return n ? 'autre' : '';
  }
  function lireEtat(v) {
    const n = N(v);
    if (n.includes('beaucoup')) return 'beaucoup';
    if (n.includes('peu')) return 'peu';
    if (n.includes('propre')) return 'propre';
    return '';
  }
  function lirePoches(v) {
    if (typeof v === 'number') return v;
    const m = String(v ?? '').match(/\d+/);
    return m ? +m[0] : null;
  }

  function rattacher(lieu, sect) {
    let texte = String(lieu || '');
    const n = ' ' + N(texte) + ' ';
    const zones = (sect.zones || []).filter(z => z.motifs.some(m => n.includes(N(m)))).map(z => z.nom);
    for (const a of sect.alias || []) if (a.motifs.some(m => n.includes(' ' + N(m) + ' '))) texte += ', ' + a.voie;
    const r = Dictee.analyser(texte, sect.rues, '2000-01-01');
    const connus = [...(sect.zones || []).flatMap(z => z.motifs), ...(sect.alias || []).flatMap(a => a.motifs)].map(N);
    const nonTrouves = r.nonTrouves.filter(t => !connus.some(m => t.includes(m) || m.includes(t)));
    return { rueIds: r.rues.map(x => x.id), ambigus: r.ambigus.map(l => l.map(x => x.voie)), nonTrouves, zones };
  }

  // lignes de tableur (tableau de tableaux) -> interventions
  function analyser(lignes, sect) {
    const ent = trouverEntete(lignes);
    if (!ent) return { erreur: 'Je ne trouve pas la ligne d\'en-tête (il faut au moins les colonnes « Date » et « Lieu »).' };
    const { idx } = ent, sortie = [];
    const v = (row, k) => idx[k] != null ? row[idx[k]] : null;
    for (let i = ent.ligne + 1; i < lignes.length; i++) {
      const row = lignes[i] || [];
      const date = lireDate(v(row, 'date'));
      const lieu = v(row, 'lieu');
      if (!date || !lieu) continue;
      const type = String(v(row, 'type') ?? '').trim();
      const materiel = String(v(row, 'materiel') ?? '').trim();
      const intervention = String(v(row, 'intervention') ?? '').trim();
      const n = v(row, 'n');
      const rat = rattacher(lieu, sect);
      sortie.push({
        cle: `${n ?? 'L' + (i + 1)}|${date}`, n: n ?? null, ligneExcel: i + 1, date,
        type, lieu: String(lieu).trim(), intervention, materiel,
        poches: lirePoches(v(row, 'poches')), agents: String(v(row, 'agents') ?? '').trim(),
        statut: lireStatut(v(row, 'statut')), statutTexte: String(v(row, 'statut') ?? '').trim(),
        observations: String(v(row, 'observations') ?? '').trim(),
        etat: lireEtat(v(row, 'etat')),
        herbe: /rotofil/.test(N(type) + ' ' + N(materiel) + ' ' + N(intervention)),
        ...rat,
      });
    }
    return { interventions: sortie, colonneEtat: idx.etat != null, colonnes: Object.keys(idx) };
  }

  // choisit la feuille qui contient l'en-tête (de préférence « Interventions »)
  function lireClasseur(wb, sect) {
    const noms = [...wb.SheetNames].sort((a, b) => (N(b).includes('intervention') ? 1 : 0) - (N(a).includes('intervention') ? 1 : 0));
    for (const nom of noms) {
      const lignes = XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null });
      const r = analyser(lignes, sect);
      if (!r.erreur) return { ...r, feuille: nom };
    }
    return { erreur: 'Aucune feuille du fichier ne ressemble au tableau de suivi (colonnes « Date » et « Lieu » introuvables).' };
  }

  return { analyser, lireClasseur, rattacher };
})();
if (typeof module !== 'undefined') module.exports = Tableau;

/* ================= Interface ================= */
if (typeof document !== 'undefined' && document.getElementById('view')) (() => {
  const $ = s => document.querySelector(s);
  const TYPES_COURTS = s => s || 'Autre';
  const STATUTS_TXT = { realise: 'Réalisé', prevu: 'Prévu', encours: 'En cours', reporte: 'Reporté', annule: 'Annulé', autre: '?', '': '—' };
  state.interventions = state.interventions || [];
  ui.suiviVue = ui.suiviVue || (state.interventions.length ? 'recap' : 'passages');

  // fichier + fenêtre d'aperçu créés ici pour ne pas alourdir index.html
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx,.xls,.ods,.csv', hidden: true });
  document.body.appendChild(input);
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="dlg-head"><h3>Import du tableau de suivi</h3><button class="x" data-ferme aria-label="Fermer">×</button></div>
    <div class="dlg-body" id="impBody"></div>
    <div class="dlg-foot"><button class="btn" data-ferme>Annuler</button><button class="btn primary" id="impOk">Importer</button></div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('click', e => { if (e.target.closest('[data-ferme]')) dlg.close(); });

  function chargerXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = 'xlsx.full.min.js';
      s.onload = ok; s.onerror = () => ko(new Error('lecteur Excel introuvable'));
      document.head.appendChild(s);
    });
  }

  let enAttente = null;
  input.addEventListener('change', async () => {
    const f = input.files[0]; input.value = ''; if (!f) return;
    try {
      await chargerXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const r = Tableau.lireClasseur(wb, secteur());
      if (r.erreur) { toast(r.erreur); return; }
      enAttente = { ...r, fichier: f.name };
      apercu(enAttente);
    } catch (e) { toast('Impossible de lire ce fichier (' + (e.message || e) + ').'); }
  });

  const nomsRues = ids => ids.map(id => rueParId(id)?.voie).filter(Boolean);
  function apercu(r) {
    const today = aujourdhui(), L = r.interventions;
    const herbe = L.filter(l => l.herbe && l.statut === 'realise' && l.date <= today);
    const ruesHerbe = new Set(herbe.flatMap(l => l.rueIds));
    const prevuPasses = L.filter(l => l.statut === 'prevu' && l.date < today);
    const ambi = L.filter(l => l.ambigus.length), non = L.filter(l => l.nonTrouves.length), zones = [...new Set(L.flatMap(l => l.zones))];
    const sansRue = L.filter(l => !l.rueIds.length && !l.zones.length);
    let h = `<p style="margin-top:0"><strong>${esc(r.fichier)}</strong> · feuille « ${esc(r.feuille)} »</p>
      <dl class="kv">
        <dt>Lignes lues</dt><dd>${L.length}</dd>
        <dt>Rues reconnues</dt><dd>${new Set(L.flatMap(l => l.rueIds)).size} rues différentes</dd>
        <dt>Rotofil réalisé</dt><dd>${herbe.length} intervention${herbe.length > 1 ? 's' : ''} → <strong>${ruesHerbe.size} rue${ruesHerbe.size > 1 ? 's' : ''}</strong> mises à jour pour la prédiction</dd>
        ${zones.length ? `<dt>Zones</dt><dd>${zones.map(esc).join(', ')} <span class="muted">(suivies, sans prédiction)</span></dd>` : ''}
      </dl>`;
    if (!r.colonneEtat) h += `<div class="notice">Pas de colonne « État herbe avant » : les passages comptent, mais l'appli ne peut pas encore apprendre rue par rue.</div>`;
    if (prevuPasses.length) h += `<div class="notice warn"><strong>${prevuPasses.length} ligne${prevuPasses.length > 1 ? 's' : ''} « Prévu » avec une date passée</strong> (non comptée${prevuPasses.length > 1 ? 's' : ''}) : ${prevuPasses.map(l => `n°${esc(l.n ?? '?')} du ${fmtJM(l.date)}`).join(', ')}. À passer en Réalisé, Reporté ou Annulé dans le tableau.</div>`;
    if (ambi.length) h += `<div class="notice warn"><strong>À préciser dans le tableau</strong> (nom incomplet) :<br>${ambi.map(l => `n°${esc(l.n ?? '?')} : ${l.ambigus.map(a => esc(a.join(' ou '))).join(' ; ')}`).join('<br>')}</div>`;
    if (sansRue.length) h += `<div class="notice warn"><strong>Aucune rue reconnue</strong> : ${sansRue.map(l => `n°${esc(l.n ?? '?')} « ${esc(l.lieu.slice(0, 60))} »`).join(', ')}</div>`;
    if (non.length) h += `<p class="muted small">Mots ignorés (repères, pas des rues) : ${[...new Set(non.flatMap(l => l.nonTrouves))].map(t => '« ' + esc(t) + ' »').join(', ')}</p>`;
    h += `<p class="small" style="margin-bottom:0">L'import <strong>remplace</strong> le précédent : tu peux réimporter ton tableau à chaque mise à jour, sans doublons. Les passages saisis dans l'appli (dictée, cases à cocher) sont conservés.</p>`;
    $('#impBody').innerHTML = h;
    dlg.showModal();
  }

  dlg.querySelector('#impOk').addEventListener('click', () => {
    if (!enAttente) return;
    const today = aujourdhui(), r = enAttente;
    state.interventions = r.interventions;
    state.passages = state.passages.filter(p => p.source !== 'tableau');
    let n = 0;
    r.interventions.forEach(l => {
      if (!(l.herbe && l.statut === 'realise' && l.date <= today)) return;
      l.rueIds.forEach(rueId => {
        state.passages.push({ id: `tb-${l.cle}-${rueId}`, rueId, date: l.date, etat: l.etat || '', equipe: l.agents, remarque: l.intervention, auteur: '', creeLe: Date.now(), source: 'tableau', ref: l.n });
        n++;
      });
    });
    state.importTableau = { fichier: r.fichier, le: Date.now(), lignes: r.interventions.length, passages: n };
    persist(); invalider();
    dlg.close(); enAttente = null;
    toast(`Tableau importé : ${r.interventions.length} lignes, ${n} passage${n > 1 ? 's' : ''} rotofil.`);
    if (besoinArchive()) majMeteo();
    ui.suiviVue = 'recap';
    rendre();
  });

  /* ---------- Onglet « Suivi » ---------- */
  function recap() {
    const today = aujourdhui();
    const lignes = new Map();
    const ajouter = (cle, nom, rueId, l) => {
      if (!lignes.has(cle)) lignes.set(cle, { nom, rueId, n: 0, encours: false, dernier: null, rotofil: null, poches: 0, types: {} });
      const x = lignes.get(cle);
      if (l.statut === 'encours') x.encours = true;
      if (l.statut !== 'realise' || l.date > today) return;
      x.n++; x.types[TYPES_COURTS(l.type)] = (x.types[TYPES_COURTS(l.type)] || 0) + 1;
      if (!x.dernier || l.date > x.dernier) x.dernier = l.date;
      if (l.herbe && (!x.rotofil || l.date > x.rotofil)) x.rotofil = l.date;
      if (l.poches) x.poches += l.poches;
    };
    for (const l of state.interventions) {
      const vus = new Set(); // une voie en plusieurs tronçons ne compte qu'une fois par intervention
      l.rueIds.forEach(id => { const r = rueParId(id); if (r && !vus.has(r.voie)) { vus.add(r.voie); ajouter(r.voie, r.voie, id, l); } });
      l.zones.forEach(z => ajouter('zone:' + z, z, null, l));
    }
    return [...lignes.values()].sort((a, b) => (b.dernier || '').localeCompare(a.dernier || '') || a.nom.localeCompare(b.nom, 'fr'));
  }

  function vueRecap() {
    const L = state.interventions, today = aujourdhui();
    if (!L.length) return `<div class="notice">Aucun tableau importé. <button class="btn" data-act="importTableau">Importer mon tableau de suivi</button></div>`;
    const rows = recap();
    const parType = {};
    L.filter(l => l.statut === 'realise' && l.date <= today).forEach(l => { parType[TYPES_COURTS(l.type)] = (parType[TYPES_COURTS(l.type)] || 0) + 1; });
    const prevuPasses = L.filter(l => l.statut === 'prevu' && l.date < today);
    let h = '';
    if (prevuPasses.length) h += `<div class="notice warn"><strong>À mettre à jour dans le tableau :</strong> ${prevuPasses.map(l => `n°${esc(l.n ?? '?')} (${fmtJM(l.date)}, ${esc(l.type || 'intervention')})`).join(', ')} — encore « Prévu » alors que la date est passée.</div>`;
    h += `<p class="muted small" style="margin:0 0 8px">Interventions réalisées par type : ${Object.entries(parType).map(([t, n]) => `${esc(t)} ${n}`).join(' · ') || 'aucune'}</p>`;
    h += `<div class="list">${rows.map(x => {
      const meta = [`${x.n} passage${x.n > 1 ? 's' : ''}`, x.dernier ? `dernier le ${fmtJM(x.dernier)}` : 'aucun réalisé', x.rotofil ? `rotofil le ${fmtJM(x.rotofil)}` : null, x.poches ? `${x.poches} poche${x.poches > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ');
      return `<div class="rue" ${x.rueId ? `data-rue="${x.rueId}" role="button" tabindex="0"` : ''}>
        <div class="main"><div class="nom">${esc(x.nom)}</div><div class="meta">${meta}</div></div>
        <div class="right">${x.encours ? '<span class="chip">Récurrent</span>' : (x.rueId ? '' : '<span class="muted small">zone</span>')}</div></div>`;
    }).join('')}</div>`;
    return h;
  }

  function vueJournal() {
    const L = [...state.interventions].sort((a, b) => b.date.localeCompare(a.date) || (b.n ?? 0) - (a.n ?? 0));
    if (!L.length) return `<div class="notice">Aucun tableau importé. <button class="btn" data-act="importTableau">Importer mon tableau de suivi</button></div>`;
    return `<div class="hist-box">${L.map(l => {
      const st = l.statut === 'realise' ? '' : ` · <strong>${esc(STATUTS_TXT[l.statut] || l.statutTexte)}</strong>`;
      return `<div class="hist-item"><div class="grow">
        <div class="small muted">${fmtJour(l.date)} · n°${esc(l.n ?? '?')} · ${esc(l.type || 'Autre')}${st}</div>
        <strong>${esc(l.lieu)}</strong>
        <div class="small">${[l.intervention, l.materiel, l.poches ? l.poches + ' poches' : null].filter(Boolean).map(esc).join(' · ')}</div>
        ${l.agents ? `<div class="small muted">${esc(l.agents)}</div>` : ''}
        ${l.observations ? `<div class="small muted">${esc(l.observations)}</div>` : ''}
      </div></div>`;
    }).join('')}</div>`;
  }

  window.rendreSuivi = function () {
    const vues = { recap: 'Récap par rue', journal: 'Journal', passages: 'Passages herbe' };
    const imp = state.importTableau;
    const tete = `<div class="seg">
      ${Object.entries(vues).map(([k, t]) => `<button class="btn${ui.suiviVue === k ? ' primary' : ''}" data-suivi="${k}">${t}</button>`).join('')}
      </div>
      <p class="muted small" style="margin:-4px 0 12px">${imp ? `Tableau « ${esc(imp.fichier)} » importé le ${new Date(imp.le).toLocaleDateString('fr-FR')} à ${new Date(imp.le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. ` : ''}<button class="btn" data-act="importTableau">${imp ? 'Réimporter le tableau' : 'Importer mon tableau de suivi'}</button></p>`;
    if (ui.suiviVue === 'passages') { rendreHistorique(); view.insertAdjacentHTML('afterbegin', tete); return; }
    view.innerHTML = tete + (ui.suiviVue === 'journal' ? vueJournal() : vueRecap());
  };

  // interventions du tableau pour une rue (affichées dans sa fiche)
  window.interventionsDeRue = function (rueId) {
    return state.interventions.filter(l => l.rueIds.includes(rueId)).sort((a, b) => b.date.localeCompare(a.date));
  };

  view.addEventListener('click', e => {
    const b = e.target.closest('[data-suivi]');
    if (b) { ui.suiviVue = b.dataset.suivi; rendre(); return; }
    if (e.target.closest('[data-act="importTableau"]')) input.click();
  });
})();
