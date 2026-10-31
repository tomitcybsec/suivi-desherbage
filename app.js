/* Suivi désherbage — version 1
   Toutes les données sont enregistrées dans le navigateur de l'appareil (localStorage).
   Météo : Open-Meteo (gratuit, sans clé). */
'use strict';

const VERSION = '1.9.6';
const STORE_KEY = 'desherbage.v1';
const WX_KEY = 'desherbage.meteo.v1';
const WX_MAX_AGE_MS = 3 * 3600 * 1000; // on actualise la météo toutes les 3 h au plus

/* ---------- Réglages par défaut du modèle de repousse ---------- */
const DEFAULT_REGLAGES = {
  seuilBase: 400,   // unités de pousse cumulées avant re-intervention, pour une rue de classe 3
  tBase: 5,         // °C sous lesquels l'herbe ne pousse quasiment pas
  pluieRef: 15,     // mm de pluie sur 10 jours pour une pousse "sans manque d'eau"
  facteursClasse: { 0: 1.3, 1: 1.2, 2: 1.1, 3: 1.0, 4: 0.85, 5: 0.7 } // 5 = le plus exigeant -> seuil plus bas
};
/* Normales approximatives Toulouse (température moyenne °C et pluie mm/jour), utilisées
   au-delà des 16 jours de prévision ou si la météo est indisponible. */
const NORMALES_T = [6.3, 7.4, 10.4, 12.7, 16.6, 20.6, 23.0, 23.0, 19.6, 15.6, 10.1, 7.0];
const NORMALES_PLUIE = [1.7, 1.5, 1.6, 2.2, 2.3, 1.9, 1.3, 1.5, 1.6, 1.8, 1.6, 1.7];

const ETATS = {
  propre:   { label: 'Presque propre (trop tôt)', k: 1.25 },
  peu:      { label: "Un peu d'herbe (bon moment)", k: 1.0 },
  beaucoup: { label: "Beaucoup d'herbe (trop tard)", k: 0.8 },
};
const STATUTS = {
  retard:    { label: 'En retard',      court: 'En retard' },
  semaine:   { label: 'Cette semaine',  court: '≤ 7 j' },
  quinzaine: { label: 'Sous 15 jours',  court: '≤ 15 j' },
  ok:        { label: 'À jour',         court: 'À jour' },
  inconnu:   { label: 'Jamais saisies', court: 'Pas de passage' },
};

