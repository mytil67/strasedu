# Gérer le catalogue — guide administrateur

Le catalogue est un fichier `apps.json` : la liste des outils, leurs catégories,
leurs couleurs et leurs descriptions. C'est **le seul fichier à modifier pour
faire vivre StrasEdu** — ajouter un outil, retirer une ressource, corriger une
URL, réordonner les catégories.

> Aucune réinstallation n'est nécessaire. Seul un changement du **logiciel**
> lui-même (interface, correctif) demande un redéploiement.

---

## 0. L'outil d'administration (application Windows)

Tout ce qui suit peut se faire à la main dans un éditeur de texte. L'outil
d'administration évite d'y toucher : il compose le catalogue, le valide et le
publie sur le partage réseau.

### Installation

| Fichier | Usage |
| --- | --- |
| `StrasEdu-Administration-2.1.1-setup.exe` | Installation classique : menu Démarrer et raccourci sur le bureau. |
| `StrasEdu-Administration-2.1.1-portable.exe` | Aucune installation : double-clic, l'outil s'ouvre. Pratique depuis une clé USB ou un partage. |

Aucun droit administrateur n'est requis, ni Node, ni npm : ce sont des
exécutables autonomes.

**Au premier lancement**, l'outil travaille sur une copie du catalogue livré,
placée dans votre profil (`%APPDATA%\StrasEdu Administration\apps.json`).
Vous pouvez la modifier sans risque : le catalogue installé sur les postes n'est
touché que lorsque vous cliquez sur **Publier**.

### Fabrication

```powershell
npm run build:admin     # écrit dans dist-admin/
```

### Ce que fait chaque onglet

| Onglet | Ce qu'on y fait |
| --- | --- |
| **Outils** | Ajouter, modifier, supprimer un outil ; lui affecter une icône parmi celles de StrasEdu, ou revenir à la pastille à deux lettres ; lui associer un **logo, une illustration et jusqu'à quatre captures d'écran** ; régler catégorie, type (site web ou logiciel installé), mots-clés, pastille chiffrée. |
| **Catégories** | Créer une catégorie, la renommer (les outils suivent), choisir son icône, sa couleur et sa description. |
| **Mise en avant** | Composer les **sélections d'outils mises en avant** sous le carrousel — « Le moment », « Le mois » : un libellé, puis les outils retenus, dans l'ordre où ils apparaîtront. |
| **Département** | Rédiger les **informations du carrousel** affiché en tête de l'accueil : titre, texte, image, lien « En savoir plus » et date. Les flèches changent l'ordre d'affichage. |
| **Application** | Logo de StrasEdu (il remplace la marque par défaut), version du catalogue, et dossier de publication. |

L'aperçu de catégorie et le bandeau supérieur montrent le résultat en direct.
La barre d'état indique en permanence si le catalogue est conforme, et les
outils fautifs sont marqués « à vérifier » dans la liste.

### Informations, mises en avant et visuels

Ces trois contenus se publient comme le reste du catalogue : aucune
réinstallation, les postes suivent à la prochaine vérification.

| Contenu | Règles |
| --- | --- |
| **Informations** (carrousel) | 12 au maximum. Une information sans titre, sans texte et sans image est écartée. Le lien doit être en `http` ou `https` : toute autre adresse est refusée à la saisie, et retirée à la validation si elle vient d'ailleurs. |
| **Mises en avant** | 3 sélections au maximum, 12 outils par sélection. Un outil retiré du catalogue disparaît aussi de la sélection, sans erreur. |
| **Visuels d'outils** | Une illustration et jusqu'à quatre captures d'écran par outil. Les images sont intégrées au catalogue : l'outil les redimensionne à l'import et choisit le format le plus léger (PNG pour une capture d'interface, JPEG pour une photo). Une image au-delà de 192 Ko de texte est écartée à la validation. |

