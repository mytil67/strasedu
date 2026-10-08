# Organisation de l'interface

Ce document explique **pourquoi** l'accueil est composé ainsi, et ce qu'il ne
faut pas y remettre. Il ne décrit pas l'apparence, qui peut évoluer, mais
l'ordre des priorités, qui ne doit pas.

---

## 1. Ce que l'accueil faisait, mesuré

Avant réorganisation, pour un écran utile de 713 px :

| Élément | Contenu | Hauteur |
| --- | --- | --- |
| héros | « Vos outils pédagogiques », sous-titre, 2 boutons | 210 px |
| carrousel | 3 informations du département | 307 px |
| Le moment | 4 vignettes | 327 px |
| Le mois | 4 vignettes | 346 px |
| Reprendre | 5 pastilles | 83 px |
| Favoris | 4 pastilles | 83 px |
| Explorer par catégorie | 6 tuiles | 544 px |

**2 140 px, soit trois écrans**, et **aucune liste d'outils** : il fallait passer
par le menu latéral, la recherche, ou descendre jusqu'aux tuiles de catégories
puis cliquer. Les deux premiers blocs — 517 px, soit 73 % du premier écran — ne
menaient à aucun outil, et le héros faisait double emploi avec la barre de
recherche et l'entrée « Tous les outils ».

## 2. Les principes retenus

- **La règle des cinq secondes** : ce que l'utilisateur vient chercher doit être
  lisible sans défiler, sans filtrer, sans survoler. Un écran principal qui exige
  de défiler est un rapport, pas un tableau de bord.
  Voir [NN/g, test des 5 secondes](https://www.nngroup.com/videos/5-second-usability-test/)
  et [Stephen Few, *Dashboard Design*](https://www.perceptualedge.com/files/Dashboard_Design_Course.pdf).
- **Divulgation progressive** : le résumé est visible, le détail s'ouvre sur
  intention. Voir [NN/g, *Progressive Disclosure*](https://www.nngroup.com/articles/progressive-disclosure/).
- **Neutre par défaut, la couleur pour ce qui compte** : une tête d'écran
  saturée de couleurs coûte l'attention disponible pour la recherche.
  Voir [Few, *Common Pitfalls in Dashboard Design*](https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf).
- **Panneau latéral pour le détail, modale pour ce qui bloque** : un aperçu en
  modale masque la page et fait perdre le repère spatial ; un panneau latéral le
  conserve. Les modales restent réservées aux réglages, à l'aide et aux
  confirmations. Voir [Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards).
- **Montrer la fraîcheur, ne pas repeindre pendant la lecture** : l'accueil
  affiche la date du dernier contrôle et le délai avant le prochain, et une
  version reçue n'est jamais appliquée d'office.
  Voir [Smashing Magazine, *UX Strategies for Real-Time Dashboards*](https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/).
- **États vides qui diagnostiquent** : un état vide dit pourquoi il est vide et
  propose l'action qui le remplit, au lieu d'un « aucun résultat » sec.

## 3. L'ordre de l'accueil, et ce qu'il signifie

| Ordre | Bloc | Hauteur visée | Rôle |
| --- | --- | --- | --- |
| 1 | Salutation | 24 px | Situer : qui, quel jour |
| 2 | Bandeau d'information du département | 52 px | Les dernières nouvelles, sans envahir |
| 3 | **Mes outils** | ~120 px | La tâche réelle : relancer un outil habituel, en un clic |
| 4 | **Tous les outils**, filtres compris | le reste | La recherche visuelle, sans changer de page |
| 5 | Mises en avant, catégories | — | Contenu éditorial, après l'essentiel |

Le détail d'une information ou d'un outil s'ouvre dans un **panneau latéral** :
la page reste en place, l'utilisateur ne perd pas ce qu'il regardait.

## 4. Règles pour la suite

**À faire**

- Placer toute nouveauté **après** la grille d'outils, sauf si elle sert
  directement à trouver ou lancer un outil.
- Mesurer avant d'affirmer : les hauteurs se relèvent dans la page, pas à l'œil
  (voir `SHOT_SCRIPT` dans `.tmp/shot.js`).
- Vérifier qu'au moins deux rangées d'outils restent entièrement visibles dans
  un écran de 713 px : c'est le garde-fou de toute cette organisation.
- Garder les cibles cliquables à 24 × 24 px minimum et le focus visible
  (WCAG 2.2, critères 2.5.8 et 2.4.11).

**À éviter**

- Réintroduire un titre de page décoratif : le menu latéral et la barre de
  recherche situent déjà l'utilisateur.
- Dupliquer une action déjà présente ailleurs (recherche, « Tous les outils »).
- Un bloc qui tourne, clignote ou se repeint pendant la lecture.
- Une couleur forte sans information : elle consomme l'attention des autres
  blocs.
- Remettre « Favoris » et « Récents » dans le menu latéral : ils sont sur
  l'accueil, sous « Mes outils ».
