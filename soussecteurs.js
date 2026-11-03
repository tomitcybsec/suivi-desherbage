/* Helping Hand — sous-secteurs Nord / Sud (de part et d'autre du boulevard Pierre et Marie Curie, qui est au Sud).
   Règle : par semaine (lundi → vendredi) et par sous-secteur, une seule sorte d'opération (ramassage de feuilles OU rotofil),
   pour ne pas monopoliser les balayeuses du service ni tout le personnel du secteur.
   Les prévisions (feuilles, herbe) décalent donc une rue à la semaine suivante si son sous-secteur est déjà pris par l'autre sorte d'opération. */
'use strict';

const SousSecteurs = (() => {
  const dow = d => new Date(toUTC(d)).getUTCDay();
  const lundiDe = d => addJours(d, -((dow(d) + 6) % 7));

  let cacheCarte = null, cacheSecteur = null;
  function carte() {
    const s = secteur();
    if (cacheSecteur !== s) {
      cacheSecteur = s; cacheCarte = new Map();
      Object.entries((s && s.sousSecteurs) || {}).forEach(([nom, ids]) => ids.forEach(id => cacheCarte.set(id, nom)));
    }
    return cacheCarte;
  }
  const de = id => carte().get(id) || null;
  const noms = () => Object.keys((secteur() || {}).sousSecteurs || {});

  // sorte d'opération d'une intervention : « ramassage » (coordonné, pompage), « herbe » (rotofil) ou rien
  const sorte = (type, texte) => {
    if (typeof Feuilles !== 'undefined' && Feuilles.estRamassage(type, texte)) return 'ramassage';
    return /rotofil/i.test(`${type} ${texte}`) ? 'herbe' : null;
  };

  // occupation : « sous-secteur|lundi » → ensemble des sortes d'opérations prévues ou faites cette semaine-là
  function occupation() {
    const occ = new Map();
    const noter = (rueIds, date, srt) => {
      if (!srt || !date) return;
      (rueIds || []).forEach(id => {
        const ss = de(id); if (!ss) return;
        const cle = `${ss}|${lundiDe(date)}`;
        if (!occ.has(cle)) occ.set(cle, new Set());
        occ.get(cle).add(srt);
      });
    };
    (state.planning || []).forEach(p => {
      if (p.statut !== 'prevu' && p.statut !== 'realise') return;
      noter(p.rueIds, p.statut === 'realise' ? (p.dateRealise || p.date) : p.date, sorte(p.type, `${p.intervention} ${p.materiel}`));
    });
    (state.interventions || []).forEach(l => { if (l.statut === 'realise') noter(l.rueIds, l.date, sorte(l.type, `${l.intervention} ${l.materiel}`)); });
    return occ;
  }

  // la semaine est-elle libre pour cette sorte d'opération dans le sous-secteur de la rue ?
  // (libre = rien, ou seulement la même sorte). « en plus » : propositions déjà retenues (même format que occupation).
  function libre(occ, rueId, lundi, srt, enPlus) {
    const ss = de(rueId); if (!ss) return true;
    const cle = `${ss}|${lundi}`;
    const autres = [...(occ.get(cle) || []), ...((enPlus && enPlus.get(cle)) || [])].filter(x => x !== srt);
    return !autres.length;
  }
  // premier lundi (à partir de celui de la date) où la rue peut recevoir cette sorte d'opération
  function premierLibre(occ, rueId, date, srt, enPlus) {
    let l = lundiDe(date), n = 0;
    while (!libre(occ, rueId, l, srt, enPlus) && n++ < 12) l = addJours(l, 7);
    return l;
  }

  return { de, noms, occupation, libre, premierLibre, lundiDe, sorte };
})();
