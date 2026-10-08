# StrasEdu 2.0

Lanceur d'applications pédagogiques pour les établissements scolaires.
Application de bureau Electron pour **Windows 11**, pensée pour des
enseignants qui doivent trouver un outil en quelques secondes.

> Guide d'installation et de déploiement en établissement :
> [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md)

---

## Ce qui change en 2.0

### Une interface organisée par catégories

L'ancienne version ouvrait directement sur une grille plate de 20 outils, avec
une liste de catégories dans une barre latérale. La nouvelle version part de
l'usage réel : un enseignant cherche *« l'outil pour enregistrer la voix »*,
pas *« le cinquième élément de la liste »*.

- **Accueil en tuiles de catégorie.** Chaque catégorie devient une tuile avec
  son icône, sa couleur, sa description, son nombre d'outils et un aperçu des
  trois premiers. C'est le point d'entrée unique.
- **Reprendre** — les outils récemment ouverts, accessibles en un clic.
- **Favoris** — les outils épinglés, mis en avant sur l'accueil et dans leur
  propre vue.
- **Récents** — l'historique d'usage, du plus récent au plus ancien.
- **Palette de commandes (`Ctrl+K`)** — recherche globale portant à la fois sur
  les outils, les catégories et les actions (changer de thème, ouvrir les
  réglages, vérifier les mises à jour), navigable au clavier.

### Une recherche qui trouve vraiment

- **Insensible aux accents** : `video` trouve « Vidéo », `dictee` trouve
  « dictée ». Indispensable en français.
- **Multi-termes en ET** : `montage video` ne remonte que les outils qui
  correspondent aux deux mots.
- **Champs pondérés** : nom > mots-clés > catégorie > description > pastille.
- **Repli approximatif seulement en dernier recours** : `pdl` retrouve
  « Podcastle », mais uniquement quand aucune correspondance littérale
  n'existe — sinon la liste se remplit de bruit.

### Ergonomie et accessibilité

- Cibles cliquables d'au moins 32 px, texte de base à 14 px.
- Anneaux de focus visibles (`:focus-visible`) sur tous les éléments
  interactifs, y compris sur fond accentué.
- Contrastes conformes WCAG 2.2 AA (texte courant ≥ 4,5:1) dans les deux
  thèmes.
- `prefers-reduced-motion` respecté ; mode contraste élevé pris en charge.
- Palette de commandes en motif `combobox`/`listbox` avec
  `aria-activedescendant`, et annonces `aria-live` du nombre de résultats.
- Navigation entièrement au clavier, y compris `Alt+1…9` pour sauter
  directement à une catégorie.

### Intégration Windows 11

- **Effet Mica** sur la surface de la fenêtre (Windows 11 21H2 et suivants),
  désactivable dans les réglages, avec repli opaque sur Windows 10.
- **Couleur d'accentuation du système** reprise pour l'accent de l'interface.
- **Thème système** suivi en direct (`nativeTheme`), thème clair ou sombre
  forçable.
- **Zone de notification** avec icône multi-résolutions (nette à 100, 150 et
  200 %) ; fermer la fenêtre laisse StrasEdu disponible.
- **Position et taille de fenêtre** mémorisées.
- Densité d'affichage **Confort** ou **Compact**.

### Distribution

- Icône applicative complète (16 → 256 px) — l'ancien `icons/` était vide,
  ce qui rendait toute fabrication d'installateur impossible.
- Un **installateur par machine** : il installe pour tous les utilisateurs du
  poste dans `C:\Program Files\StrasEdu`, et demande l'élévation **avant**
  d'afficher l'assistant. Aucune question de portée à l'écran, donc rien qui
  puisse échouer en cours d'assistant — un seul fichier couvre l'installation
  manuelle et le déploiement GPO/SCCM.
- Une version **portable**, sans installation ni raccourci, pour un poste
  partagé ou un essai sans droits particuliers.
- Configuration par fichier `strasedu.config.json` ou variable
  d'environnement, sans recompilation.

### Sécurité

Le catalogue peut être mis à jour à distance : il est traité comme une donnée
non fiable.

- Le rendu **n'envoie jamais d'URL ni de chemin** au processus principal : il
  transmet un identifiant d'outil, que le processus principal résout dans le
  catalogue qu'il a lui-même validé.
- Validation stricte du catalogue (schéma, longueurs, protocoles `http(s)`
  uniquement, extensions `.exe`/`.lnk`, racines autorisées optionnelles).
  Une entrée invalide est écartée, pas le catalogue entier.
- Les liens externes sont ouverts dans le navigateur du poste, jamais dans une
  fenêtre applicative ; `file://`, `javascript:` et les gestionnaires de
  protocole sont refusés.
