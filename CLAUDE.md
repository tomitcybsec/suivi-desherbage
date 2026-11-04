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
| `planning.js` | Interventions prévues et réalisées, boutons Fait / Modifier / Reporter / Annuler, alertes météo (pluie par heures de travail, vent, bandeau du haut de l'Accueil, pluie dans l'heure), « Copier pour mon tableau » (lignes TSV dans l'ordre des colonnes de son Excel) |
| `feuilles.js` | Module feuilles mortes |
| `alertes.js` | Alertes à l'ouverture (haut de Priorités) : pluie, vent, chute de feuilles, avaloirs, interventions pas faites ; interrupteurs dans Réglages |
| `herbe.js` | Prévision de l'herbe par semaine (Suivi > Herbe), « déjà prévu » (rues déjà au planning) |
| `sauvegarde.js` | Sauvegarde complète (JSON : passages, planning, tableau importé, réglages), envoi par le partage d'Android, restauration par fusion, rappel tous les 3 mois |
| `carnet.js` | Onglet Carnet : contacts (service/fonction, appel, SMS, e-mail, itinéraire), notes rangées par date, recherche ; données locales, incluses dans la sauvegarde (case à cocher) |
| `soussecteurs.js` | Sous-secteurs Nord / Sud (de part et d'autre du boulevard Pierre et Marie Curie, qui est au Sud) : une seule sorte d'opération (ramassage de feuilles OU rotofil) par semaine et par sous-secteur ; les prévisions décalent les rues en conséquence. Liste des rues dans `secteurs.js` (`sousSecteurs`) |
| `tableau.js` | Import du tableau Excel (lecture locale avec `xlsx.full.min.js`), Récap (par rue ou par date, avec recherche), interventions du tableau + celles faites dans l'appli |
| `dictee.js` | Moteur de reconnaissance des noms de rues dans un texte libre (utilisé par l'import Excel). L'interface de dictée vocale a été **abandonnée** à sa demande. |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Installation comme application, mode hors ligne |

## Règles métier
- **Classes pôle** : 5 = doit être le plus propre possible, 0 = peut attendre (à confirmer par sa hiérarchie). Seuil de repousse = seuil de base × facteur de classe (5 : 0,7 … 0 : 1,3).
- **Herbe** : unités de pousse par jour = degrés au-dessus de 5 °C × facteur eau (pluie sur 10 jours). Un **rotofil réalisé** remet le compteur à zéro. L'état constaté (presque propre / un peu / beaucoup d'herbe) ajuste le seuil rue par rue.
- **Feuilles mortes** : seuls le **coordonné** et le **pompage** enlèvent les feuilles (pas le souffleur seul, pas le balayage manuel). Indice de chute = courbe de saison (pic mi-novembre) × gel × vent. Tous les coordonnés de l'avenue François Collignon concernent les feuilles.
- **Alertes météo** (objet `SEUILS` dans `app.js`, logique dans `planning.js`) : la pluie est évaluée **heure par heure dans la plage « Heures de travail »** (Réglages, 7 h – 15 h par défaut) : « possible » ≥ 0,3 mm ou ≥ 40 %, « probable » ≥ 1 mm ou ≥ 60 %, « forte » ≥ 5 mm ; vent fort = rafales ≥ 50 km/h. Aujourd'hui + 3 jours : modèle par défaut ET Météo-France (`meteofrance_seamless`), on alerte si l'un des deux annonce de la pluie ; au-delà, modèle par défaut seul. Sans données horaires, repli sur le journalier. Bandeau ambre/rouge tout en haut de l'Accueil ; bandeau rouge « Météo indisponible ou ancienne » si échec ou donnée de plus de 3 h ; météo rechargée si plus de 30 min. La pluie annule en général coordonnés et rotofil. Le modèle de repousse de l'herbe et les feuilles utilisent toujours les valeurs **journalières**.
- **À vérifier sur le vrai service** : le format de la réponse horaire / `minutely_15` / `models=meteofrance_seamless` d'Open-Meteo a été codé d'après la documentation (accès réseau bloqué pendant le développement) ; le code accepte les noms de variables avec ou sans suffixe de modèle et retombe sur le journalier en cas de problème.
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

## Idées sous le coude (pas commencées, validées dans le principe)
- **Trois fonctions** de l'appli : prédire (herbe, feuilles), organiser (planning à 15 jours / 3 semaines : rien d'officiel n'existe pour les agents de maîtrise), suivre et rendre compte.
- **Sauvegarde / export** + rappel tous les 3 mois (« fais une sauvegarde sur l'ordinateur du travail », avec la date et la période couverte). Envoi au N+1 par le menu de partage d'Android, sans serveur. Les données ne sont que dans le navigateur : sans sauvegarde, tout est perdu si on vide les données ou change de téléphone.
- **Rapport au N+1** : tableau Excel d'abord ; plus tard un petit PDF de synthèse rédigé tous les 3 mois.
- **Historique long** (mois, années), consultable par rue.
- **Mode simple / complet** dans Réglages (simple par défaut), pour des agents de 60 ans peu à l'aise avec le numérique ; textes en phrases, gros boutons, taille du texte réglable. Pour l'instant seulement la partie feuilles a paru compliquée.
- **Feuilles** : onglet Suivi > Feuilles ; « Plus de feuilles sur les arbres » par rue, reprise le 1er août ; sécheresse d'été et bouton « Ajouter à mon agenda » (rappel 3 jours avant) restent à faire.
- **Nom de l'appli** : « Helping Hand » (sous-titre possible « Terrain ») ; à changer dans l'appli ; vérifier la disponibilité du nom (Play Store, INPI) avant usage public.

## Tester
Ouvrir `index.html` via un petit serveur local (`python3 -m http.server`) ; la météo vient d'Open-Meteo (gratuit, sans clé). Vérifier sur largeur téléphone (390 px) et en mode sombre.