/* ---------- Outils dates (format AAAA-MM-JJ, sans soucis d'heure d'été) ---------- */
const pad = n => String(n).padStart(2, '0');
function aujourdhui() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toUTC(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fromUTC(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function addJours(s, n) { return fromUTC(toUTC(s) + n * 86400000); }
function ecartJours(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
function moisDe(s) { return Number(s.slice(5, 7)) - 1; }
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function fmtDate(s) { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${Number(d)} ${MOIS[Number(m) - 1]} ${y}`; }
function fmtDateCourt(s) { if (!s) return '—'; const [, m, d] = s.split('-'); return `${Number(d)} ${MOIS[Number(m) - 1]}`; }
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
function fmtJM(s) { const [, m, d] = s.split('-'); return `${Number(d)}/${Number(m)}`; }
function fmtJour(s) { return `${JOURS_COURTS[new Date(toUTC(s)).getUTCDay()]} ${fmtJM(s)}`; }
const virgule = (x, n = 1) => x.toFixed(n).replace('.', ',');
function relatif(n) {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  return n > 0 ? `dans ${n} j` : `il y a ${-n} j`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Stockage ---------- */
function charger(key, defaut) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : defaut; } catch { return defaut; }
}
function sauver(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch { toast("Impossible d'enregistrer sur cet appareil (stockage plein ou bloqué)."); return false; }
}

const state = Object.assign({ passages: [], reglages: null, auteur: '', equipe: '', secteurId: null }, charger(STORE_KEY, {}));
state.reglages = Object.assign({}, DEFAULT_REGLAGES, state.reglages || {});
state.reglages.facteursClasse = Object.assign({}, DEFAULT_REGLAGES.facteursClasse, (state.reglages.facteursClasse || {}));
const meteo = Object.assign({ jours: {}, majLe: 0, erreur: null, secteurId: null }, charger(WX_KEY, {}));
const persist = () => sauver(STORE_KEY, state);
const persistMeteo = () => sauver(WX_KEY, meteo);

const SECTEURS = window.SECTEURS || [];
if (!SECTEURS.some(s => s.id === state.secteurId)) state.secteurId = SECTEURS[0]?.id;
const secteur = () => SECTEURS.find(s => s.id === state.secteurId);
const rueParId = id => { for (const s of SECTEURS) { const r = s.rues.find(r => r.id === id); if (r) return r; } return null; };
const nomRue = r => r ? r.voie + (r.troncon ? ` (${r.troncon})` : '') : 'Rue supprimée';

/* ---------- Météo ---------- */
const VARS = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'relative_humidity_2m_mean'];
const VARS_PREVI = [...VARS, 'precipitation_probability_max', 'precipitation_hours', 'wind_speed_10m_max'];

async function appelMeteo(base, params, essais) {
  // essaie avec toutes les variables, puis avec moins si le service en refuse une
  for (const vars of essais || [VARS, VARS.slice(0, 3)]) {
    const url = `${base}?${new URLSearchParams({ ...params, daily: vars.join(','), timezone: 'Europe/Paris' })}`;
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (r.status !== 400) throw new Error('HTTP ' + r.status);
  }
  throw new Error('Requête météo refusée');
}
function integrer(json, prevision) {
  const d = json?.daily; if (!d?.time) return;
  const today = aujourdhui();
  d.time.forEach((t, i) => {
    const tmax = d.temperature_2m_max?.[i], tmin = d.temperature_2m_min?.[i];
    if (tmax == null || tmin == null) return;
    meteo.jours[t] = {
      tmax, tmin,
      pluie: d.precipitation_sum?.[i] ?? 0,
      hum: d.relative_humidity_2m_mean?.[i] ?? null,
      proba: d.precipitation_probability_max?.[i] ?? null,
      heuresPluie: d.precipitation_hours?.[i] ?? null,
      vent: d.wind_speed_10m_max?.[i] ?? null,
      prev: prevision && t > today
    };
  });
}

let meteoEnCours = null;
async function majMeteo(force = false) {
  const s = secteur(); if (!s) return;
  if (meteo.secteurId !== s.id) { meteo.jours = {}; meteo.majLe = 0; meteo.secteurId = s.id; }
  if (!force && Date.now() - meteo.majLe < WX_MAX_AGE_MS && !besoinArchive()) return;
  if (meteoEnCours) return meteoEnCours;
  meteoEnCours = (async () => {
    afficherPill('Météo : mise à jour…');
    try {
      const pos = { latitude: s.lat, longitude: s.lon };
      integrer(await appelMeteo('https://api.open-meteo.com/v1/forecast', { ...pos, past_days: 92, forecast_days: 16 }, [VARS_PREVI, VARS, VARS.slice(0, 3)]), true);
      // complète les jours passés manquants (trous de la prévision ou passages anciens) avec l'archive
      const trous = joursManquants(addJours(aujourdhui(), -92), addJours(aujourdhui(), -2));
      const ancien = besoinArchive();
      const debut = [ancien, trous[0]].filter(Boolean).sort()[0];
      if (debut) {
        const fin = trous.length ? trous[trous.length - 1] : addJours(aujourdhui(), -3);
        // deux sources possibles ; la 2e ne sert que si la 1re laisse des trous.
        // Le résultat est gardé pour être affiché dans Réglages (diagnostic).
        const avant = Object.keys(meteo.jours).length, detail = [];
        for (const src of ['https://archive-api.open-meteo.com/v1/archive', 'https://historical-forecast-api.open-meteo.com/v1/forecast']) {
          const reste = debut <= fin ? joursManquants(debut, fin) : [];
          if (!reste.length) break;
          const nom = src.includes('archive') ? 'archive' : 'historique';
          const n0 = Object.keys(meteo.jours).length;
          try {
            integrer(await appelMeteo(src, { ...pos, start_date: reste[0], end_date: reste[reste.length - 1] }), false);
            detail.push(`${nom} : +${Object.keys(meteo.jours).length - n0} j`);
          } catch (e) { detail.push(`${nom} : échec (${e.message || e})`); }
        }
        meteo.complement = { le: Date.now(), plage: `${debut} → ${fin}`, ajoutes: Object.keys(meteo.jours).length - avant, detail: detail.join(' · ') || 'rien à compléter' };
      }
      meteo.majLe = Date.now(); meteo.erreur = null;
    } catch (e) {
      meteo.erreur = String(e.message || e);
    }
    persistMeteo(); invalider(); rendre();
    meteoEnCours = null;
  })();
  return meteoEnCours;
}
// date la plus ancienne dont on a besoin et qui manque dans le cache (passages > 92 jours)
function joursManquants(de, a) {
  const l = [];
  for (let d = de; d <= a; d = addJours(d, 1)) if (!meteo.jours[d]) l.push(d);
  return l;
}
function besoinArchive() {
  const ids = new Set(secteur()?.rues.map(r => r.id));
  const dates = state.passages.filter(p => ids.has(p.rueId)).map(p => p.date);
  if (!dates.length) return null;
  const plusAncienne = dates.reduce((a, b) => a < b ? a : b);
  const limite = addJours(aujourdhui(), -88);
  for (let d = plusAncienne; d < limite; d = addJours(d, 1)) if (!meteo.jours[d]) return d;
  return null;
}
function jourMeteo(d) {
  const j = meteo.jours[d];
  if (j) return { ...j, source: j.prev ? 'prevision' : 'observe' };
  const m = moisDe(d), t = NORMALES_T[m];
  return { tmax: t + 5, tmin: t - 5, pluie: NORMALES_PLUIE[m], hum: null, source: 'normale' };
}

/* ---------- Modèle de repousse ---------- */
let cacheUnites = new Map();
let cacheStatut = new Map();
function invalider() { cacheUnites = new Map(); cacheStatut = new Map(); }

// unités de pousse d'une journée = degrés au-dessus de tBase × facteur eau
function unitesJour(d) {
  if (cacheUnites.has(d)) return cacheUnites.get(d);
  const R = state.reglages, j = jourMeteo(d);
  const tmoy = (j.tmax + j.tmin) / 2;
  let deg = Math.max(0, tmoy - R.tBase);
  if (j.tmax > 32) deg *= 0.7; // forte chaleur : la pousse ralentit
  let pluie10 = 0;
  for (let i = 0; i < 10; i++) pluie10 += jourMeteo(addJours(d, -i)).pluie || 0;
  let eau = 0.35 + 0.65 * Math.min(1, pluie10 / R.pluieRef);
  if (j.hum != null && j.hum >= 80) eau += 0.1;
  eau = Math.min(1, eau);
  const u = deg * eau;
  cacheUnites.set(d, u);
  return u;
}
// cumul du lendemain de "de" jusqu'à "a" inclus
function cumul(de, a) { let s = 0; for (let d = addJours(de, 1); d <= a; d = addJours(d, 1)) s += unitesJour(d); return s; }

function passagesDe(rueId) {
  const l = state.passages.filter(p => p.rueId === rueId).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.creeLe || 0) - (b.creeLe || 0));
  // un même jour saisi deux fois (dictée + tableau + planning) ne compte qu'une fois ; on garde l'état constaté s'il existe
  const out = [];
  for (const p of l) {
    const prev = out[out.length - 1];
    if (prev && prev.date === p.date) { if (!prev.etat && p.etat) out[out.length - 1] = { ...prev, etat: p.etat }; continue; }
    out.push(p);
  }
  return out;
}
function seuilClasse(classe) { const R = state.reglages; return R.seuilBase * (R.facteursClasse[classe] ?? 1); }

// apprentissage : chaque état constaté corrige le seuil propre à la rue
function coefRue(rue, ps) {
  const sc = seuilClasse(rue.classe), ratios = [];
  for (let i = 1; i < ps.length; i++) {
    const e = ETATS[ps[i].etat]; if (!e) continue;
    if (ps[i].date <= ps[i - 1].date) continue;
    const u = cumul(ps[i - 1].date, ps[i].date);
    if (u < 10) continue;
    // "beaucoup" = le vrai seuil est plus bas que ce cumul (ne peut que baisser le seuil),
    // "propre" = le vrai seuil est plus haut (ne peut que le monter), "peu" = estimation directe.
    let r = (u * e.k) / sc;
    if (ps[i].etat === 'beaucoup') r = Math.min(1, r);
    if (ps[i].etat === 'propre') r = Math.max(1, r);
    ratios.push(Math.log(r));
  }
  if (!ratios.length) return { coef: 1, n: 0 };
  const gm = Math.exp(ratios.reduce((a, b) => a + b, 0) / ratios.length);
  const n = ratios.length;
  const coef = Math.min(2, Math.max(0.5, 1 + (gm - 1) * n / (n + 2)));
  return { coef, n };
}

function statutRue(rue) {
  if (cacheStatut.has(rue.id)) return cacheStatut.get(rue.id);
  const ps = passagesDe(rue.id), today = aujourdhui();
  let res;
  if (!ps.length) {
    res = { statut: 'inconnu', pct: -1, ps };
  } else {
    const dernier = ps[ps.length - 1];
    const { coef, n } = coefRue(rue, ps);
    const seuil = seuilClasse(rue.classe) * coef;
    const u = dernier.date <= today ? cumul(dernier.date, today) : 0;
    const pct = u / seuil;
    let echeance = null;
    let acc = 0;
    for (let d = addJours(dernier.date, 1), i = 0; i < 730; d = addJours(d, 1), i++) {
      acc += unitesJour(d);
      if (acc >= seuil) { echeance = d; break; }
    }
    const jours = echeance ? ecartJours(today, echeance) : null;
    let statut = 'ok';
    if (pct >= 1) statut = 'retard';
    else if (jours != null && jours <= 7) statut = 'semaine';
    else if (jours != null && jours <= 15) statut = 'quinzaine';
    const prevFiable = echeance ? (meteo.jours[echeance] ? 'prevision' : 'normale') : null;
    res = { statut, pct, seuil, cumul: u, echeance, jours, dernier, ps, coef, nObs: n, prevFiable };
  }
  cacheStatut.set(rue.id, res);
  return res;
}

/* ---------- Interface ---------- */
const $ = s => document.querySelector(s);
const view = $('#view');
let onglet = 'priorites';
const ui = { recherche: '', classe: '', tri: 'priorite', selection: new Set(), histFiltre: '' };

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
function afficherPill(txt, warn = false) { const p = $('#meteoPill'); p.textContent = txt; p.classList.toggle('warn', warn); }
function majPill() {
  if (meteo.erreur && !Object.keys(meteo.jours).length) return afficherPill('Météo indisponible', true);
  if (meteo.erreur) return afficherPill('Météo non actualisée', true);
  if (!meteo.majLe) return afficherPill('Météo…');
  const d = new Date(meteo.majLe);
  afficherPill(`Météo à jour ${pad(d.getHours())}:${pad(d.getMinutes())}`);
}
function ligneRue(rue, { selection = false } = {}) {
  const s = statutRue(rue), today = aujourdhui();
  let droite, cls = s.statut;
  if (s.statut === 'inconnu') droite = 'Pas de passage';
  else if (s.statut === 'retard') { const j = Math.max(0, ecartJours(s.echeance || today, today)); droite = `<span class="tag">${j ? `Retard ${j} j` : 'À faire'}</span>`; }
  else if (!s.echeance) droite = '> 2 ans';
  else droite = ecartJours(today, s.echeance) <= 15 ? fmtJour(s.echeance) : fmtDateCourt(s.echeance);
  const coche = selection ? `<input type="checkbox" data-sel="${rue.id}" ${ui.selection.has(rue.id) ? 'checked' : ''} aria-label="Sélectionner ${esc(rue.voie)}">` : '';
  const meta = [`Classe ${rue.classe}`, rue.troncon ? esc(rue.troncon) : null, rue.longueur ? rue.longueur + ' m' : null, s.dernier ? `fait le ${fmtJM(s.dernier.date)}` : null].filter(Boolean).join(' · ');
  return `<div class="rue" data-rue="${rue.id}" role="button" tabindex="0">
    ${coche}
    <div class="main">
      <div class="nom">${esc(rue.voie)}</div>
      <div class="meta">${meta}</div>
    </div>
    <div class="right ${cls} n">${droite}</div>
  </div>`;
}

/* Les 5 rues les plus urgentes aujourd'hui.
   Points : retard d'herbe (la repousse intègre déjà la météo prévue), classe pôle (+4 par classe),
   feuilles à ramasser, intervention prévue (aujourd'hui ou en retard +50, dans 2 jours +15).
   Météo : s'il pleut ou s'il y a du vent fort aujourd'hui, une intervention prévue ce jour perd 30 points (report probable). */
function rueUrgences() {
  const today = aujourdhui();
  const alerte = typeof alerteMeteo === 'function' ? alerteMeteo(today) : null;
  const prevus = (state.planning || []).filter(p => p.statut === 'prevu' && p.date <= addJours(today, 2));
  const out = [];
  (secteur()?.rues || []).forEach(rue => {
    const s = statutRue(rue), raisons = [];
    let score = 0;
    if (s.statut === 'retard') {
      score += 100 + Math.min(60, Math.max(0, s.pct - 1) * 60);
      const j = Math.max(0, ecartJours(s.echeance || today, today));
      raisons.push(j ? `herbe en retard de ${j} j` : 'herbe à faire');
    } else if (s.statut === 'semaine') {
      score += Math.max(0, s.pct) * 70;
      raisons.push(`herbe à faire d'ici ${Math.max(0, s.jours)} j`);
    }
    if (typeof Feuilles !== 'undefined' && Feuilles.estRue(rue.id)) {
      const f = Feuilles.statut(rue.id);
      if (f.etat === 'afaire') { score += 90; raisons.push('feuilles à ramasser'); }
      else if (f.etat === 'bientot') { score += 40; raisons.push('feuilles bientôt à ramasser'); }
    }
    prevus.filter(p => p.rueIds.includes(rue.id)).forEach(p => {
      const nom = p.intervention || p.type || 'intervention';
      if (p.date <= today) {
        score += 50; raisons.push(`${nom} prévu${p.date < today ? ' le ' + fmtJM(p.date) : ' aujourd’hui'}`);
        if (alerte) { score -= 30; raisons.push(`${alerte.titre.toLowerCase()} : report probable`); }
      } else { score += 15; raisons.push(`${nom} prévu ${fmtJour(p.date)}`); }
    });
    if (score <= 0) return; // rien d'urgent sur cette rue : la classe seule ne suffit pas
    score += rue.classe * 4;
    raisons.push(`classe ${rue.classe}`);
    out.push({ rue, score, raisons });
  });
  return out.sort((a, b) => b.score - a.score || b.rue.classe - a.rue.classe || a.rue.voie.localeCompare(b.rue.voie, 'fr'));
}
function blocCinqAFaire() {
  if (!state.passages.length && !(state.planning || []).length) return '';
  const alerte = typeof alerteMeteo === 'function' ? alerteMeteo(aujourdhui()) : null;
  const L = rueUrgences().slice(0, 5);
  let h = `<h2>Aujourd'hui, les 5 à faire</h2>`;
  if (alerte) h += `<div class="notice warn"><strong>${esc(alerte.titre)}</strong> ${esc(alerte.detail)} Le rotofil et le coordonné sont en général annulés.</div>`;
  if (!L.length) return h + `<p class="muted small">Rien d'urgent aujourd'hui.</p>`;
  return h + `<div class="list">${L.map(({ rue, raisons }) => `<div>${ligneRue(rue)}<div class="muted small" style="padding:4px 14px 0">${raisons.map(esc).join(' · ')}</div></div>`).join('')}</div>`;
}