- Permission requests (caméra, micro, notifications) refusées par défaut.
- `contextIsolation`, `sandbox`, `nodeIntegration: false`, et une CSP stricte
  (`default-src 'none'`, pas de script en ligne).
- Mise à jour distante rejetée si elle est illisible ou invalide ; l'ancienne
  version est conservée sous `apps.previous.json`.

---

## Informations du département et mise en avant des outils

Trois nouveautés donnent de la voix à l'établissement sur la page d'accueil.
Tout se pilote depuis le catalogue : **aucun redéploiement n'est nécessaire**
pour publier une information ou changer une mise en avant.

### Un carrousel d'informations

Le département informatique pousse ses informations — nouvelle salle,
maintenance, nouveaux outils validés — sous forme de carrousel, en tête de
l'accueil. Chaque information porte un titre, un texte, et si besoin une image
et un lien « En savoir plus », ouvert dans le navigateur du poste.

Le carrousel avance seul toutes les sept secondes ; il s'arrête dès que la
souris s'en approche ou qu'un élément reçoit le focus, et reste immobile si le
poste demande de réduire les animations. Flèches et pastilles permettent de
circuler au clavier comme à la souris.

### Les outils mis en avant

Sous le carrousel, l'administrateur compose une ou plusieurs sélections
(« Le moment », « Le mois ») : les outils choisis apparaissent en grand, avec
leur visuel, leur description et un accès direct. C'est la vitrine de
l'établissement, **distincte des favoris personnels** de chacun, qui restent
affichés plus bas avec les outils récents.

### Des outils qui se montrent

Chaque outil peut recevoir une illustration et jusqu'à quatre captures d'écran.
Elles s'affichent sur la carte de l'outil dans toutes les vues ; un bouton
« Aperçu » ouvre la galerie sans quitter l'application.

Les images sont embarquées dans le catalogue en data URI : une seule
publication suffit, aucun hébergement n'est nécessaire, et l'affichage ne
dépend pas du réseau. En contrepartie le catalogue grossit : l'outil
d'administration redimensionne les images à l'import, et la validation écarte
toute image dépassant 512 Ko ou les captures au-delà de la quatrième.

---

## Structure du projet

```
main.js                  processus principal : catalogue, fenêtre, IPC, sécurité
preload.js               pont IPC étroit exposé au rendu
index.html               ossature de l'interface
lib/catalog.js           validation du catalogue, partagée avec l'administration
styles/app.css           jetons de design et composants (thèmes, densité, Mica)
renderer/icons.js        jeu d'icônes SVG (aucune dépendance externe)
renderer/app.js          logique d'interface : vues, recherche, palette, réglages
admin/                   outil d'administration du catalogue (interface graphique)
apps.json                catalogue livré (catégories, métadonnées, outils)
icons/                   icône applicative et icônes de la zone de notification
strasedu.config.json.example  modèle de configuration de déploiement
scripts/generate-icons.py    régénère icons/ depuis un dessin vectoriel
scripts/preview.js           capture l'interface en images pour contrôle visuel
scripts/preview-preload.js   jeu de données d'exemple pour la prévisualisation
scripts/fix-builder-cache.ps1  prépare le cache electron-builder sous Windows
scripts/install-strasedu.ps1    déploiement et mise à jour par copie de dossier
scripts/update-catalog.ps1     validation et publication du catalogue (admin)
docs/DEPLOIEMENT.md            guide de déploiement Windows 11
docs/CATALOGUE.md              guide administrateur du catalogue
```

## Mettre à jour le catalogue (côté administrateur)

Le **catalogue** (outils, catégories, descriptions, URL) se met à jour tout
seul : une poussée de `apps.json` et les postes suivent en 30 minutes. Ajouter
un outil ne demande aucun déploiement.

**Avec l'application d'administration** — c'est la voie normale, et elle ne
demande ni Node ni npm :

| Fichier | Usage |
| --- | --- |
| `dist-admin\StrasEdu-Administration-2.1.1-setup.exe` | Installation classique (menu Démarrer, raccourci bureau). |
| `dist-admin\StrasEdu-Administration-2.1.1-portable.exe` | Aucune installation : double-clic. |

Onglets *Outils*, *Catégories*, *Mise en avant*, *Département*, *Application* :
on compose le catalogue, on choisit les icônes, les visuels des outils et le
logo officiel, on rédige les informations du carrousel et les sélections
d'outils à mettre en avant, puis on publie sur le partage réseau. La version est
incrémentée automatiquement, et un catalogue invalide est refusé en nommant
l'outil fautif.

