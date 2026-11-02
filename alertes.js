/* Helping Hand — alertes à l'ouverture de l'appli (haut de « Priorités »).
   Phrases courtes, sans chiffres : pluie prévue, vent fort prévu, chute de feuilles prévue,
   avaloirs (forte pluie + feuilles accumulées), interventions prévues pas faites.
   Fenêtre : aujourd'hui → 4 jours (3-4 jours avant, puis la veille). Rien n'est envoyé : c'est affiché à l'ouverture.
   Les seuils restent cachés : pluie ≥ 2 mm ou ≥ 60 %, forte pluie ≥ 10 mm, vent ≥ 50 km/h. */
'use strict';

const Alertes = (() => {
  const REGLAGES = { pluie: true, vent: true, feuilles: true, nonfait: true, weekend: false }; // weekend = « rien le week-end »
  state.alertes = Object.assign({}, REGLAGES, state.alertes || {});
  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const dow = d => new Date(toUTC(d)).getUTCDay();
  const ouvre = d => dow(d) !== 0 && dow(d) !== 6;
  const quand = n => n <= 0 ? "aujourd'hui" : n === 1 ? 'demain' : `dans ${n} jours`;
  const jourTxt = (d, n) => n <= 0 ? "aujourd'hui" : n === 1 ? 'demain' : JOURS[dow(d)];
  const classe = n => n <= 1 ? 'rouge' : n <= 3 ? 'orange' : n <= 6 ? 'jaune' : 'bleu';
  const jourPrevu = d => { const j = meteo.jours[d]; return j && (d === aujourdhui() || j.prev) ? j : null; };
  // confirmation discrète par les autres modèles, seulement pour les alertes lointaines (3 jours et plus) :
  // si les autres modèles ne voient ni pluie ni vent, l'alerte n'est pas affichée. Sans données, on garde l'alerte.
  const confirme = (d, k, type) => {
    if (k < 3) return true;
    const m = meteo.modeles && meteo.modeles[d]; const v = m && m[type];
    if (!v || !v.length) return true;
    return type === 'pluie' ? v.some(x => x >= 1) : v.some(x => x >= 40);
  };
  const pleut = j => (j.pluie || 0) >= 2 || (j.proba != null && j.proba >= 60);
  const fortePluie = j => (j.pluie || 0) >= 10;
  const ventFort = j => j.vent != null && j.vent >= 50;

  function liste() {
    const R = state.alertes, today = aujourdhui(), out = [];
    if (R.weekend && !ouvre(today)) return out; // « rien le week-end » activé
    const jours = [0, 1, 2, 3, 4].map(k => ({ k, d: addJours(today, k) }));
    const nbPlanif = d => (state.planning || []).filter(p => p.statut === 'prevu' && p.date === d).length;

    // avaloirs : forte pluie dans 1-2 jours et des rues avec beaucoup de feuilles
    let jourAvaloir = null;
    const ruesChargees = typeof Feuilles !== 'undefined' ? Feuilles.rues().filter(id => { const e = Feuilles.statut(id).etat; return e === 'afaire' || e === 'bientot'; }) : [];
    if (R.feuilles && ruesChargees.length) {
      const f = [1, 2].map(k => ({ k, d: addJours(today, k) })).find(x => { const j = jourPrevu(x.d); return j && fortePluie(j); });
      if (f) {
        jourAvaloir = f.d;
        out.push({ cle: 'avaloirs', n: f.k, date: f.d, titre: `Pluie ${f.k === 1 ? 'demain' : 'dans 2 jours'} : ramasser avant`, texte: 'Des feuilles risquent de boucher les avaloirs.', agenda: true });
      }
    }
    // pluie et vent : jours travaillés seulement
    if (R.pluie) {
      const f = jours.find(x => ouvre(x.d) && x.d !== jourAvaloir && (j => j && pleut(j))(jourPrevu(x.d)) && confirme(x.d, x.k, 'pluie'));
      if (f) {
        const np = nbPlanif(f.d);
        out.push({ cle: 'pluie', n: f.k, date: f.d, titre: `Pluie prévue ${jourTxt(f.d, f.k)}`, texte: np ? `${np} intervention${np > 1 ? 's' : ''} prévue${np > 1 ? 's' : ''} ce jour-là : à reporter ?` : 'Les coordonnés et rotofils risquent d\'être annulés.' });
      }
    }
    if (R.vent) {
      const f = jours.find(x => ouvre(x.d) && (j => j && ventFort(j))(jourPrevu(x.d)) && confirme(x.d, x.k, 'vent'));
      if (f) out.push({ cle: 'vent', n: f.k, date: f.d, titre: `Vent fort prévu ${jourTxt(f.d, f.k)}`, texte: 'Balayeuse et souffleur déconseillés.' });
    }
    // chute de feuilles : jour travaillé avec un indice « très forte » (saison, renforcée par le gel et le vent)
    if (R.feuilles && typeof Feuilles !== 'undefined' && Feuilles.rues().some(id => !Feuilles.stoppee(id))) {
      Feuilles.invalider();
      const f = jours.find(x => ouvre(x.d) && Feuilles.indice(x.d).x >= 100);
      if (f) {
        const i = Feuilles.indice(f.d);
        const cause = i.gel && i.vent ? 'Gel et vent : ' : i.gel ? 'Gel : ' : i.vent ? 'Vent : ' : '';
        out.push({ cle: 'chute', n: f.k, date: f.d, titre: 'Chute de feuilles prévue', texte: `${cause}beaucoup de feuilles vont tomber.`.replace(/^./, c => c.toUpperCase()), agenda: true });
      }
    }
    // interventions prévues dont la date est passée
    if (R.nonfait) {
      const n = (state.planning || []).filter(p => p.statut === 'prevu' && p.date < today).length;
      if (n) out.push({ cle: 'nonfait', n: 0, date: today, titre: `${n} intervention${n > 1 ? 's' : ''} prévue${n > 1 ? 's' : ''} pas faite${n > 1 ? 's' : ''}`, texte: 'À valider (Fait) ou à reporter.', voir: true });
    }
    return out.sort((a, b) => a.n - b.n);
  }

  // « Ajouter à mon agenda » : fichier .ics (jour de l'alerte, rappel la veille)
  const txt = t => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  function agenda(a) {
    const ymd = d => d.replace(/-/g, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Helping Hand//FR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:alerte-${a.cle}-${a.date}-${Date.now()}@helpinghand`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${ymd(a.date)}`, `DTEND;VALUE=DATE:${ymd(addJours(a.date, 1))}`,
      `SUMMARY:${txt(a.titre + ' (estimation)')}`, `DESCRIPTION:${txt(a.texte + ' Estimation d\'après la météo.')}`,
      'BEGIN:VALARM', `TRIGGER:-P${a.rappel || 1}D`, 'ACTION:DISPLAY', `DESCRIPTION:${txt(a.titre)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const l = document.createElement('a'); l.href = url; l.download = `alerte-${a.date}.ics`; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Fichier agenda créé : ouvre-le pour l\'ajouter à ton agenda.');
  }

  return { liste, agenda, quand, classe, REGLAGES };
})();

/* ================= Interface ================= */
(() => {
  window.blocAlertes = function () {
    const L = Alertes.liste(); if (!L.length) return '';
    window.__alertes = L;
    return `<h2>À prévoir <span class="muted">(${L.length} alerte${L.length > 1 ? 's' : ''})</span></h2>` + L.map((a, i) =>
      `<div class="al c-${Alertes.classe(a.n)}"><div class="t"><b>${esc(a.titre)}</b><span class="d">${Alertes.quand(a.n)}</span></div>
        <p>${esc(a.texte)}</p>
        ${a.agenda ? `<button class="btn" type="button" data-alerte-agenda="${i}">Ajouter à mon agenda</button>` : ''}
        ${a.voir ? '<button class="btn" type="button" data-alerte-voir>Voir le planning</button>' : ''}</div>`).join('');
  };

  const NOMS = [['pluie', 'Pluie prévue'], ['vent', 'Vent fort prévu'], ['feuilles', 'Chute de feuilles et avaloirs'], ['nonfait', 'Intervention prévue pas faite'], ['weekend', 'Rien le week-end']];
  window.blocReglagesAlertes = function () {
    return `<h2>Alertes</h2><div class="card"><p class="muted small" style="margin-top:0">Elles s'affichent en haut de Priorités quand tu ouvres l'appli. Si rien n'est à signaler, rien ne s'affiche.</p>
      ${NOMS.map(([k, t]) => `<div class="tg"><span>${t}</span><button type="button" class="sw${state.alertes[k] ? ' on' : ''}" role="switch" aria-checked="${!!state.alertes[k]}" aria-label="${t}" data-alerte-reg="${k}"></button></div>`).join('')}</div>`;
  };

  document.getElementById('view').addEventListener('click', e => {
    const r = e.target.closest('[data-alerte-reg]');
    if (r) { const k = r.dataset.alerteReg; state.alertes[k] = !state.alertes[k]; persist(); rendre(); return; }
    const g = e.target.closest('[data-alerte-agenda]');
    if (g) { const a = (window.__alertes || [])[+g.dataset.alerteAgenda]; if (a) Alertes.agenda(a); return; }
    if (e.target.closest('[data-alerte-voir]')) {
      ui.suiviVue = 'planning';
      const b = document.querySelector('nav.tabs [data-tab="historique"]'); if (b) b.click(); else rendre();
    }
  });
})();
