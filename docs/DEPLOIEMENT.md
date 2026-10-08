# Déployer StrasEdu sur Windows 11

Guide destiné au service informatique de l'établissement.

---

## 0. Ce qui se met à jour, et comment

C'est la question qui commande tout le reste. Il faut distinguer deux choses.

| Ce qui change | Fréquence | Moyen | Réinstallation ? |
| --- | --- | --- | --- |
| **Le catalogue** : ajouter un outil, corriger une URL, réordonner les catégories, changer une description | Souvent | Une poussée de `apps.json` | **Jamais** |
| **L'application** : interface, sécurité, correctif | Quelques fois par an | Script de parc ou installateur | Automatique, sans intervention |

**Le catalogue porte l'essentiel de la vie de StrasEdu.** Une nouvelle version de
`apps.json` est récupérée par tous les postes dans les 30 minutes (ou
immédiatement, au premier lancement suivant) — voir §4. Vous n'avez donc pas à
redéployer quoi que ce soit pour ajouter ou retirer un outil.

**Le binaire ne change que rarement.** Pour ces quelques fois par an, le script
`scripts/install-strasedu.ps1` est **idempotent** : relancé sur un poste déjà à
jour, il ne copie rien et se termine en une seconde. Vous pouvez donc le
déclencher à chaque ouverture de session par GPO, sans effet de bord.

> **En résumé : non, vous n'aurez pas à réinstaller à chaque mise à jour.**
> Le contenu se met à jour tout seul ; le binaire se met à jour par le script
> que vous planifiez une fois.

---

## 1. Deux voies de déploiement

### Voie A — l'installateur NSIS (recommandée pour un poste isolé)

L'installateur est **par machine** : il installe pour tous les utilisateurs du
poste, dans `C:\Program Files\StrasEdu`, et demande l'élévation **avant**
d'afficher l'assistant. Il n'y a donc aucune question de portée à l'écran, et
rien qui puisse échouer en cours d'assistant.

> Windows refuse de lancer un exécutable qui exige l'élévation depuis un
> processus non élevé (`CreateProcess` renvoie alors `ERROR_ELEVATION_REQUIRED`).
> Un script de déploiement doit donc l'appeler par `Start-Process`, jamais par
> `&` ni par `spawn` : seul `Start-Process` passe par ShellExecute.

| Fichier produit | Portée | Droits admin | Usage |
| --- | --- | --- | --- |
| `StrasEdu-2.1.1-x64-setup.exe` | Tous les utilisateurs du poste | Oui, à l'installation | Installation manuelle ou déploiement de parc. Dossier fixe : `C:\Program Files\StrasEdu`. |
| `StrasEdu-2.1.1-portable.exe` | Aucune | Non | Poste partagé, clé USB, ou essai sans installation. Aucun raccourci. |

Pour une installation propre à un seul utilisateur et sans droits
particuliers, utilisez la version portable, ou `install-strasedu.ps1` sans
`-AllUsers`.

### Voie B — le script de déploiement (recommandée pour un parc)

`scripts/install-strasedu.ps1` copie le dossier de l'application, crée les
raccourcis et l'entrée de désinstallation. Aucun assistant, aucune écriture de
registre pendant la copie, aucun droit administrateur en mode utilisateur.

```powershell
# Première installation sur un poste, avec le catalogue sur un partage réseau
.\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu" `
                      -RemoteAppsUrl "\\serveur\partage\StrasEdu\apps.json"

# La même chose avec un catalogue servi en https
.\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu" `
                      -RemoteAppsUrl "https://…/apps.json"

# Mise à jour : la même commande. Elle ne copie que si la version a changé.
# Le fichier strasedu.config.json déjà en place n'est jamais écrasé.
.\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu"

# Pour tous les utilisateurs du poste (élévation requise)
.\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu" -AllUsers

# Savoir si une mise à jour est disponible, sans rien modifier
# (code de sortie 0 = à jour, 10 = mise à jour disponible)
.\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu" -CheckOnly