function rendrePriorites() {
  const rues = secteur()?.rues || [];
  const groupes = { retard: [], semaine: [], quinzaine: [], ok: [], inconnu: [] };
  rues.forEach(r => groupes[statutRue(r).statut].push(r));
  for (const k of ['retard', 'semaine', 'quinzaine', 'ok']) groupes[k].sort((a, b) => statutRue(b).pct - statutRue(a).pct);
  groupes.inconnu.sort((a, b) => a.voie.localeCompare(b.voie, 'fr'));

  // résumé météo des 7 derniers jours
  const today = aujourdhui();
  let pluie = 0, tm = 0, u = 0, nObs = 0;
  for (let i = 0; i < 7; i++) {
    const d = addJours(today, -i), j = jourMeteo(d);
    if (j.source !== 'normale') nObs++;
    pluie += j.pluie || 0; tm += (j.tmax + j.tmin) / 2; u += unitesJour(d);
  }
  const uj = u / 7;
  const pousse = uj < 3 ? 'faible' : uj < 9 ? 'moyenne' : 'forte';

  let html = '';
  if (!state.passages.length) {
    html += `<div class="notice"><strong>Pour démarrer :</strong> appuie sur <strong>+ Saisir</strong> en bas de l'écran, ou coche des rues dans l'onglet <strong>Rues</strong>, pour indiquer ce qui a été fait ou ce que tu prévois, ou importe ton tableau Excel depuis l'onglet <strong>Suivi</strong>. L'appli calculera ensuite toute seule quand y retourner.</div>`;
  }
  if (meteo.erreur) {
    html += `<div class="notice warn">La météo n'a pas pu être récupérée (${esc(meteo.erreur)}). Les calculs utilisent ${nObs ? 'les dernières données connues et ' : ''}des moyennes saisonnières. <button class="btn" data-act="meteo">Réessayer</button></div>`;
  }
  html += blocCinqAFaire();
  html += `<div class="resume">${['retard', 'semaine', 'quinzaine'].map(k => `<button class="${k}" data-goto="${k}"><b>${groupes[k].length}</b><span>${k === 'retard' ? 'en retard' : k === 'semaine' ? 'cette semaine' : 'sous 15 jours'}</span></button>`).join('')}</div>`;
  html += `<p class="resume-2">${groupes.ok.length} à jour${groupes.inconnu.length ? ` · <button data-goto="inconnu">${groupes.inconnu.length} jamais saisie${groupes.inconnu.length > 1 ? 's' : ''}</button>` : ''}</p>`;
  html += `<p class="meteo-ligne">Météo 7 jours : ${virgule(tm / 7)} °C · ${virgule(pluie)} mm · pousse ${pousse}${nObs < 7 ? ` <span>(${7 - nObs} j estimé${7 - nObs > 1 ? 's' : ''} sur moyennes)</span>` : ''}</p>`;
  if (typeof blocPlanning === 'function') html += blocPlanning();
  if (typeof blocFeuilles === 'function') html += blocFeuilles();

  let toutes = '';
  for (const k of ['retard', 'semaine', 'quinzaine', 'ok']) {
    if (!groupes[k].length) continue;
    toutes += `<h2 id="g-${k}">${STATUTS[k].label} <span class="muted">(${groupes[k].length})</span></h2><div class="list">${groupes[k].map(r => ligneRue(r)).join('')}</div>`;
  }
  if (groupes.inconnu.length) {
    toutes += `<details class="section" id="g-inconnu"><summary>Jamais saisies <span class="muted">(${groupes.inconnu.length})</span></summary><div class="list">${groupes.inconnu.map(r => ligneRue(r)).join('')}</div></details>`;
  }
  html += `<details class="section" id="g-toutes"><summary>Voir toutes les priorités <span class="muted">(${rues.length} rues)</span></summary>${toutes}</details>`;
  view.innerHTML = html;
}

