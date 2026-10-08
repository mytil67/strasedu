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
publie — vers un dossier partagé, ou directement vers l'adresse qui le sert aux
postes.

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
| **Application** | Logo de StrasEdu (il remplace la marque par défaut), version du catalogue, et destination de publication — un dossier, ou l'adresse `http(s)` qui sert le catalogue aux postes. |

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

1. **Application → destination** : un dossier — `\\serveur\partage\StrasEdu`, ou
   `Z:\` si le partage est monté — **ou une adresse**,
   `http://serveur:3000/strasedu/apps.json`. Le choix est mémorisé.
   Pour une adresse `https`, renseignez aussi l'**empreinte SHA-256 du
   certificat** et le **jeton de publication** (conservé chiffré par Windows).
   L'outil refuse de publier s'il en manque un : c'est volontaire.
2. **Publier…** : validation, incrément automatique de la version, puis dépôt —
   écriture par fichier temporaire sur un dossier, ou requête `PUT` vers
   l'adresse. Sur une adresse, l'outil relit ensuite le catalogue servi pour
   vérifier que le dépôt a bien abouti.

> **« Enregistrer » n'écrit jamais à la destination.** Seul « Publier » le fait,
> et c'est lui qui incrémente la version. Enregistrer directement à la
> destination diffuserait des changements **sans changer la version** — donc
> sans que le moindre poste ne se mette à jour. C'est le piège que l'outil
> évite.

« Charger le catalogue publié » relit ce qui est actuellement diffusé — dossier
ou adresse — pour le corriger : le contenu remplace celui de l'éditeur, la cible
d'enregistrement ne change pas.

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

Trois hébergements possibles, lus de la même façon par l'application : changer
d'hébergement ne demande aucune réinstallation, seule l'adresse change.

| | Partage réseau | Serveur web (Raspberry Pi, nginx…) | GitLab |
| --- | --- | --- | --- |
| Infrastructure | aucune (le partage existe déjà) | un serveur web sur le réseau | forge + projet |
| Coût d'une vérification | une lecture des métadonnées | une requête, `304` si rien n'a changé | idem |
| Authentification | droits du partage — **et le blocage Windows des connexions invitées** | aucune en lecture ; compte pour le dépôt | **le projet doit être lisible sans jeton** |
| Publication depuis l'outil | vers le dossier partagé | **vers l'adresse** (dépôt `PUT`) | par `update-catalog.ps1` |
| Historique des versions | non | non | oui |

En établissement, le partage réseau reste le plus simple — à condition que les
postes puissent l'ouvrir, ce que Windows refuse désormais pour l'accès **invité**
(voir le piège ci-dessous). Un serveur web évite complètement cette question.

> **Piège du partage invité.** Depuis Windows 10 1709, les connexions SMB
> anonymes sont bloquées par défaut : un partage Samba sans compte est illisible
> depuis un poste école. Deux issues — activer « Activer les connexions invitées
> non sécurisées » par GPO sur les postes, ou donner au partage un compte et ne
> le monter que sur le poste d'administration, les postes lisant le catalogue en
> `http`.

### Publier par le service du Raspberry Pi

Le service du Pi (**EduDeploy**) expose deux points d'entrée distincts, et cette
séparation est volontaire :