# Désinstallation
.\install-strasedu.ps1 -Uninstall
```

Chaque exécution, même sans changement de version :

- réapplique la configuration du catalogue distant ;
- recrée un raccourci supprimé par un utilisateur ;
- vérifie l'entrée « Applications et fonctionnalités ».

Le script est donc **réparateur** : un poste dérivé revient dans l'état voulu à
la prochaine ouverture de session. Le journal est écrit dans
`%TEMP%\strasedu-deploiement.log`, ce qui permet de le rapatrier depuis 2000
postes.

> Le script se copie lui-même dans `<installation>\_deploy\`, de sorte que la
> désinstallation et les mises à jour suivantes disposent de leur propre outil,
> même si le partage réseau d'origine a disparu.

---

## 2. Installation silencieuse (installateur NSIS)

**Le dossier d'installation n'est plus modifiable dans l'assistant.** Il est
fixe, ce qui est indispensable à l'échelle d'un parc : une même application au
même endroit sur tous les postes, donc des règles de détection, des scripts de
support et des désinstallations qui fonctionnent partout.

| Portée | Dossier d'installation |
| --- | --- |
| Tous les utilisateurs (seule disponible) | `C:\Program Files\StrasEdu` |

> **L'installateur ne propose plus de choix de portée.** Installer pour le seul
> utilisateur courant obligeait l'assistant à s'élever *en cours de route*, via
> le greffon UAC de NSIS. Sur un poste où l'élévation est silencieuse
> (`ConsentPromptBehaviorAdmin = 0`), cette bascule échouait sans rien afficher :
> la fenêtre se masquait, le processus élevé ne prenait pas la main, et
> l'installateur se terminait sans avoir rien installé. L'élévation a donc lieu
> **avant** l'assistant, par le manifeste de l'exécutable.

```powershell
# Installation par machine (l'élévation est demandée automatiquement)
Start-Process -FilePath .\StrasEdu-2.1.1-x64-setup.exe -ArgumentList "/S" -Wait

# Désinstallation silencieuse (même contrainte : Start-Process)
Start-Process -FilePath "C:\Program Files\StrasEdu\Uninstall StrasEdu.exe" -ArgumentList "/S" -Wait
```

> `/S /currentuser` n'existe plus. Pour une installation sans droits
> particuliers, utilisez la version portable, ou `install-strasedu.ps1` sans
> `-AllUsers`.

Un dossier particulier reste imposable **en ligne de commande**, pour un cas
particulier : `/D=C:\Outils\StrasEdu`. `/D` doit être le **dernier** argument et
ne pas être entouré de guillemets.

> **Si l'installateur échoue sur un fichier**, utilisez la voie B (§1) : elle
> n'écrit aucun fichier temporaire, ne génère pas de désinstalleur et ne touche
> pas au registre pendant la copie. Elle vérifie en outre que la destination
> est accessible en écriture **avant** de commencer, et le dit clairement.

### GPO / SCCM / Intune

- **SCCM / Intune** : programme d'installation
  `StrasEdu-2.1.1-x64-setup.exe`, arguments `/S`, détection sur
  l'existence de `C:\Program Files\StrasEdu\StrasEdu.exe`.
- **GPO (script de démarrage ordinateur)** : exécuter l'installateur avec
  `/S /allusers` depuis un partage `\\serveur\netlogon`.
- Les données de chaque utilisateur (favoris, réglages, historique) restent dans
  son profil, quelle que soit la portée de l'installation.

---

## 3. Signature de code — à faire avant tout déploiement de masse

Un exécutable non signé déclenche **SmartScreen** : « Windows a protégé votre
PC », avec un bouton *Informations complémentaires* → *Exécuter quand même*.
Sur un parc scolaire, c'est un appel au helpdesk par installation, et un
vecteur d'habituation à ignorer les avertissements de sécurité.

electron-builder signe automatiquement dès que les variables d'environnement
standard sont présentes — aucune modification de configuration n'est requise.

```powershell
$env:CSC_LINK = "C:\certificats\stras-edu.pfx"   # ou une URL https
$env:CSC_KEY_PASSWORD = "…"
npm run build
```

Variantes utiles :

| Cas | Variables |
| --- | --- |
| Certificat dans le magasin Windows | `CSC_NAME="STRAS EDU"` |
| HSM / jeton physique (EV) | `CSC_LINK="pkcs11:…"`, `CSC_KEY_PASSWORD="…"` |
| Signature via Azure Trusted Signing | `WIN_CSC_LINK` + configuration `azureSignOptions` |

Vérifier la signature après fabrication :

```powershell
Get-AuthenticodeSignature .\dist\StrasEdu-2.1.1-x64-setup.exe |
    Format-List Status, SignerCertificate