function ruesFiltrees() {
  const q = ui.recherche.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  let rues = (secteur()?.rues || []).filter(r => {
    if (ui.classe !== '' && String(r.classe) !== ui.classe) return false;
    if (!q) return true;
    return (r.voie + ' ' + r.motdir + ' ' + r.troncon).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q);
  });
  const cmpNom = (a, b) => a.voie.localeCompare(b.voie, 'fr') || a.id.localeCompare(b.id);
  if (ui.tri === 'nom') rues.sort(cmpNom);
  else if (ui.tri === 'dernier') rues.sort((a, b) => (statutRue(b).dernier?.date || '').localeCompare(statutRue(a).dernier?.date || '') || cmpNom(a, b));
  else rues.sort((a, b) => statutRue(b).pct - statutRue(a).pct || cmpNom(a, b));
  return rues;
}
function rendreRues() {
  const rues = ruesFiltrees();
  const classes = [...new Set((secteur()?.rues || []).map(r => r.classe))].sort();
  view.innerHTML = `
    <div class="toolbar">
      <input type="search" id="q" placeholder="Rechercher une rue…" value="${esc(ui.recherche)}">
      <select id="fClasse" aria-label="Classe"><option value="">Toutes classes</option>${classes.map(c => `<option value="${c}" ${ui.classe === String(c) ? 'selected' : ''}>Classe ${c}</option>`).join('')}</select>
      <select id="fTri" aria-label="Tri">
        <option value="priorite" ${ui.tri === 'priorite' ? 'selected' : ''}>Tri : priorité</option>
        <option value="nom" ${ui.tri === 'nom' ? 'selected' : ''}>Tri : nom</option>
        <option value="dernier" ${ui.tri === 'dernier' ? 'selected' : ''}>Tri : dernier passage</option>
      </select>
      <button class="btn" id="selAll">Tout cocher (${rues.length})</button>
    </div>
    <p class="muted small" style="margin:-4px 0 10px">Coche plusieurs rues pour saisir un même passage (campagne), ou touche une rue pour voir son détail.</p>
    <div class="list" id="listeRues">${rues.map(r => ligneRue(r, { selection: true })).join('') || '<div class="empty">Aucune rue ne correspond.</div>'}</div>`;
  majSelbar();
}
function majSelbar() {
  const n = ui.selection.size;
  $('#selbar').hidden = !(onglet === 'rues' && n > 0);
  $('#selCount').textContent = `${n} rue${n > 1 ? 's' : ''}`;
}

