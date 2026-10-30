# Suivi désherbage

Application web (installable sur PC et téléphone) pour :

- **suivre** les passages de désherbage rue par rue (date, équipe, état constaté, remarque) ;
- **prévoir** quand repasser dans chaque rue, à partir de la météo (Open-Meteo) et de la classe de propreté de la voie.

Premier secteur : Secteur 3, Pôle Territorial Nord (Toulouse), 108 voies.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page et sa mise en forme |
| `app.js` | Le fonctionnement (saisie, calculs, météo) |
| `dictee.js` | La dictée vocale : reconnaissance des rues, de la date, de l'état et de l'équipe |
| `tableau.js` | L'import du tableau de suivi Excel et l'onglet Suivi (récap par rue, journal) |
| `xlsx.full.min.js` | Le lecteur de fichiers Excel (SheetJS), chargé seulement au moment de l'import |
| `secteurs.js` | La liste des rues par secteur (c'est ici qu'on ajoutera les autres secteurs) |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | Ce qui permet d'installer l'appli comme une application |

## Données

Les passages sont enregistrés dans le navigateur de chaque appareil. Aucune donnée de passage n'est envoyée sur GitHub.
Le tableau Excel de suivi est lu dans le navigateur et **ne doit jamais être déposé sur GitHub** (il contient des noms d'agents).
Pensez à utiliser **Réglages → Télécharger une sauvegarde** régulièrement.