```powershell
npm run build:admin     # fabrique les deux exécutables dans dist-admin/
```

**En ligne de commande** — pour un catalogue géré en gestion de version :

```powershell
# 1. Valider — reprend exactement les règles appliquées par l'application
.\scripts\update-catalog.ps1 -AppsJsonPath .\apps.json -ValidateOnly

# 2. Publier sur le partage réseau de l'établissement
.\scripts\update-catalog.ps1 -AppsJsonPath .\apps.json `
                             -SharePath "\\serveur\partage\StrasEdu\apps.json"
```

Le catalogue peut venir d'un **partage réseau**, d'un chemin local ou d'une URL
`http(s)` — le partage est recommandé en établissement : ni serveur web, ni
jeton d'authentification.

Guide complet : [`docs/CATALOGUE.md`](docs/CATALOGUE.md).

Le **binaire** ne change que quelques fois par an.
`scripts/install-strasedu.ps1` est idempotent et compare les versions : relancé
sur un poste à jour, il ne copie rien. Vous pouvez donc le déclencher à chaque
ouverture de session par GPO sans effet de bord.

## Développement

```powershell
npm install            # Electron + electron-builder
npm start              # lance l'application
npm run preview        # écrit des captures d'écran dans .preview/
npm run icons          # régénère icons/ (nécessite Python + Pillow)
npm run fix-builder-cache  # prépare le cache electron-builder (une fois)
```

## Fabrication des installateurs

```powershell
npm run build           # StrasEdu            → dist\
npm run build:portable  #   version portable
npm run build:admin     # StrasEdu Administration → dist-admin\
npm run build:all       # les trois
```

Les fichiers sont écrits dans `dist/` et `dist-admin/`.

### Signer les binaires

Sans signature, Windows affiche « Éditeur inconnu » et SmartScreen avertit au
premier lancement. La chaîne est déjà en place : renseignez un certificat, et
les **quatre** exécutables sont signés.

```powershell
# Certificat livré en .pfx : aucune configuration à modifier
$env:CSC_LINK = "C:\cles\strasedu.pfx"
$env:CSC_KEY_PASSWORD = "mot-de-passe"
npm run build:all
```

Le certificat installé dans le magasin Windows (jeton EV, Azure Trusted
Signing) se configure dans `win.signtoolOptions`. Guide complet, coûts et
pièges : [`docs/SIGNATURE.md`](docs/SIGNATURE.md).

`npm run release` **refuse de publier** un binaire non signé, ou signé par un
certificat interne non reconnu : il nomme les fichiers fautifs. Les drapeaux
`--allow-unsigned` et `--allow-internal-cert` lèvent ces refus.

## Publier une version

Les binaires ne sont pas versionnés dans le dépôt : 300 Mo par version
l'alourdiraient définitivement. Ils sont déposés en **release GitHub**, ce qui
donne en plus un lien de téléchargement stable pour le service informatique.

```powershell
npm run build:all
npm run release         # crée la release du tag v<version> et y dépose les exécutables
npm run release:dry     # vérifie sans rien envoyer
```

Retirer une version publiée par erreur :

```powershell
node scripts/publish-release.js --delete v2.0.0 --dry-run   # montre ce qui partirait
node scripts/publish-release.js --delete v2.0.0
```

La release et ses fichiers sont supprimés ; le tag Git subsiste, il continue de
désigner le commit qu'il marquait.

Le script produit `SHA256SUMS.txt` et le joint à la release : indispensable
quand les fichiers transitent par des partages réseau. Le jeton est lu dans
l'aide-mémoire de Git — celui qu'utilise déjà `git push` — et n'est jamais
affiché ni écrit sur le disque.

> **Première fabrication sur un poste Windows** : electron-builder télécharge
> un paquet d'outils de signature qui contient des liens symboliques macOS.
> Windows ne les crée que pour un administrateur ou en mode développeur, sinon
> 7-Zip échoue. `npm run fix-builder-cache` prépare ce paquet une fois pour
> toutes, sans droits particuliers.

Détail des cibles, installation silencieuse et signature de code :
[`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

## Format du catalogue

`apps.json` reste rétrocompatible : un catalogue 1.x continue de fonctionner,
les champs nouveaux sont optionnels.