function rendreHistorique() {
  const q = ui.histFiltre.trim().toLowerCase();
  const ids = new Set(secteur()?.rues.map(r => r.id));
  const ps = state.passages.filter(p => ids.has(p.rueId)).filter(p => {
    if (!q) return true;
    const r = rueParId(p.rueId);
    return [nomRue(r), p.equipe, p.remarque, p.auteur].join(' ').toLowerCase().includes(q);
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.creeLe || 0) - (a.creeLe || 0));
  const parJour = new Map();
  ps.forEach(p => { if (!parJour.has(p.date)) parJour.set(p.date, []); parJour.get(p.date).push(p); });
  let html = `<div class="toolbar"><input type="search" id="hq" placeholder="Filtrer (rue, équipe, remarque)…" value="${esc(ui.histFiltre)}"><button class="btn" data-act="csv">Exporter pour Excel</button></div>
    <p class="muted small">${ps.length} passage${ps.length > 1 ? 's' : ''} enregistré${ps.length > 1 ? 's' : ''}.</p>`;
  if (!ps.length) html += `<div class="empty">Aucun passage pour l'instant.</div>`;
  for (const [d, liste] of parJour) {
    html += `<div class="hist-day"><h3>${fmtDate(d)} · ${liste.length} rue${liste.length > 1 ? 's' : ''}</h3><div class="hist-box">${liste.map(p => {
      const r = rueParId(p.rueId);
      return `<div class="hist-item"><div class="grow"><strong>${esc(nomRue(r))}</strong>
        <div class="muted small">${[p.etat ? ETATS[p.etat]?.label : null, p.equipe, p.auteur ? 'saisi par ' + p.auteur : null].filter(Boolean).map(esc).join(' · ')}</div>
        ${p.remarque ? `<div class="small">${esc(p.remarque)}</div>` : ''}</div>
        ${p.source === 'tableau' ? `<span class="muted small" title="À corriger dans le tableau Excel">tableau n°${esc(p.ref ?? '?')}</span>` : `<button class="btn danger" data-del="${p.id}" title="Supprimer ce passage">Suppr.</button>`}</div>`;
    }).join('')}</div></div>`;
  }
  view.innerHTML = html;
}