| | Lecture (toute la flotte) | Écriture (poste d'administration) |
| --- | --- | --- |
| Adresse | `GET http://192.168.6.164:3000/strasedu/apps.json` | `PUT https://192.168.6.164/strasedu/apps.json` |
| Port | 3000, en clair | 443, chiffré |
| Jeton | aucun | `Authorization: Bearer <jeton>` |

> **Le jeton ne doit jamais passer par le port 3000**, qui est en clair : il y
> serait lisible par n'importe qui sur le réseau. C'est pourquoi l'outil
> d'administration **refuse** de publier vers une adresse `http://`.

Le contrat du service :

- le corps est le document JSON complet, **un objet** (jamais un tableau), et
  **1 Mo maximum** — il remplace entièrement le précédent, sans mise à jour
  partielle ;
- lisez d'abord, puis protégez votre écriture : l'outil fait un `GET`, conserve
  l'`ETag` reçu et l'envoie dans `If-Match` lors du `PUT`. Si quelqu'un a publié
  entre-temps, le service répond `412` plutôt que d'écraser son travail ;
- le certificat du Pi n'étant pas reconnu par Windows, l'outil l'**épingle** :
  il compare l'empreinte SHA-256 du certificat à celle que vous avez saisie. Sans
  empreinte renseignée, il ne publie pas — et la vérification TLS n'est jamais
  désactivée globalement.

Dans l'outil d'administration, onglet **Application** :

| Champ | Valeur |
| --- | --- |
| Destination de publication | `https://192.168.6.164/strasedu/apps.json` |
| Adresse de lecture des postes | `http://192.168.6.164:3000/strasedu/apps.json` — laissée vide, elle est déduite de la destination (même hôte, même chemin, port 3000) |
| Empreinte SHA-256 du certificat | l'empreinte relevée ci-dessous |
| Jeton de publication | le jeton `sedu_…`, conservé **chiffré** par Windows |

L'outil relit l'adresse de lecture après le dépôt, pour vérifier que le catalogue
est bien **servi** — pas seulement accepté.

| Réponse | Ce qu'elle signifie | Ce que fait l'outil |
| --- | --- | --- |
| `200` | publié (`{ ok, etag, modifieLe }`) | affiche la version et la date |
| `400` | le corps n'est pas un objet JSON | signale un catalogue invalide |
| `401` | jeton invalide | **ne réessaie pas**, demande un nouveau jeton |
| `412` | le document a changé depuis la lecture | propose de recharger le catalogue publié |
| `413` | document trop gros | signale la limite de 1 Mo |
| `503` | service désactivé, ou jeton non configuré | signale le service, pas le réseau |

**L'empreinte du certificat** se lit depuis un poste école, dans un navigateur :
ouvrez `https://192.168.6.164/strasedu/apps.json`, cliquez sur le cadenas →
certificat → détails → empreinte SHA-256. Ou en PowerShell :

```powershell
$tcp = New-Object System.Net.Sockets.TcpClient('192.168.6.164', 443)
$ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { $true })
$ssl.AuthenticateAsClient('192.168.6.164')
$cert = $ssl.RemoteCertificate
(([System.Security.Cryptography.SHA256]::Create().ComputeHash($cert.GetRawCertData())) |
  ForEach-Object { $_.ToString('x2') }) -join ':'
$ssl.Dispose(); $tcp.Dispose()
```

> Le jeton est conservé **chiffré** par l'outil, à l'aide du magasin protégé de
> Windows (DPAPI) : il n'est jamais écrit en clair, ni dans un fichier de
> configuration, ni dans un journal. Il reste néanmoins un secret : ne le
> déposez pas dans un dépôt, et régénérez-le s'il a circulé par un autre canal
> (courriel, ticket, conversation).

> **Conséquence de la limite de 1 Mo.** Elle devient votre plafond réel : avec
> des visuels d'outils, comptez une quinzaine d'outils illustrés. Si vous en
> voulez davantage, la seule vraie solution est de faire relever la limite du
> service à 2 Mo — c'est un réglage côté Pi.

### Alternative : monter soi-même le service

Sans service existant, nginx suffit pour la lecture, et gère nativement les
`ETag` : un poste ne retélécharge le catalogue que lorsqu'il a changé.

```nginx
# /etc/nginx/sites-available/strasedu
server {
    listen 3000;
    # Le chemin servi est root + URI : /srv + /strasedu/apps.json.
    root /srv;

    location = /strasedu/apps.json {
        default_type application/json;
        etag on;
        allow 192.168.6.0/24;
        deny all;
    }

    location / { return 404; }
}
```

```bash
sudo mkdir -p /srv/strasedu
sudo chown www-data:www-data /srv/strasedu
sudo systemctl reload nginx
```

Pour la seule lecture, cela suffit : publiez vers un **dossier local** puis
déposez `apps.json` dans `/srv/strasedu/` (par `scp`, par exemple).

**Si vous voulez publier directement depuis l'outil, il faut du `https`** —
l'outil refuse d'envoyer le jeton en clair, sur la même règle que le service du
Pi. Un certificat **auto-signé convient** : l'outil épingle l'empreinte, il ne
se fie à aucune autorité. Le contrôle du jeton se fait alors dans nginx :

```nginx
# Le jeton attendu par le dépôt. Ce fichier contient un secret :
# chmod 600, et remplacez la valeur.
map $http_authorization $strasedu_jeton_ok {
    default                             0;
    "Bearer remplacez-par-votre-jeton"  1;
}

server {
    listen 443 ssl;
    ssl_certificate     /etc/nginx/strasedu.crt;   # auto-signé : suffisant
    ssl_certificate_key /etc/nginx/strasedu.key;
    root /srv;

    location = /strasedu/apps.json {
        default_type application/json;
        etag on;
        # Le catalogue peut approcher 2 Mo : sans cette ligne, le dépôt est
        # refusé avec un 413, et l'outil le dit.
        client_max_body_size 4m;

        allow 192.168.6.0/24;
        deny all;

        dav_methods PUT;

        # Lecture anonyme ; seul le dépôt exige le jeton. Le premier test
        # n'affecte la variable que pour un PUT : un GET la laisse vide, donc
        # passe.
        if ($request_method = PUT) { set $strasedu_garde "${strasedu_jeton_ok}"; }
        if ($strasedu_garde = 0) { return 403; }
    }

    location / { return 404; }
}
```

Trois points vérifiés dans la documentation de nginx, qui évitent des heures de
doute :

- `limit_except GET { … }` — utilisé ci-dessus pour un service protégé par mot
  de passe — est **exactement** le montage de l'exemple officiel du module
  WebDAV : « exiger une autorisation pour toute méthode autre que GET ».
- Un fichier déposé par `PUT` est **d'abord écrit dans un fichier temporaire,
  puis renommé** : un poste ne peut jamais lire un catalogue à moitié écrit.
- Le module WebDAV n'est pas compilé par défaut dans nginx. Les paquets Debian
  et Raspberry Pi OS l'activent, mais vérifiez-le :
  ```bash
  nginx -V 2>&1 | grep -- --with-http_dav_module
  ```
  Si la ligne ne sort pas, installez `nginx-full`.

> Si `/srv` est un point de montage distinct, posez
> `client_body_temp_path /srv/nginx-tmp;` dans le bloc `server` : le
> renommage final doit rester sur le même système de fichiers, sinon nginx
> recopie le fichier au lieu de le renommer.

Côté postes, l'adresse de lecture est la même dans tous les cas :

```json
{ "remoteAppsUrl": "http://192.168.6.164:3000/strasedu/apps.json" }
```

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
toutes les demi-heures à la même seconde. **Réglages → Source du catalogue**
indique l'heure du dernier contrôle *et* le délai avant le prochain : c'est ce
qui permet de constater que la mécanique tourne, sans attendre.

Pour forcer immédiatement sur un poste : **Réglages → Catalogue → Vérifier**.

**Un catalogue reçu n'est jamais affiché de force.** Le remplacer sous les yeux
d'un enseignant en pleine recherche serait désagréable : le poste installe la
nouvelle version, puis propose de l'afficher. Une **bannière en haut de la
fenêtre** annonce la nouvelle version et propose « Recharger maintenant » :

> ⟳ **Nouvelle version 2.3.0 du catalogue disponible**
> Sans action de votre part, elle s'appliquera au prochain démarrage.
> \[ Recharger maintenant \] \[ × \]

Elle reste affichée tant que le catalogue n'a pas été rechargé ou l'invitation
masquée — elle ne s'efface pas toute seule. Le bouton `×` la masque pour la
session sans rien perdre : le catalogue s'appliquera au prochain démarrage, et
**Réglages → Catalogue → Recharger maintenant** permet de le reprendre à tout
moment. La pastille de la barre d'état, en bas, la rappelle discrètement.

> C'est délibéré : un message fugace de quelques secondes a laissé des postes
> entiers sur l'ancien catalogue sans que personne ne s'en aperçoive, puisque le
> fichier, lui, avait déjà changé. La version reçue est de toute façon appliquée
> au prochain démarrage de l'application.

Pour éprouver le cycle automatique sans attendre une demi-heure, posez
temporairement `"checkIntervalMinutes": 2` dans `strasedu.config.json`, puis
rouvrez l'application : le premier contrôle a lieu dans la minute qui suit, et
**Réglages → Source du catalogue** affiche le compte à rebours.

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
| « catalogue distant illisible : Unexpected token » | Le fichier servi contient un **BOM** (octets `EF BB BF`) — un éditeur Windows en ajoute un dès qu'on enregistre en UTF-8. L'application le retire désormais ; si le message persiste, le fichier n'est pas du JSON valide. |
| Les tuiles d'accueil sont ternes | `categoryMeta` incomplet : icône, couleur et description par catégorie. |
| Une information du carrousel n'a pas de lien | Son `url` n'était pas en `http` ou `https` : elle est publiée sans lien. |
| Un visuel n'apparaît pas sur les postes | Image au-delà de 192 Ko de texte, ou budget de 1,5 Mo de visuels atteint. Le journal de l'application (`%APPDATA%\StrasEdu\logs\strasedu.log`) nomme l'outil concerné. |
| Publication refusée, `401` | Jeton refusé par le service. Demandez-en un nouveau : l'outil ne réessaie pas, pour ne pas verrouiller le compte. |
| Publication refusée, `403` | Le service refuse l'accès à cette adresse, ou le jeton ne correspond pas. |
| Publication refusée, `412` | Quelqu'un a publié entre-temps. Rechargez « Charger le catalogue publié », puis republiez. |
| Publication refusée, `413` | Document au-delà de la limite du service (1 Mo). Allégez les visuels. Sur un service que vous montez vous-même : `client_max_body_size 4m;` dans nginx. |
| Publication refusée, `405` | Le serveur n'accepte pas le dépôt `PUT` à cette adresse (module WebDAV absent, sur un nginx que vous montez vous-même). |
| Publication refusée, `503` | Service de dépôt désactivé, ou jeton non configuré côté Pi. |
| Publication refusée avant tout envoi | Empreinte du certificat absente ou différente de celle présentée, jeton absent, ou destination en `http`. L'outil refuse de s'y connecter — c'est voulu. |
| L'outil dit avoir publié mais les postes ne voient rien | L'adresse de publication n'est pas celle qui est servie. Ouvrez l'adresse de lecture dans un navigateur : le catalogue doit s'y afficher. |
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