```jsonc
{
  "version": "2.1.0",              // comparée à la version distante
  "logo": "data:image/png;base64,…",  // optionnel : remplace la marque par défaut

  "categoryMeta": {                // icône, couleur et description par catégorie
    "Audio": {
      "icon": "mic",               // nom d'icône de renderer/icons.js
      "color": "#7C5CFF",
      "description": "Enregistrer, monter et diffuser le son de la classe."
    }
  },

  "categories": ["Audio", "Vidéo", "IA", "Fichiers", "PDF", "Services"],

  "news": {                        // carrousel d'informations, optionnel
    "title": "Informations du département informatique",
    "subtitle": "Les dernières nouvelles du service",
    "items": [
      {
        "id": "info-salle-b12",    // identifiant stable du lien
        "title": "La salle B12 fait peau neuve",
        "text": "Seize postes remplacés, écran interactif et casques neufs.",
        "image": "data:image/svg+xml;base64,…",  // optionnel
        "url": "https://…",        // optionnel : lien « En savoir plus »
        "linkLabel": "Réserver la salle",
        "date": "8 octobre 2026"   // optionnel, texte libre
      }
    ]
  },

  "highlights": [                  // mises en avant composées, optionnel
    { "label": "Le moment", "appIds": ["vocaroo", "clipchamp"] },
    { "label": "Le mois", "appIds": ["podcastle", "edpuzzle"] }
  ],

  "apps": [
    {
      "id": "vocaroo",             // identifiant stable, unique
      "name": "Vocaroo",
      "category": "Audio",
      "description": "Enregistrement vocal en un clic, partage par lien.",
      "mark": "Vo",                // pastille de la fiche outil
      "badge": 0,                  // pastille numérique (0 = masquée)
      "meta": "Sans compte",       // information courte
      "keywords": ["enregistrer", "voix", "micro", "oral"],
      "url": "https://vocaroo.com",
      "type": "web",               // ou "local" avec "path"
      "image": "data:image/png;base64,…",   // vignette de l'outil
      "screenshots": ["data:image/png;base64,…"]  // 4 captures au maximum
    }
  ]
}
```

| Champ | Règle appliquée |
| --- | --- |
| `news.items` | 12 au maximum. Une information sans titre, sans texte et sans image est écartée. Un `url` non `http(s)` est retiré (l'information reste, sans lien). |
| `highlights` | 3 groupes au maximum, 12 outils par groupe. Un identifiant inconnu du catalogue est écarté : le rendu ne pointe jamais dans le vide. Le libellé vaut « À la une » à défaut. |
| `image`, `screenshots` | Data URI d'image (`png`, `jpeg`, `webp`, `svg+xml`) de 512 Ko de texte au maximum. Au-delà de 6 Mo de visuels cumulés, les suivants sont ignorés et le signalent au journal. |

Pour un outil installé sur le poste :

```jsonc
{
  "id": "pdfxchange",
  "name": "PDF-XChange",
  "type": "local",
  "path": "C:\\Program Files\\Tracker Software\\PDF Editor\\PDFXEdit.exe"
}
```

Icônes de catégorie disponibles : `mic`, `video`, `sparkles`, `folder`,
`fileText`, `image`, `globe`, `book`, `calculator`, `layers`.

## Données locales

Stockées dans `%APPDATA%\StrasEdu\` :

| Fichier | Contenu |
| --- | --- |
| `apps.json` | copie de travail du catalogue (mise à jour à distance) |
| `apps.previous.json` | version précédente, conservée avant chaque mise à jour |
| `favorites.json` | outils épinglés par l'utilisateur |
| `usage.json` | nombre d'ouvertures et date du dernier accès |
| `prefs.json` | thème, densité, menu latéral, Mica, position de fenêtre |
| `logs/strasedu.log` | journal applicatif (rotation à 512 Ko) |

Une **trace de démarrage** est écrite avant toute autre chose, dans
`%TEMP%\StrasEdu-demarrage.log` et à côté de l'exécutable en version
portable. Elle indique chaque étape du lancement et permet de diagnostiquer un
démarrage qui n'affiche rien — voir la section « Dépannage » de
[`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md).

> **Version portable** : le lanceur extrait environ 200 Mo dans un dossier
> temporaire à chaque lancement, ce qui prend de trente secondes à deux minutes
> selon l'antivirus, avec un écran « Chargement de l'application… ». Pour un
> usage quotidien, préférez l'installateur, qui démarre en moins d'une seconde.

## Raccourcis clavier

| Raccourci | Action |
| --- | --- |
| `Ctrl+K` | Recherche globale et actions |
| `/` | Aller au champ de recherche |
| `F1` | Aide et raccourcis |
| `Ctrl+,` | Réglages |
| `Alt+←` | Vue précédente |
| `Alt+1…9` | Accueil, catalogue, favoris, récents, puis les catégories |
| `↑` `↓` puis `Entrée` | Parcourir et ouvrir un résultat |
| `Ctrl+Entrée` | Mettre le résultat sélectionné en favori |
| `Échap` | Effacer la recherche ou fermer la fenêtre active |
