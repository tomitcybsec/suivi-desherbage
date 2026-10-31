# Notes pour Claude — appli « Suivi désherbage »

## Qui utilise ce dépôt
- Le propriétaire est **agent de maîtrise propreté** (secteur 3, Pôle Territorial Nord, Toulouse). Il n'est **pas développeur** : il apprend. Explique toujours en **français simple**, une étape à la fois, et dis précisément ce qui a changé et comment le vérifier dans l'appli.
- Phase de **test** : il est seul utilisateur. Son **tableau Excel de suivi reste sa référence officielle** ; l'appli tourne en parallèle.

## Règles impératives
- **Aucune donnée personnelle dans le dépôt** (il est public) : pas de noms d'agents, pas de tableau Excel, pas d'adresses de particuliers, pas de photos. Les données restent dans le navigateur de chaque appareil.
- Ne jamais ajouter de clé d'API ou de secret dans le code.
- À chaque modification : **incrémenter `VERSION` dans `app.js`** (il vérifie la version en bas de l'onglet Réglages).
- Si un fichier est ajouté ou renommé : l'ajouter à `FICHIERS` dans `sw.js` et **changer le nom du cache** (`desherbage-vN`).
- Pas d'outil de compilation : HTML / CSS / JavaScript simples, servis tels quels par **GitHub Pages (branche `main`, dossier racine)**.
- Travailler sur une branche, puis lui proposer de fusionner : il valide avant mise en ligne.
- **Ne jamais ouvrir ni lire `xlsx.full.min.js`** (bibliothèque externe très lourde, on n'y touche pas). Pour chercher dans le code, exclure ce fichier (ex. `grep` sur les autres fichiers seulement).

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page + toute la feuille de style (design « Terrain » : en-tête anthracite, lignes carrées, rouge = retard, jaune = action principale, police Atkinson Hyperlegible, mode sombre) |
| `app.js` | Cœur : état et stockage (`localStorage`), météo Open-Meteo, modèle de repousse de l'herbe, onglets Priorités / Rues / Suivi / Réglages, fiche d'une rue |
| `secteurs.js` | Référentiel : 108 lignes de voies du secteur 3 (classe pôle 0–5, longueur, tronçon), `alias` (ex. « les Mazades » = Avenue des Mazades), `zones` (La Vache, Parking de la Glanerie), `ruesFeuilles` |
| `saisie.js` | Saisie « à cocher » : Fait / À prévoir, date, interventions, rues, agents, état de l'herbe |
| `planning.js` | Interventions prévues et réalisées, boutons Fait / Reporter / Annuler, alertes météo (pluie, vent), « Copier pour mon tableau » (lignes TSV dans l'ordre des colonnes de son Excel) |
| `feuilles.js` | Module feuilles mortes |
| `tableau.js` | Import du tableau Excel (lecture locale avec `xlsx.full.min.js`), récap par rue, journal |
| `dictee.js` | Moteur de reconnaissance des noms de rues dans un texte libre (utilisé par l'import Excel). L'interface de dictée vocale a été **abandonnée** à sa demande. |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Installation comme application, mode hors ligne |

## Règles métier
- **Classes pôle** : 5 = doit être le plus propre possible, 0 = peut attendre (à confirmer par sa hiérarchie). Seuil de repousse = seuil de base × facteur de classe (5 : 0,7 … 0 : 1,3).
- **Herbe** : unités de pousse par jour = degrés au-dessus de 5 °C × facteur eau (pluie sur 10 jours). Un **rotofil réalisé** remet le compteur à zéro. L'état constaté (presque propre / un peu / beaucoup d'herbe) ajuste le seuil rue par rue.
- **Feuilles mortes** : seuls le **coordonné** et le **pompage** enlèvent les feuilles (pas le souffleur seul, pas le balayage manuel). Indice de chute = courbe de saison (pic mi-novembre) × gel × vent. Tous les coordonnés de l'avenue François Collignon concernent les feuilles.
- **Alertes** : pluie probable ≥ 2 mm ou ≥ 60 % ; forte pluie ≥ 10 mm ; vent fort ≥ 50 km/h. La pluie annule en général coordonnés et rotofil.
- Une intervention « Prévu » ne compte jamais comme un passage tant qu'elle n'est pas « Réalisé ».
- Colonnes de son tableau Excel : N°, Date, Jour, Type, Lieu, Intervention, Matériel, Poches, Agents, Statut, Observations, État herbe avant.

## Pistes à venir (dans l'ordre qu'il a validé)
1. Météo renforcée : croisement des modèles Météo-France (AROME, ARPEGE) et européen avec niveau de confiance, alerte avaloirs à J-2 / J-1, conditions de travail, vigilances officielles.
2. Suivi terrain : poches par rue, points noirs récurrents, main courante des incidents.
3. Base partagée (synchro PC / téléphone / collègues) — seulement après validation de sa hiérarchie.
4. Tableau de bord de synthèse.

## Idée en réserve : notifications (téléphone / PC) — pas commencée
Il n'existe aucune notification aujourd'hui (seulement des alertes visibles dans l'appli). Souhaits du propriétaire, à reprendre quand il le décide :
- **Pluie ou vent fort prévu** : prévenir **3-4 jours avant** (ex. le vendredi pour le lundi), puis rappel **la veille au soir** et **le matin**.
- **Forte pluie / avaloirs** : même principe (J-3/J-4, puis J-2, J-1).
- **Rues à ramasser (feuilles)** : même principe, prévenir à l'avance.
- **Intervention prévue non faite / à reporter** et **vigilance officielle Météo-France** : d'accord aussi.
- **Attention à ne pas saturer** : prévoir des réglages (activer/couper chaque type, heure d'envoi, rien le week-end, rien si rien à signaler), éviter les doublons.
- **Limites techniques** : appli fermée = il faut un serveur d'envoi (clé secrète interdite dans le dépôt, à valider par sa hiérarchie, lié à la « base partagée ») ; iPhone = appli ajoutée à l'écran d'accueil, iOS 16.4 minimum. Options simples : notifications appli ouverte seulement, rappel agenda, e-mail.
- Reste à décider : téléphone et/ou PC, Android ou iPhone, niveau (appli ouverte ou fermée).

## Tester
Ouvrir `index.html` via un petit serveur local (`python3 -m http.server`) ; la météo vient d'Open-Meteo (gratuit, sans clé). Vérifier sur largeur téléphone (390 px) et en mode sombre.
