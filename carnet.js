/* Helping Hand — onglet « Carnet » : contacts (appel direct, SMS, e-mail, itinéraire) et notes rangées par date.
   Tout reste sur cet appareil (navigateur), jamais dans le dépôt. Pour dicter une note : micro du clavier du téléphone. */
'use strict';

const Carnet = (() => {
  state.carnet = Object.assign({ contacts: [], notes: [] }, state.carnet || {});
  const N = s => Dictee.norm(s || '');
  const tel = t => String(t || '').replace(/[^\d+]/g, '');
  const trouve = (q, ...champs) => { const n = N(q); return !n || champs.some(c => N(c).includes(n)); };

  const contacts = () => [...state.carnet.contacts].sort((a, b) => N(a.service).localeCompare(N(b.service)) || N(a.nom).localeCompare(N(b.nom)));
  const notes = () => [...state.carnet.notes].sort((a, b) => b.creeLe - a.creeLe);

  function sauverContact(c) {
    const l = state.carnet.contacts, i = l.findIndex(x => x.id === c.id);
    if (i >= 0) l[i] = c; else l.push(c);
    persist();
  }
  function supprimerContact(id) { state.carnet.contacts = state.carnet.contacts.filter(c => c.id !== id); persist(); }
  function sauverNote(n) {
    const l = state.carnet.notes, i = l.findIndex(x => x.id === n.id);
    if (i >= 0) l[i] = Object.assign(l[i], n, { modifieLe: Date.now() }); else l.push(n);
    persist();
  }
  function supprimerNote(id) { state.carnet.notes = state.carnet.notes.filter(n => n.id !== id); persist(); }

  // titre de groupe d'une note : Aujourd'hui, Hier, Cette semaine, puis le mois
  function groupe(ts) {
    const d = new Date(ts), jour = fromUTC(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const today = aujourdhui(), n = ecartJours(jour, today);
    if (n === 0) return "Aujourd'hui";
    if (n === 1) return 'Hier';
    const w = new Date(toUTC(today)).getUTCDay(), lundi = addJours(today, -((w + 6) % 7));
    if (jour >= lundi) return 'Cette semaine';
    return new Date(ts).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  }
  const quand = ts => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return { contacts, notes, sauverContact, supprimerContact, sauverNote, supprimerNote, groupe, quand, tel, trouve };
})();

/* ================= Interface ================= */
(() => {
  const ui2 = { vue: 'contacts', q: '' };

  const carteContact = c => `<div class="ct">
      ${c.service ? `<div class="svc">${esc(c.service)}</div>` : ''}
      <div class="nm">${esc(c.nom || 'Sans nom')}</div>
      ${c.tel ? `<div class="tl">${esc(c.tel)}</div>` : ''}
      ${c.email ? `<div class="small muted">${esc(c.email)}</div>` : ''}
      ${c.adresse ? `<div class="small muted">${esc(c.adresse)}</div>` : ''}
      ${c.notes ? `<div class="small">${esc(c.notes)}</div>` : ''}
      <div class="acts">
        ${c.tel ? `<a class="btn appel" href="tel:${esc(Carnet.tel(c.tel))}">Appeler</a><a class="btn" href="sms:${esc(Carnet.tel(c.tel))}">SMS</a>` : ''}
        ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">E-mail</a>` : ''}
        ${c.adresse ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.adresse)}">Itinéraire</a>` : ''}
        <button class="btn" type="button" data-ct-edit="${esc(c.id)}">Modifier</button>
      </div></div>`;

  function listeContacts() {
    const L = Carnet.contacts().filter(c => Carnet.trouve(ui2.q, c.nom, c.service, c.tel, c.email, c.adresse, c.notes));
    if (!L.length) return `<p class="muted small">${ui2.q ? 'Aucun contact trouvé.' : 'Aucun contact pour l\'instant. Appuie sur « + Ajouter un contact ».'}</p>`;
    return L.map(carteContact).join('');
  }
  function listeNotes() {
    const L = Carnet.notes().filter(n => Carnet.trouve(ui2.q, n.texte));
    if (!L.length) return `<p class="muted small">${ui2.q ? 'Aucune note trouvée.' : 'Aucune note pour l\'instant. Appuie sur « + Nouvelle note ».'}</p>`;
    let h = '', g = null;
    L.forEach(n => {
      const t = Carnet.groupe(n.creeLe);
      if (t !== g) { g = t; h += `<div class="grp">${esc(t)}</div>`; }
      h += `<div class="nt" role="button" tabindex="0" data-nt-edit="${esc(n.id)}"><div class="dt">${esc(Carnet.quand(n.creeLe))}</div><p>${esc(n.texte).replace(/\n/g, '<br>')}</p></div>`;
    });
    return h;
  }

  window.rendreCarnet = function () {
    const contacts = ui2.vue === 'contacts';
    const peutImporter = contacts && navigator.contacts && navigator.contacts.select;
    view.innerHTML = `<div class="seg" style="margin-bottom:10px"><button class="btn${contacts ? ' primary' : ''}" data-ca-vue="contacts">Contacts</button><button class="btn${!contacts ? ' primary' : ''}" data-ca-vue="notes">Notes</button></div>
      <input class="q" id="caQ" type="search" placeholder="${contacts ? 'Rechercher un nom, un service…' : 'Rechercher dans mes notes…'}" value="${esc(ui2.q)}">
      <div id="caListe">${contacts ? listeContacts() : listeNotes()}</div>
      <div class="actions" style="margin-top:8px">
        <button class="btn primary" type="button" data-ca-new>${contacts ? '+ Ajouter un contact' : '+ Nouvelle note'}</button>
        ${peutImporter ? '<button class="btn" type="button" data-ca-import>Ajouter depuis mes contacts du téléphone</button>' : ''}
      </div>
      <p class="muted small">${contacts ? 'Les contacts restent sur ce téléphone, jamais sur internet.' : 'Pour dicter une note : touche le micro du clavier de ton téléphone.'}</p>`;
  };

  /* ---------- Fenêtre contact / note ---------- */
  const dlg = document.createElement('dialog'); document.body.appendChild(dlg);
  let courant = null;

  function formContact(c) {
    courant = { type: 'contact', id: c ? c.id : null };
    c = c || {};
    dlg.innerHTML = `<div class="dlg-head"><h3>${c.id ? 'Modifier le contact' : 'Nouveau contact'}</h3><button class="x" data-ferme aria-label="Fermer">×</button></div>
      <div class="dlg-body">
        <label class="f">Service / fonction<input id="cfService" value="${esc(c.service || '')}" placeholder="ex. Service balayeuses" autocomplete="off"></label>
        <label class="f">Nom<input id="cfNom" value="${esc(c.nom || '')}" autocomplete="off"></label>
        <label class="f">Téléphone<input id="cfTel" type="tel" value="${esc(c.tel || '')}" autocomplete="off"></label>
        <label class="f">E-mail<input id="cfEmail" type="email" value="${esc(c.email || '')}" autocomplete="off"></label>
        <label class="f">Adresse<input id="cfAdresse" value="${esc(c.adresse || '')}" autocomplete="off"></label>
        <label class="f">Notes<textarea id="cfNotes" rows="3">${esc(c.notes || '')}</textarea></label>
      </div>
      <div class="dlg-foot">${c.id ? '<button class="btn danger" type="button" data-ca-del style="margin-right:auto">Supprimer</button>' : ''}<button class="btn" data-ferme type="button">Annuler</button><button class="btn primary" type="button" data-ca-ok>Enregistrer</button></div>`;
    dlg.showModal();
  }
  function formNote(n) {
    courant = { type: 'note', id: n ? n.id : null };
    dlg.innerHTML = `<div class="dlg-head"><h3>${n ? 'Modifier la note' : 'Nouvelle note'}</h3><button class="x" data-ferme aria-label="Fermer">×</button></div>
      <div class="dlg-body"><label class="f">Note<textarea id="nfTexte" rows="7" placeholder="Écris ici (ou touche le micro du clavier pour dicter)">${esc(n ? n.texte : '')}</textarea></label>
        ${n ? `<p class="muted small">Écrite le ${esc(Carnet.quand(n.creeLe))}.</p>` : '<p class="muted small">Elle se range toute seule à la date d\'aujourd\'hui.</p>'}</div>
      <div class="dlg-foot">${n ? '<button class="btn danger" type="button" data-ca-del style="margin-right:auto">Supprimer</button>' : ''}<button class="btn" data-ferme type="button">Annuler</button><button class="btn primary" type="button" data-ca-ok>Enregistrer</button></div>`;
    dlg.showModal();
    setTimeout(() => dlg.querySelector('#nfTexte')?.focus(), 50);
  }

  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-ferme]')) { dlg.close(); return; }
    if (e.target.closest('[data-ca-del]') && courant) {
      if (!confirm(courant.type === 'contact' ? 'Supprimer ce contact ?' : 'Supprimer cette note ?')) return;
      courant.type === 'contact' ? Carnet.supprimerContact(courant.id) : Carnet.supprimerNote(courant.id);
      dlg.close(); rendre(); toast('Supprimé.'); return;
    }
    if (!e.target.closest('[data-ca-ok]') || !courant) return;
    if (courant.type === 'contact') {
      const v = id => dlg.querySelector(id).value.trim();
      const c = { id: courant.id || uid(), service: v('#cfService'), nom: v('#cfNom'), tel: v('#cfTel'), email: v('#cfEmail'), adresse: v('#cfAdresse'), notes: v('#cfNotes') };
      if (!c.nom && !c.tel && !c.email) { toast('Écris au moins un nom ou un numéro.'); return; }
      Carnet.sauverContact(c);
    } else {
      const texte = dlg.querySelector('#nfTexte').value.trim();
      if (!texte) { toast('La note est vide.'); return; }
      Carnet.sauverNote(courant.id ? { id: courant.id, texte } : { id: uid(), texte, creeLe: Date.now() });
    }
    dlg.close(); rendre(); toast('Enregistré.');
  });

  /* ---------- Onglet ---------- */
  view.addEventListener('click', e => {
    if (onglet !== 'carnet') return;
    const v = e.target.closest('[data-ca-vue]');
    if (v) { ui2.vue = v.dataset.caVue; ui2.q = ''; rendre(); return; }
    if (e.target.closest('[data-ca-new]')) { ui2.vue === 'contacts' ? formContact(null) : formNote(null); return; }
    const ce = e.target.closest('[data-ct-edit]');
    if (ce) { formContact(state.carnet.contacts.find(c => c.id === ce.dataset.ctEdit)); return; }
    const ne = e.target.closest('[data-nt-edit]');
    if (ne) { formNote(state.carnet.notes.find(n => n.id === ne.dataset.ntEdit)); return; }
    if (e.target.closest('[data-ca-import]')) {
      navigator.contacts.select(['name', 'tel', 'email'], { multiple: true }).then(l => {
        let n = 0;
        l.forEach(p => { const nom = (p.name || [])[0] || '', t = (p.tel || [])[0] || '', em = (p.email || [])[0] || ''; if (nom || t) { Carnet.sauverContact({ id: uid(), service: '', nom, tel: t, email: em, adresse: '', notes: '' }); n++; } });
        if (n) { rendre(); toast(`${n} contact${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} : complète leur service / fonction.`); }
      }).catch(() => {});
    }
  });
  view.addEventListener('input', e => {
    if (onglet !== 'carnet' || e.target.id !== 'caQ') return;
    ui2.q = e.target.value;
    document.getElementById('caListe').innerHTML = ui2.vue === 'contacts' ? listeContacts() : listeNotes();
  });
})();