> **Poids du catalogue.** Les visuels sont embarqués : c'est ce qui permet une
> seule publication, sans hébergement d'images, et un affichage qui ne dépend
> pas du réseau. En contrepartie, chaque image alourdit `apps.json` — que
> 2000 postes relisent. Restez sobre : une illustration par outil suffit
> largement, et les captures d'écran sont surtout utiles aux outils peu connus.
>
> Deux seuils, alignés sur ce que les postes acceptent :
>
> | Seuil | Ce qui se passe |
> | --- | --- |
> | **1,5 Mo** de visuels cumulés | Les images suivantes sont ignorées, et le journal de l'application nomme les outils concernés. En pratique, à 192 Ko par image au plus, un catalogue peut illustrer **une vingtaine d'outils** ; les vignettes réellement produites pèsent plutôt 40 à 80 Ko, ce qui laisse de la place. |
> | **1,6 Mo** de fichier | Avertissement, dans l'outil d'administration (survolez la pastille d'état) comme dans `update-catalog.ps1`. Enregistrer reste possible. |
> | **1,875 Mo** de fichier | **Publication refusée**, par l'outil d'administration comme par `update-catalog.ps1` : mieux vaut s'arrêter là que frôler la limite des postes. |
> | **2 Mo** de fichier | Les postes **refusent le catalogue entier** : plus rien ne se met à jour sur aucun poste. |

### Publier

1. **Application → Choisir le dossier…** : désigner le partage réseau
   (`\\serveur\partage\StrasEdu`). Le choix est mémorisé.
2. **Publier…** : validation, incrément automatique de la version, écriture de
   `apps.json` par fichier temporaire puis remplacement.

> **« Enregistrer » n'écrit jamais sur le partage.** Seul « Publier » le fait,
> et c'est lui qui incrémente la version. Enregistrer directement sur le
> partage diffuserait des changements **sans changer la version** — donc sans
> que le moindre poste ne se mette à jour. C'est le piège que l'outil évite.

« Charger le catalogue publié » relit ce qui est actuellement diffusé, pour le
corriger : le contenu remplace celui de l'éditeur, la cible d'enregistrement ne
change pas.

### Vérifier l'outil lui-même

Réservé au développement :

```powershell
npm run selfcheck:admin
```

Pilote l'interface sur un catalogue temporaire et vérifie chaque capacité, point
par point : outils, icônes, visuels et captures d'écran, catégories, informations
du carrousel, mises en avant, logo, enregistrement, publication, refus d'un
catalogue invalide. Les captures sont écrites dans `.preview/admin/`.

---

## 1. Le principe : c'est la version qui déclenche tout

L'application compare la `version` du catalogue publié à celle qu'elle possède :

| Comparaison | Ce que fait le poste |
| --- | --- |
| version identique | rien du tout |
| version différente | récupère, valide, remplace, et conserve l'ancienne en secours |
| catalogue invalide | **rejette** et continue avec l'ancienne version |

**C'est le point à retenir : modifier un outil sans changer la `version` ne met
rien à jour.** Le script de publication incrémente la version automatiquement
pour cette raison — ne le court-circuitez pas avec `-NoVersionBump` sans savoir
ce que vous faites.

---

## 2. Où héberger le catalogue

| | Partage réseau | GitLab |
| --- | --- | --- |
| Infrastructure | aucune (le partage existe déjà) | serveur web + forge |
| Requêtes à 2000 postes | 96 000/j de lectures SMB | 96 000/j, réduites à des `304` |
| Authentification | droits du partage | **le projet doit être lisible sans jeton** |
| Historique des versions | non | oui |

**Le partage réseau est recommandé en établissement** : pas de serveur
supplémentaire, pas de jeton, et les droits sont ceux que vous gérez déjà.

> **Piège de GitLab.** L'application lit l'adresse du catalogue **sans
> authentification**. Si votre projet est privé, les postes recevront un `401`
> et ne se mettront jamais à jour. Dans ce cas, publiez le catalogue vers un
> emplacement public, ou utilisez un partage réseau.

---

## 3. Le cycle de mise à jour

### Étape 1 — Modifier le catalogue

Éditez `apps.json`. Les règles à respecter :

- `id` unique par outil, jamais réutilisé ;
- `url` en `http` ou `https` pour un outil `"type": "web"` ;
- `path` absolu en `.exe` ou `.lnk` pour un outil `"type": "local"` ;
- `category` doit exister dans la liste `categories` ;
- les `keywords` améliorent la recherche : ce sont les mots que les enseignants
  taperont (« enregistrer », « voix », « micro »…) ;
- `news`, `highlights`, `image` et `screenshots` sont optionnels et suivent les
  règles du tableau « Informations, mises en avant et visuels » ci-dessus.

### Étape 2 — Valider avant de publier

```powershell
.\scripts\update-catalog.ps1 -AppsJsonPath .\apps.json -ValidateOnly
```

La validation reprend **exactement les règles appliquées par l'application** :
tout ce qu'elle signale comme erreur bloquante serait silencieusement écarté sur
les postes. Le rapport distingue :

- **[ERR] erreurs bloquantes** — la publication est refusée ;
- **[ATTN] avertissements** — la publication passe, mais quelque chose mérite un
  coup d'œil (catégorie non déclarée, `categoryMeta` manquant, couleur invalide…).

### Étape 3 — Publier

**Sur un partage réseau :**

```powershell
.\scripts\update-catalog.ps1 -AppsJsonPath .\apps.json `
                             -SharePath "\\serveur\partage\StrasEdu\apps.json"
```

Le fichier est écrit par fichier temporaire puis remplacé : un poste qui lit
pendant la copie ne tombe jamais sur un catalogue à moitié écrit.

**Vers GitLab :**

```powershell
.\scripts\update-catalog.ps1 -AppsJsonPath .\apps.json `
                             -GitLabUrl "https://gitlab.ac-strasbourg.fr" `
                             -ProjectId "123" -Token "glpat-xxxxxxxxxxxx"
```

### Étape 4 — Les postes récupèrent

Automatiquement, dans les 30 minutes (paramétrable via `checkIntervalMinutes`).
Les vérifications sont étalées aléatoirement pour ne pas frapper le serveur
toutes les demi-heures à la même seconde.

Pour forcer immédiatement sur un poste : **Réglages → Catalogue → Vérifier**.

---

## 4. Configurer les postes (une seule fois)

Créez `strasedu.config.json` dans le dossier `resources` de l'installation :

```json
{
  "remoteAppsUrl": "\\\\serveur\\partage\\StrasEdu\\apps.json",
  "checkIntervalMinutes": 30,
  "allowedLocalRoots": [
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData"
  ]
}
```

| Clé | Rôle |
| --- | --- |
| `remoteAppsUrl` | Adresse du catalogue : partage réseau (`\\serveur\…`), chemin local (`C:\…`), ou URL `http(s)`. Laissez vide pour un fonctionnement autonome. |
| `checkIntervalMinutes` | Fréquence de vérification. 30 par défaut ; 60 suffit largement. |
| `allowedLocalRoots` | *(optionnel)* Restreint les outils `type: "local"` à ces arborescences. |
| `startMinimized` | *(optionnel)* `true` = démarre dans la zone de notification sans ouvrir de fenêtre. Utile en lancement automatique à l'ouverture de session. |

Le script de déploiement écrit ce fichier pour vous :

```powershell
.\scripts\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu" `
                              -RemoteAppsUrl "\\serveur\partage\StrasEdu\apps.json"
```

> **Écrivez ce fichier sans BOM.** Bloc-notes et `Set-Content -Encoding UTF8` en
> ajoutent un. L'application le tolère depuis la version 2.0.0, mais autant
> l'éviter : `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.

---

## 5. Vérifier que la mise à jour est passée

**Sur un poste :** la barre d'état, en bas, indique l'état de synchronisation.
*Réglages → Catalogue* affiche la version, le nombre d'outils et la date,
et *Réglages → Source du catalogue* affiche **l'adresse distante réellement
configurée** avec la date de la dernière vérification. C'est le premier endroit
à regarder quand rien ne se met à jour : si cette ligne annonce « aucune source
distante », le fichier `strasedu.config.json` n'est pas lu — il doit se trouver
dans le sous-dossier `resources` de l'installation, pas à côté de l'exécutable.

**En masse :** le journal applicatif de chaque poste est dans
`%APPDATA%\StrasEdu\logs\strasedu.log` :

```
Catalogue mis à jour : v2.0.0 → v2.0.1
```

Et la trace de démarrage, dans `%TEMP%\StrasEdu-demarrage.log`, confirme
que la configuration est bien lue :

```
configuration lue — catalogue distant : configuré
```

Si elle indique `absent`, le `strasedu.config.json` n'est pas au bon endroit :
il doit être dans le sous-dossier `resources` de l'installation, pas à côté de
l'exécutable.

---

## 6. Revenir en arrière

Chaque poste conserve la version précédente avant de la remplacer :

```powershell
Copy-Item "$env:APPDATA\StrasEdu\apps.previous.json" `
          "$env:APPDATA\StrasEdu\apps.json" -Force
```

Puis relancez l'application. Si un catalogue publié pose problème, le plus
simple reste de republier la version précédente avec un numéro **supérieur**
(par exemple `2.0.5` après un `2.0.4` fautif) : les postes la reprendront
automatiquement.

---

## 7. Erreurs courantes

| Symptôme | Cause probable |
| --- | --- |
| Rien ne se met à jour | La `version` n'a pas changé — c'est le seul déclencheur. |
| Un outil a disparu après publication | Son `url` ou son `path` a été refusé par la validation. Lancez `-ValidateOnly`. |
| Aucun poste ne récupère | Adresse injoignable, ou projet GitLab privé sans accès anonyme. |
| `catalogue distant : absent` dans la trace | `strasedu.config.json` mal placé (il va dans `resources\`). |
| Les tuiles d'accueil sont ternes | `categoryMeta` incomplet : icône, couleur et description par catégorie. |
| Une information du carrousel n'a pas de lien | Son `url` n'était pas en `http` ou `https` : elle est publiée sans lien. |
| Un visuel n'apparaît pas sur les postes | Image au-delà de 192 Ko de texte, ou budget de 1,5 Mo de visuels atteint. Le journal de l'application (`%APPDATA%\StrasEdu\logs\strasedu.log`) nomme l'outil concerné. |
| Rien ne se met plus à jour, et le catalogue pèse plus de 2 Mo | Les postes refusent le catalogue **entier**. Allégez les visuels, puis republiez avec une version supérieure. |
| Une mise en avant est incomplète | Un des outils choisis n'existe plus dans le catalogue : il est écarté silencieusement. |
| Un outil installé ne se lance pas | `path` inexistant sur ce poste : *« Le logiciel n'est pas installé sur ce poste »*. |

---

## 8. Liste de contrôle avant chaque publication

- [ ] `-ValidateOnly` ne signale **aucune** erreur bloquante.
- [ ] Les avertissements ont été lus.
- [ ] Les URL et chemins locaux ont été testés sur un poste réel.
- [ ] La version a bien été incrémentée.
- [ ] La publication a réussi (`[OK] Publié`).
- [ ] Un poste pilote a récupéré la nouvelle version avant la diffusion générale.