function rendreReglages() {
  const R = state.reglages;
  const nJours = Object.keys(meteo.jours).length;
  view.innerHTML = `
    <h2>Utilisateur</h2>
    <div class="card"><label class="f">Ton nom (enregistré avec chaque passage saisi)<input id="rAuteur" value="${esc(state.auteur)}" placeholder="ex. Thomas"></label></div>

    <h2>Tableau de suivi (Excel)</h2>
    <div class="card">
      <p class="small" style="margin-top:0">Importe ton tableau Excel : l'appli reconnaît les rues, compte les passages de rotofil réalisés pour la prédiction et calcule le récap par rue.
      Le fichier est lu <strong>sur cet appareil uniquement</strong>, il n'est envoyé nulle part. Réimporte-le à chaque mise à jour : pas de doublons.</p>
      ${state.importTableau ? `<p class="small">Dernier import : « ${esc(state.importTableau.fichier)} », le ${new Date(state.importTableau.le).toLocaleString('fr-FR')} — ${state.importTableau.lignes} lignes, ${state.importTableau.passages} passages rotofil.</p>` : ''}
      <button class="btn primary" data-act="importTableau">${state.importTableau ? 'Réimporter le tableau' : 'Importer mon tableau de suivi'}</button>
    </div>

    <h2>Agents (pour la dictée)</h2>
    <div class="card">
      <p class="small" style="margin-top:0">L'appli reconnaît les prénoms dictés grâce à cette liste. Elle se remplit toute seule avec la colonne « Agents » de ton tableau importé ; ajoute ici les autres (un par ligne, prénom puis nom). Elle reste <strong>sur cet appareil</strong>.</p>
      <p class="small muted">Déjà connus : ${typeof Planning !== 'undefined' ? (Planning.annuaire().map(a => esc(a.complet)).join(', ') || 'aucun') : '—'}</p>
      <label class="f">Agents ajoutés à la main<textarea id="rAgents" rows="3" placeholder="ex. Pascal Martin">${esc(state.agentsManuels || '')}</textarea></label>
    </div>

    <h2>Sauvegarde des données</h2>
    <div class="card">
      <p class="small" style="margin-top:0">Les passages sont enregistrés <strong>sur cet appareil uniquement</strong> (dans ce navigateur).
      Fais une sauvegarde régulièrement : elle permet aussi de transférer les données d'un appareil à l'autre.</p>
      <div class="actions">
        <button class="btn primary" data-act="export">Télécharger une sauvegarde</button>
        <button class="btn" data-act="import">Restaurer / fusionner une sauvegarde</button>
        <button class="btn" data-act="csv">Exporter l'historique (Excel)</button>
      </div>
    </div>

    <h2>Météo</h2>
    <div class="card small">
      <dl class="kv">
        <dt>Point météo</dt><dd>${esc(secteur()?.pole)} (${secteur()?.lat}, ${secteur()?.lon})</dd>
        <dt>Dernière mise à jour</dt><dd>${meteo.majLe ? new Date(meteo.majLe).toLocaleString('fr-FR') : 'jamais'}</dd>
        <dt>Jours en mémoire</dt><dd>${nJours}</dd>
        ${nJours ? (() => { const ks = Object.keys(meteo.jours).sort(); const manq = joursManquants(addJours(aujourdhui(), -30), addJours(aujourdhui(), -1)).length;
          return `<dt>Période couverte</dt><dd>du ${fmtDate(ks[0])} au ${fmtDate(ks[ks.length - 1])}</dd>
          <dt>Jours manquants (30 derniers jours)</dt><dd>${manq}${manq ? ' — remplacés par des moyennes' : ''}</dd>`; })() : ''}
        ${meteo.complement ? `<dt>Complément passé</dt><dd>${esc(meteo.complement.detail)} <span class="muted">(${esc(meteo.complement.plage)})</span></dd>` : ''}
        ${meteo.erreur ? `<dt>Erreur</dt><dd>${esc(meteo.erreur)}</dd>` : ''}
      </dl>
      <button class="btn" data-act="meteo">Actualiser maintenant</button>
      <p class="muted">Source : Open-Meteo (gratuit). Au-delà de 16 jours de prévision, l'appli utilise des moyennes saisonnières de Toulouse.</p>
    </div>

    <h2>Réglages de la prédiction</h2>
    <div class="card">
      <div class="settings-grid">
        <label class="f">Seuil de base (classe 3)<input type="number" min="50" step="10" id="rSeuil" value="${R.seuilBase}"></label>
        <label class="f">Température mini de pousse (°C)<input type="number" step="0.5" id="rTbase" value="${R.tBase}"></label>
        <label class="f">Pluie de référence (mm / 10 j)<input type="number" min="1" step="1" id="rPluie" value="${R.pluieRef}"></label>
      </div>
      <p class="small" style="margin:14px 0 6px"><strong>Exigence par classe</strong> <span class="muted">(plus le facteur est petit, plus on revient tôt)</span></p>
      <div class="settings-grid">
        ${[5, 4, 3, 2, 1, 0].map(c => `<label class="f">Classe ${c}<input type="number" min="0.2" max="3" step="0.05" data-fc="${c}" value="${R.facteursClasse[c]}"></label>`).join('')}
      </div>
      <div class="actions"><button class="btn primary" data-act="saveR">Enregistrer les réglages</button><button class="btn" data-act="resetR">Valeurs par défaut</button></div>
    </div>

    <h2>Feuilles mortes</h2>
    <div class="card">
      <p class="small" style="margin-top:0">Rues avec arbres suivies : ${typeof Feuilles !== 'undefined' ? Feuilles.rues().map(id => esc(nomRue(rueParId(id)))).join(', ') || 'aucune' : '—'}.
      Pour en ajouter ou en retirer : ouvre la fiche de la rue et coche « Rue avec arbres ».</p>
      <p class="small">Chaque jour, l'appli estime la chute des feuilles (saison, avec un pic vers mi-novembre, renforcée après une gelée et par vent fort) et l'additionne depuis le dernier ramassage
      (seuls le coordonné et le pompage comptent ; le souffleur seul et le balayage manuel ne comptent pas). Au-delà du seuil, la rue passe « à ramasser ».</p>
      <div class="settings-grid"><label class="f">Seuil de ramassage<input type="number" min="50" step="10" id="rSeuilF" value="${state.feuilles ? state.feuilles.seuil : 500}"></label></div>
      <p class="muted small">Plus petit = on repasse plus souvent. Enregistre avec le bouton « Enregistrer les réglages » ci-dessus.</p>
    </div>

    <h2>Comment la prédiction est calculée</h2>
    <div class="card small">
      <p style="margin-top:0">Chaque jour, l'herbe « pousse » d'un certain nombre d'<strong>unités</strong> : les degrés au-dessus de ${R.tBase} °C,
      réduits s'il a peu plu sur les 10 derniers jours (et légèrement augmentés si l'air est très humide).
      Depuis le dernier passage, l'appli additionne ces unités. Quand le total atteint le <strong>seuil</strong> de la rue, il faut y retourner.</p>
      <p>Le seuil dépend de la classe (classe 5 = plus exigeant = seuil plus bas) puis s'ajuste rue par rue grâce à l'<strong>état constaté</strong>
      que tu saisis à chaque passage : « beaucoup d'herbe » fait baisser le seuil de la rue, « presque propre » le fait monter.</p>
      <p class="muted" style="margin-bottom:0">Les valeurs par défaut sont un point de départ à caler avec le terrain, pas une vérité.</p>
    </div>

    <h2>Zone sensible</h2>
    <div class="card"><button class="btn danger" data-act="wipe">Effacer tous les passages de cet appareil</button></div>
    <p class="muted small">Version ${VERSION}</p>`;
}

function rendre() {
  majPill();
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === onglet)));
  ({ priorites: rendrePriorites, rues: rendreRues, historique: () => (typeof rendreSuivi === 'function' ? rendreSuivi() : rendreHistorique()), reglages: rendreReglages })[onglet]();
  if (onglet !== 'rues') $('#selbar').hidden = true;
}

/* Historique d'une rue : passages herbe + interventions du tableau + interventions saisies (« réalisé »), triés du plus récent au plus ancien */
function historiqueRue(id) {
  const ps = passagesDe(id);
  const duTableau = typeof interventionsDeRue === 'function' ? interventionsDeRue(id) : [];
  const idsTableau = new Set(duTableau.map(l => `tb-${l.cle}-${id}`));
  const idsAffiches = new Set(ps.map(p => p.id));
  const lignes = [];
  ps.forEach(p => {
    if (idsTableau.has(p.id)) return; // déjà montré par la ligne « Intervention du tableau »
    const type = p.source === 'planning' ? 'Intervention saisie · herbe' : 'Passage herbe';
    const details = [p.etat ? ETATS[p.etat]?.label : null, p.equipe, p.auteur ? 'saisi par ' + p.auteur : null].filter(Boolean).map(esc).join(' · ');
    lignes.push({ date: p.date, cree: p.creeLe || 0, html: `<div class="hist-item"><div class="grow"><strong>${fmtDate(p.date)}</strong> <span class="muted small">· ${type}</span>
      <div class="muted small">${details}</div>
      ${p.remarque ? `<div class="small">${esc(p.remarque)}</div>` : ''}</div>
      ${p.source === 'tableau' ? `<span class="muted small" title="À corriger dans le tableau Excel">tableau n°${esc(p.ref ?? '?')}</span>` : `<button class="btn danger" data-del="${p.id}">Suppr.</button>`}</div>` });
  });
  duTableau.forEach(l => lignes.push({ date: l.date, cree: 0, html: `<div class="hist-item"><div class="grow">
      <strong>${fmtDate(l.date)}</strong> <span class="muted small">· Intervention du tableau · ${esc(l.type || 'Autre')}${l.statut !== 'realise' ? ' · ' + esc(l.statutTexte || l.statut) : ''}</span>
      <div class="small">${[l.intervention, l.materiel, l.poches ? l.poches + ' poches' : null].filter(Boolean).map(esc).join(' · ')}</div>
      ${l.agents ? `<div class="muted small">${esc(l.agents)}</div>` : ''}</div></div>` }));
  (state.planning || []).forEach(it => {
    if (it.statut !== 'realise' || !it.rueIds.includes(id) || idsAffiches.has(`pl-${it.id}-${id}`)) return;
    const d = it.dateRealise || it.date;
    lignes.push({ date: d, cree: it.creeLe || 0, html: `<div class="hist-item"><div class="grow">
      <strong>${fmtDate(d)}</strong> <span class="muted small">· Intervention saisie · ${esc(it.type || 'Autre')}</span>
      <div class="small">${[it.intervention, it.materiel].filter(Boolean).map(esc).join(' · ')}</div>
      ${it.agents ? `<div class="muted small">${esc(it.agents)}</div>` : ''}
      ${it.observations ? `<div class="small">${esc(it.observations)}</div>` : ''}</div></div>` });
  });
  lignes.sort((a, b) => b.date.localeCompare(a.date) || b.cree - a.cree);
  return `<h3 style="font-size:15px;margin:14px 0 6px">Historique (${lignes.length})</h3>` +
    (lignes.length ? `<div class="hist-box">${lignes.map(l => l.html).join('')}</div>` : '<p class="muted small">Aucun passage ni intervention.</p>');
}