```

`Status` doit valoir `Valid`.

> **Si vous ne pouvez pas signer** : faites publier l'empreinte du fichier
> (SHA-256) avec le lien de téléchargement, et diffusez l'installateur par
> partage réseau ou par GPO plutôt que par téléchargement direct — SmartScreen
> ne s'applique qu'aux fichiers marqués « venus d'Internet ».

```powershell
Get-FileHash .\dist\StrasEdu-2.1.1-x64-setup.exe -Algorithm SHA256
```

---

## 4. Configurer le catalogue distant

Sans configuration, l'application utilise le catalogue `apps.json` livré avec
l'installateur — parfaitement fonctionnel, mais figé à la version publiée.

Pour mettre le catalogue à jour à distance, deux méthodes au choix.

### Méthode A — fichier de configuration (recommandé)

Créez `strasedu.config.json` **à côté de l'exécutable**, dans
`C:\Program Files\StrasEdu\resources\` :

```json
{
  "remoteAppsUrl": "https://gitlab.ac-strasbourg.fr/api/v4/projects/123/repository/files/apps.json/raw?ref=main",
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
| `remoteAppsUrl` | Adresse du catalogue : partage réseau (`\\serveur\StrasEdu\apps.json`), chemin local (`C:\…`), ou URL `http(s)`. Laissez vide pour un fonctionnement hors ligne. |
| `checkIntervalMinutes` | Fréquence de vérification, 30 par défaut. |
| `allowedLocalRoots` | *(optionnel)* Restreint les outils `type: "local"` à ces arborescences. Si la clé est absente, tout chemin absolu en `.exe` ou `.lnk` existant est accepté. |

### Méthode B — variable d'environnement

```powershell
[Environment]::SetEnvironmentVariable(
  "STRASEDU_REMOTE_URL",
  "https://gitlab.ac-strasbourg.fr/api/v4/projects/123/repository/files/apps.json/raw?ref=main",
  [EnvironmentVariableTarget]::Machine
)
```

`STRASEDU_REMOTE_URL` est prioritaire sur `strasedu.config.json`.

### Publier une nouvelle version du catalogue

```powershell
.\scripts\update-catalog.ps1 -GitLabUrl "https://gitlab.ac-strasbourg.fr" `
                             -ProjectId "123" `
                             -Token "glpat-xxxxxxxxxxxx" `
                             -AppsJsonPath ".\apps.json"
```

Le script incrémente la version de patch, met à jour `lastUpdated` et pousse le
fichier. Les postes le récupèrent à la prochaine vérification (30 minutes, ou
immédiatement via *Réglages → Catalogue → Vérifier*).

**Le catalogue distant ne remplace la copie locale que s'il est valide.** En cas
de JSON illisible, de champ manquant ou d'URL non `http(s)`, la mise à jour est
rejetée, l'erreur est journalisée, et la version précédente reste en service.

### Charge serveur à l'échelle d'un parc

L'application utilise une **requête conditionnelle** : elle mémorise l'`ETag`
renvoyé par le serveur — y compris d'un lancement à l'autre — et le présente en
`If-None-Match`. Le serveur répond alors `304 Not Modified`, sans corps.

| | Sans requête conditionnelle | Avec `ETag` |
| --- | --- | --- |
| Requêtes par jour (2000 postes, 30 min) | 96 000 | 96 000 |
| Volume transféré par jour | ~750 Mo | **~29 Mo** |

> Ces volumes supposent un catalogue **texte** d'environ 10 Ko. Depuis que les
> visuels y sont embarqués, il peut approcher 2 Mo : multipliez d'autant. Le
> `304` reste la protection principale — sans lui, chaque poste
> retéléchargerait tout le catalogue au premier contrôle de chaque lancement.

Les vérifications sont en outre **étalées aléatoirement** (± 15 % autour de
l'intervalle, et sur la première minute après l'ouverture de session). Sans cet
étalement, 2000 postes démarrés à 8 h interrogeraient le serveur dans la même
seconde, puis resteraient en cadence.

Pour réduire encore la charge, vous pouvez porter `checkIntervalMinutes` à 60
dans `strasedu.config.json` : le catalogue change rarement, et une vérification
horaire suffit largement.

---

## 5. Mettre à jour l'application elle-même

Le catalogue se met à jour tout seul. Pour publier une nouvelle version du
binaire :

1. incrémentez `version` dans `package.json` ;
2. fabriquez l'application et publiez le **dossier** (voir ci-dessous) ;
3. laissez le script de parc faire le reste — il ne copiera que sur les postes
   dont la version diffère.

### Publier le dossier à déployer

Le dossier à publier sur le partage réseau est `dist\win-unpacked` : c'est
l'application complète, sans installateur.

```powershell
npm run build
robocopy .\dist\win-unpacked "\\serveur\partage\StrasEdu" /MIR
```

Les postes le récupèrent à leur prochaine ouverture de session. Un poste déjà à
jour ne copie rien : l'opération prend une seconde.

### Déploiement par GPO (script de démarrage ordinateur)

```powershell
\\serveur\netlogon\StrasEdu\install-strasedu.ps1 `
    -Source "\\serveur\partage\StrasEdu" `
    -RemoteAppsUrl "\\serveur\partage\StrasEdu\apps.json" `
    -AllUsers -Quiet
```

`-RemoteAppsUrl` accepte les trois formes que l'application sait lire : partage
réseau (`\\serveur\…`), chemin local (`D:\…`) ou URL `http(s)`.

Le script est idempotent : il peut être exécuté à chaque démarrage sans risque.

### Progression recommandée sur 2000 postes

Ne déployez jamais en une seule vague.

| Vague | Périmètre | Objectif |
| --- | --- | --- |
| 1 | 5 à 10 postes volontaires | Vérifier l'installation, les raccourcis, le catalogue, le rendu à 100/150/200 %. |
| 2 | Un site ou un niveau complet (~100 postes) | Valider la charge serveur et l'absence de faux positifs antivirus. |
| 3 | Le reste du parc, par groupes | Déploiement nominal. |

L'application **conserve** les favoris, les réglages et l'historique de chaque
utilisateur d'une version à l'autre : rien n'est perdu lors d'une mise à jour.

### Mise à jour automatique intégrée

`electron-updater` n'est **pas** embarqué. Sur un parc géré, la mise à jour par
GPO/SCCM est préférable : elle est traçable, s'arrête en cas d'erreur, respecte
les vagues, et ne dépend ni d'un serveur de publication supplémentaire ni de la
signature de code. Elle peut être ajoutée si certains postes échappent à votre
gestion de parc.

---

## 6. Fabrication des installateurs

```powershell
npm run build           # installateur + version portable
npm run build:portable  # version portable seule
```

> **Première fabrication sur un poste** : electron-builder télécharge un paquet
> d'outils de signature contenant des liens symboliques macOS. Windows ne les
> crée que pour un compte administrateur ou en mode développeur ; sans cela,
> 7-Zip sort en code 2 et la fabrication s'arrête. Lancez une fois :
>
> ```powershell
> npm run fix-builder-cache
> ```
>
> Ce script réextrait le paquet sans le dossier macOS. Il ne demande aucun
> droit particulier.

> **À savoir sur la version portable.** Le lanceur portable extrait
> l'application (environ 200 Mo) dans un dossier temporaire **à chaque
> lancement**, puis la supprime à la fermeture. Sur un poste où l'antivirus
> analyse les fichiers extraits, cette étape prend couramment de trente
> secondes à deux minutes. Un écran « Chargement de l'application… » s'affiche
> pendant ce temps : c'est normal, il ne faut pas relancer l'exécutable.
> Pour un usage quotidien, préférez l'installateur ou le script de parc.

---

## 7. Emplacements et dépannage

| Élément | Chemin |
| --- | --- |
| Application (par machine) | `C:\Program Files\StrasEdu\` |
| Application (par utilisateur) | `%LOCALAPPDATA%\Programs\StrasEdu\` |
| Configuration | `…\StrasEdu\resources\strasedu.config.json` |
| Données utilisateur | `%APPDATA%\StrasEdu\` |
| Journal applicatif | `%APPDATA%\StrasEdu\logs\strasedu.log` |
| **Trace de démarrage** | `%TEMP%\StrasEdu-demarrage.log` et, en version portable, à côté de l'exécutable |

### Diagnostiquer un démarrage qui n'affiche rien

L'application écrit une **trace de démarrage** avant toute autre chose, y
compris quand le profil utilisateur n'est pas encore accessible. Elle indique
chaque étape : lecture de la configuration, verrou d'instance, création de la
fenêtre, chargement du catalogue, affichage.

```
2026-10-07T17:11:14.642Z  ── démarrage ── version=2.0.0 portable=oui empaqueté=oui
2026-10-07T17:11:14.648Z  verrou d'instance unique obtenu
2026-10-07T17:11:14.777Z  fenêtre créée, chargement de l'interface (Mica=activé)
2026-10-07T17:11:15.061Z  catalogue chargé — 20 outils, v2.0.0
2026-10-07T17:11:15.149Z  fenêtre affichée (ready-to-show)
```

La dernière ligne écrite désigne l'étape qui a échoué :

| Dernière ligne | Interprétation |
| --- | --- |
| *(fichier absent)* | Le processus n'a pas démarré : antivirus, stratégie de blocage d'exécution, ou launcher portable encore en extraction. |
| `verrou d'instance unique obtenu`, puis rien | Échec avant la création de la fenêtre. |
| `délai de sécurité` à la place de `ready-to-show` | La fenêtre a dû être affichée de force : pilote graphique capricieux. |
| `EXCEPTION : …` | Erreur du processus principal ; le détail suit la ligne. |
| `CATALOGUE INDISPONIBLE` | Aucun `apps.json` exploitable : ni la copie locale, ni celle embarquée. |

### La version portable ne semble rien ouvrir

C'est le comportement attendu pendant l'extraction : le lanceur portable est
silencieux par nature, et l'écran de chargement n'apparaît qu'une fois le
launcher démarré. Comptez de trente secondes à deux minutes selon l'antivirus.

- Ne relancez pas l'exécutable : chaque double-clic lance une nouvelle
  extraction complète.
- Vérifiez `dist\StrasEdu-demarrage.log` (à côté de l'exécutable portable) :
  s'il contient les lignes de démarrage, l'application tourne et sa fenêtre est
  ouverte ou réduite dans la zone de notification.
- Pour un usage quotidien, utilisez l'installateur.

### Rien ne se passe au second lancement

L'application ne se ferme pas quand on ferme sa fenêtre : elle reste dans la
zone de notification, et StrasEdu n'accepte qu'une seule instance. Un nouveau
lancement ramène simplement la fenêtre existante au premier plan.

Pour quitter réellement : clic droit sur l'icône de la notification → **Quitter**.

### SmartScreen bloque l'installation

Signez l'exécutable (§3). À défaut, diffusez-le par partage réseau ou GPO.

### L'application s'ouvre puis rien ne se passe

Elle est probablement déjà lancée : StrasEdu n'accepte qu'une seule instance
et ramène la fenêtre existante au premier plan. Vérifiez aussi la zone de
notification : fermer la fenêtre ne quitte pas l'application.

### « Le logiciel n'est pas installé sur ce poste »

Un outil `type: "local"` du catalogue pointe vers un exécutable absent.
Corrigez le champ `path` dans `apps.json`, ou retirez l'entrée. Le reste du
catalogue continue de fonctionner.

### Le catalogue distant n'est jamais récupéré

1. *Réglages → Catalogue* indique l'état de la dernière synchronisation.
2. Consultez `%APPDATA%\StrasEdu\logs\strasedu.log`.
3. Vérifiez que le poste accède à l'URL (`Invoke-WebRequest $url`).
4. Une entrée de catalogue invalide est ignorée silencieusement dans
   l'interface mais **comptée dans le journal** : cherchez « entrée(s) du
   catalogue ignorée(s) ».

### Revenir à la version précédente du catalogue

```powershell
Copy-Item "$env:APPDATA\StrasEdu\apps.previous.json" `
          "$env:APPDATA\StrasEdu\apps.json" -Force
```

Puis relancez l'application. Si la copie locale est corrompue, elle est
automatiquement renommée `apps.json.corrupt` et la copie embarquée reprend la
main.

### Repartir d'un profil propre

```powershell
Remove-Item "$env:APPDATA\StrasEdu" -Recurse -Force
```

---

## 8. Liste de contrôle avant déploiement

- [ ] Icône applicative générée (`npm run icons`) et présente dans `icons/`.
- [ ] `apps.json` relu : identifiants uniques, URL en `https`, chemins locaux
      réellement présents sur les postes.
- [ ] `categoryMeta` renseigné pour chaque catégorie (icône, couleur,
      description) — c'est ce qui rend l'accueil lisible.
- [ ] **Binaire signé** et `Get-AuthenticodeSignature` en `Valid`. C'est le
      point le plus critique à l'échelle d'un parc.
- [ ] Dossier `dist\win-unpacked` publié sur le partage réseau.
- [ ] `strasedu.config.json` déployé et **relu par l'application** (vérifier
      « configuration lue — catalogue distant : configuré » dans la trace de
      démarrage ; un BOM en tête de fichier suffisait à l'ignorer avant la
      version 2.0.0 finale).
- [ ] Test sur un poste Windows 11 avec un **compte non administrateur**.
- [ ] Vérification du rendu à 100 %, 150 % et 200 % de mise à l'échelle.
- [ ] Vague 1 sur 5 à 10 postes, puis vague 2 sur un site complet.
- [ ] Journal `%TEMP%\strasedu-deploiement.log` rapatrié depuis un poste de test.
- [ ] Trace de démarrage relue après le premier lancement.