/* ---------- Détail d'une rue ---------- */
let rueOuverte = null;
function ouvrirRue(id) {
  const rue = rueParId(id); if (!rue) return;
  rueOuverte = id;
  const s = statutRue(rue);
  $('#drTitre').textContent = rue.voie;
  let html = `<dl class="kv">
    ${rue.troncon ? `<dt>Tronçon</dt><dd>${esc(rue.troncon)}</dd>` : ''}
    <dt>Longueur</dt><dd>${rue.longueur ? rue.longueur + ' m' : 'non renseignée'}</dd>
    <dt>Classe pôle</dt><dd>${rue.classe}</dd>`;
  if (s.statut === 'inconnu') {
    html += `</dl><p class="notice">Aucun passage saisi pour cette rue. Saisis le dernier passage connu pour lancer la prédiction.</p>`;
  } else {
    const pct = Math.round(s.pct * 100);
    html += `<dt>Dernier passage</dt><dd>${fmtDate(s.dernier.date)} (${relatif(ecartJours(aujourdhui(), s.dernier.date))})</dd>
      <dt>Statut</dt><dd><span class="chip ${s.statut}">${STATUTS[s.statut].label}</span></dd>
      <dt>Repousse estimée</dt><dd>${pct} % du seuil (${Math.round(s.cumul)} / ${Math.round(s.seuil)} unités)</dd>
      <dt>Prochain passage</dt><dd>${s.echeance ? `${fmtDate(s.echeance)} (${relatif(s.jours)})` : 'pas avant 2 ans'}${s.echeance && s.prevFiable === 'normale' && s.jours > 0 ? ' <span class="muted small">— estimé sur moyennes saisonnières</span>' : ''}</dd>
      <dt>Apprentissage</dt><dd>${s.nObs ? `seuil ajusté × ${virgule(s.coef, 2)} d'après ${s.nObs} observation${s.nObs > 1 ? 's' : ''}` : 'pas encore d’observation (il faut au moins 2 passages avec un état constaté)'}</dd>
    </dl>`;
  }
  html += `<p style="margin:12px 0 0"><button class="btn primary" data-saisir-ici="${id}">Saisir ici</button></p>`;
  html += historiqueRue(id);
  if (typeof blocFeuillesRue === 'function') html += blocFeuillesRue(id);
  $('#drBody').innerHTML = html;
  const dlg = $('#dlgRue');
  if (!dlg.open) dlg.showModal();
}
function fermerRue() { rueOuverte = null; $('#dlgRue').close(); }

/* ---------- Saisie d'un passage ---------- */
let ruesASaisir = [];
function ouvrirPassage(ids) {
  ruesASaisir = ids;
  const noms = ids.map(id => nomRue(rueParId(id)));
  $('#dpTitre').textContent = ids.length > 1 ? `Passage sur ${ids.length} rues` : 'Passage fait';
  $('#dpRues').textContent = noms.length > 6 ? noms.slice(0, 6).join(', ') + ` et ${noms.length - 6} autres` : noms.join(', ');
  $('#dpDate').value = aujourdhui(); $('#dpDate').max = aujourdhui();
  $('#dpEquipe').value = state.equipe || '';
  $('#dpRemarque').value = '';
  document.querySelector('#formPassage input[name=etat][value=""]').checked = true;
  $('#dlgPassage').showModal();
}
$('#dlgPassage').addEventListener('close', () => {
  if ($('#dlgPassage').returnValue !== 'ok') return;
  const date = $('#dpDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > aujourdhui()) { toast('Date invalide (pas de date future).'); return; }
  const etat = document.querySelector('#formPassage input[name=etat]:checked')?.value || '';
  const equipe = $('#dpEquipe').value.trim(), remarque = $('#dpRemarque').value.trim();
  const creeLe = Date.now();
  ruesASaisir.forEach(rueId => state.passages.push({ id: uid(), rueId, date, etat, equipe, remarque, auteur: state.auteur || '', creeLe }));
  state.equipe = equipe;
  persist(); invalider();
  toast(`${ruesASaisir.length} passage${ruesASaisir.length > 1 ? 's' : ''} enregistré${ruesASaisir.length > 1 ? 's' : ''}.`);
  ui.selection.clear();
  if (besoinArchive()) majMeteo();
  rendre();
  if (rueOuverte) ouvrirRue(rueOuverte);
});
$('#dlgPassage').addEventListener('cancel', () => { $('#dlgPassage').returnValue = 'cancel'; });

function supprimerPassage(id) {
  const p = state.passages.find(p => p.id === id); if (!p) return;
  if (!confirm(`Supprimer le passage du ${fmtDate(p.date)} sur « ${nomRue(rueParId(p.rueId))} » ?`)) return;
  state.passages = state.passages.filter(x => x.id !== id);
  persist(); invalider(); rendre();
  if (rueOuverte) ouvrirRue(rueOuverte);
}

/* ---------- Export / import ---------- */
function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement('a'); a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exporterJSON() {
  const data = { app: 'suivi-desherbage', version: VERSION, exporteLe: new Date().toISOString(), passages: state.passages, reglages: state.reglages };
  telecharger(`sauvegarde-desherbage-${aujourdhui()}.json`, JSON.stringify(data, null, 1), 'application/json');
}
function exporterCSV() {
  const lignes = [['Date', 'Voie', 'Tronçon', 'Classe', 'Longueur (m)', 'État constaté', 'Équipe', 'Saisi par', 'Remarque']];
  [...state.passages].sort((a, b) => b.date.localeCompare(a.date)).forEach(p => {
    const r = rueParId(p.rueId) || {};
    lignes.push([p.date, r.voie || '?', r.troncon || '', r.classe ?? '', r.longueur ?? '', p.etat ? ETATS[p.etat]?.label : '', p.equipe, p.auteur, p.remarque]);
  });
  const csv = '﻿' + lignes.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  telecharger(`historique-desherbage-${aujourdhui()}.csv`, csv, 'text/csv;charset=utf-8');
}
$('#fileImport').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.passages)) throw new Error('format');
    const connus = new Set(state.passages.map(p => p.id));
    const nouveaux = data.passages.filter(p => p && p.id && p.rueId && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && !connus.has(p.id));
    state.passages.push(...nouveaux);
    persist(); invalider(); rendre();
    toast(`${nouveaux.length} passage(s) ajouté(s), ${data.passages.length - nouveaux.length} déjà présent(s).`);
  } catch { toast("Ce fichier n'est pas une sauvegarde valide."); }
});

/* ---------- Événements ---------- */
document.querySelector('nav.tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  onglet = b.dataset.tab; rendre(); window.scrollTo(0, 0);
});
$('#meteoPill').addEventListener('click', () => majMeteo(true));
$('#meteoPill').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') majMeteo(true); });

view.addEventListener('click', e => {
  const t = e.target;
  if (t.matches('input[data-sel]')) {
    t.checked ? ui.selection.add(t.dataset.sel) : ui.selection.delete(t.dataset.sel);
    majSelbar(); return;
  }
  const del = t.closest('[data-del]'); if (del) { supprimerPassage(del.dataset.del); return; }
  const go = t.closest('[data-goto]');
  if (go) {
    const cible = document.getElementById('g-' + go.dataset.goto);
    if (cible) { for (let d = cible.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; cible.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  const act = t.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'meteo') majMeteo(true);
    if (a === 'export') exporterJSON();
    if (a === 'import') $('#fileImport').click();
    if (a === 'csv') exporterCSV();
    if (a === 'saveR') {
      const R = state.reglages, num = (sel, def) => { const v = parseFloat($(sel).value); return Number.isFinite(v) ? v : def; };
      R.seuilBase = Math.max(50, num('#rSeuil', R.seuilBase));
      R.tBase = num('#rTbase', R.tBase);
      R.pluieRef = Math.max(1, num('#rPluie', R.pluieRef));
      document.querySelectorAll('[data-fc]').forEach(i => { const v = parseFloat(i.value); if (Number.isFinite(v) && v > 0) R.facteursClasse[i.dataset.fc] = v; });
      const sf = parseFloat($('#rSeuilF')?.value); if (state.feuilles && Number.isFinite(sf) && sf >= 50) state.feuilles.seuil = sf;
      persist(); invalider(); rendre(); toast('Réglages enregistrés.');
    }
    if (a === 'resetR') {
      if (!confirm('Revenir aux réglages par défaut ?')) return;
      state.reglages = JSON.parse(JSON.stringify(DEFAULT_REGLAGES)); persist(); invalider(); rendre();
    }
    if (a === 'wipe') {
      if (!confirm('Effacer TOUS les passages de cet appareil ? Pense à télécharger une sauvegarde avant.')) return;
      if (!confirm('Dernière confirmation : effacer définitivement ?')) return;
      state.passages = []; state.interventions = []; state.importTableau = null; state.planning = []; persist(); invalider(); rendre();
    }
    return;
  }
  const r = t.closest('[data-rue]'); if (r) ouvrirRue(r.dataset.rue);
});
view.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-rue]')) { e.preventDefault(); ouvrirRue(e.target.dataset.rue); }
});
view.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q' || t.id === 'hq') {
    if (t.id === 'q') ui.recherche = t.value; else ui.histFiltre = t.value;
    const pos = t.selectionStart; rendre();
    const n = $('#' + t.id); n.focus(); n.setSelectionRange(pos, pos);
  }
  if (t.id === 'rAuteur') { state.auteur = t.value.trim(); persist(); }
  if (t.id === 'rAgents') { state.agentsManuels = t.value; persist(); }
});
view.addEventListener('change', e => {
  if (e.target.id === 'fClasse') { ui.classe = e.target.value; rendre(); }
  if (e.target.id === 'fTri') { ui.tri = e.target.value; rendre(); }
});
view.addEventListener('click', e => {
  if (e.target.id === 'selAll') { ruesFiltrees().forEach(r => ui.selection.add(r.id)); rendre(); }
});
$('#selNone').addEventListener('click', () => { ui.selection.clear(); rendre(); });
$('#selGo').addEventListener('click', () => { if (ui.selection.size) (typeof ouvrirSaisie === 'function' ? ouvrirSaisie({ rueIds: [...ui.selection] }) : ouvrirPassage([...ui.selection])); });
$('#drClose').addEventListener('click', fermerRue);
$('#drClose2').addEventListener('click', fermerRue);
$('#dlgRue').addEventListener('close', () => { rueOuverte = null; });
$('#drPassage').addEventListener('click', () => { if (!rueOuverte) return; const id = rueOuverte; if (typeof ouvrirSaisie === 'function') { $('#dlgRue').close(); ouvrirSaisie({ rueIds: [id], mode: 'fait', inter: typeof Feuilles !== 'undefined' && Feuilles.estRue(id) ? [] : ['rotofil'] }); } else ouvrirPassage([id]); });
$('#drBody').addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) supprimerPassage(d.dataset.del); });
$('#drBody').addEventListener('click', e => {
  const b = e.target.closest('[data-saisir-ici]'); if (!b || typeof ouvrirSaisie !== 'function') return;
  const id = b.dataset.saisirIci;
  $('#dlgRue').close();
  ouvrirSaisie({ rueIds: [id] });
});

const selSecteur = $('#secteur');
selSecteur.innerHTML = SECTEURS.map(s => `<option value="${s.id}">${esc(s.nom)}</option>`).join('');
selSecteur.value = state.secteurId;
selSecteur.addEventListener('change', () => { state.secteurId = selSecteur.value; ui.selection.clear(); persist(); invalider(); rendre(); majMeteo(true); });

document.addEventListener('visibilitychange', () => { if (!document.hidden) { invalider(); majMeteo(); rendre(); } });

/* ---------- Démarrage ---------- */
rendre();
majMeteo();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
