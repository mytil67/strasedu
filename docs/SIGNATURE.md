# Signer les applications StrasEdu

StrasEdu produit **quatre exécutables** : deux pour les enseignants, deux pour
le service informatique. Tous doivent être signés.

Sans signature, Windows affiche **« Éditeur inconnu »** dans l'invite UAC et
SmartScreen affiche **« Windows a protégé votre PC »** au premier lancement
d'un fichier téléchargé. Ce n'est pas seulement désagréable : sur un parc, cela
suffit à ce que les utilisateurs renoncent.

---

## 1. Ce que la signature apporte, et ce qu'elle n'apporte pas

| | Sans signature | Certificat **auto-signé** | Certificat **délivré par une autorité** |
| --- | --- | --- | --- |
| Nom de l'éditeur dans l'UAC | « Inconnu » | Le nom du certificat | Le nom du certificat |
| SmartScreen, fichier téléchargé | Avertissement | **Avertissement maintenu** | Atténué, puis neutre |
| Coût | 0 | 0 | 200 à 700 € par an |
| Déploiement par GPO | — | Racine à distribuer | Rien à faire |

> **Le certificat auto-signé ne supprime pas SmartScreen.** SmartScreen note la
> réputation d'un éditeur ; un certificat que personne d'autre ne connaît n'en
> a aucune. Il reste néanmoins utile : dans un déploiement par GPO ou SCCM, le
> fichier n'a pas de marque « téléchargé depuis Internet », donc SmartScreen ne
> se déclenche pas — et le nom de l'éditeur s'affiche correctement.

---

## 2. La chaîne est déjà en place

Rien à modifier dans le dépôt : electron-builder sait signer, et
`scripts/publish-release.js` **refuse de publier** des binaires mal signés.

```powershell
npm run build:all
node scripts\publish-release.js --dry-run   # contrôle la signature de chaque fichier
```

L'essai à blanc affiche, pour chaque exécutable, `signature=Valid`,
`signature=UnknownError` (signé, racine non approuvée) ou
`signature=NotSigned`.

| Situation | Ce que fait `release` | Pour forcer |
| --- | --- | --- |
| Un fichier n'est pas signé | Refuse et le nomme | `--allow-unsigned` |
| Signé par un certificat interne | Refuse | `--allow-internal-cert` |

Une signature non reconnue est **plus suspecte qu'une absence de signature**
sur une page de téléchargement publique : Windows affiche un éditeur, mais un
éditeur que rien ne cautionne. D'où ce refus par défaut. Pour une diffusion
interne dont la racine est distribuée par GPO, `--allow-internal-cert` est le
bon choix.

---

## 3. Choisir et obtenir un certificat

### Option A — certificat interne (gratuit, immédiat)

Convient à un déploiement entièrement maîtrisé, où vous pouvez distribuer la
racine sur les postes.

```powershell
.\scripts\new-signing-cert.ps1 -Name "Rectorat de Strasbourg"
```

Le script crée le certificat, exporte `strasedu-test.pfx` (à garder secret) et
`strasedu-test.cer` (la partie publique), et affiche la marche à suivre.

**Distribuez le `.cer` par GPO** dans *Autorités de certification racines de
confiance*, au niveau du domaine. Sans cette étape, Windows continue
d'afficher « Éditeur inconnu » — le certificat est installé, mais il n'est pas
approuvé.

Limite : le certificat expire. Notez la date et prévoyez son renouvellement,
sinon les binaires publiés après expiration perdront leur validité.

### Option B — certificat délivré par une autorité

C'est la seule voie pour une diffusion publique. Trois familles :

| Type | Prix indicatif | Ce qu'il faut savoir |
| --- | --- | --- |
| **OV** (Organization Validation) | 200 à 400 €/an | Livré en `.pfx`. Réputation SmartScreen à construire : les premiers téléchargements avertissent encore. |
| **EV** (Extended Validation) | 400 à 700 €/an | Livré sur **jeton matériel** ou HSM cloud. SmartScreen neutre immédiatement. Nécessite un justificatif d'identité de l'organisation. |
| **Azure Trusted Signing** | ~10 €/mois | Service Microsoft, signature dans le cloud, pas de jeton. Nécessite un compte Azure et une validation d'identité de 3 ans. C'est aujourd'hui l'option la moins chère pour un effet EV-like. |

Pour un établissement, **Azure Trusted Signing** est généralement le meilleur
compromis. Pour l'académie, un OV acheté une fois pour toutes suffit.

---

## 4. Signer selon le type de certificat

### 4.1 Fichier `.pfx` — aucune configuration

C'est le cas d'un certificat OV, ou de tout certificat que vous savez exporter.

```powershell
$env:CSC_LINK = "C:\cles\strasedu.pfx"      # chemin, base64, ou URL
$env:CSC_KEY_PASSWORD = "mot-de-passe"
npm run build:all
```

electron-builder signe alors **les deux applications**, l'exécutable interne,
l'aide à l'élévation et le désinstalleur. Aucun fichier du dépôt n'est modifié.

> Le mot de passe ne doit jamais être écrit dans le dépôt. `CSC_LINK` et
> `CSC_KEY_PASSWORD` sont lus depuis l'environnement, ce qui permet de les
> fournir par un coffre ou un pipeline d'intégration.

### 4.2 Certificat installé dans le magasin (jeton EV, ou `.pfx` importé)

Le magasin évite de manipuler le fichier et le mot de passe à chaque
fabrication. Installez le certificat, relevez son empreinte :

```powershell
Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Format-Table Subject, Thumbprint, NotAfter
```

Puis ajoutez le bloc suivant dans `package.json` (clé `build.win`) **et** dans
`electron-builder.admin.json` (clé `win`) :

```json
"signtoolOptions": {
  "certificateSha1": "E773114DCCB1BD6B32632CEAEC6E61A5D930188B"
}
```

L'empreinte n'est pas un secret : c'est l'identifiant public du certificat.
Elle est propre au poste de fabrication — si vous publiez depuis plusieurs
machines, préférez `CSC_LINK`.

Pour un essai sans modifier les fichiers, les deux commandes acceptent la
surcharge en ligne de commande :

```powershell
node node_modules\electron-builder\out\cli\cli.js --win nsis `
  "-c.win.signtoolOptions.certificateSha1=E773114DCCB1BD6B32632CEAEC6E61A5D930188B"
```

### 4.3 Azure Trusted Signing

Créez un compte Trusted Signing, un profil de certificat, puis renseignez dans
les deux fichiers de configuration :

```json
"win": {
  "azureSignOptions": {
    "endpoint": "https://neu.codesigning.azure.net",
    "codeSigningAccountName": "strasedu-signing",
    "certificateProfileName": "strasedu"
  }
}
```

L'authentification se fait par identité Microsoft Entra, via les variables
d'environnement lues par `Azure.Identity` — `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. Aucun secret n'entre dans le dépôt.

---

## 5. Vérifier

Après toute fabrication :

```powershell
Get-AuthenticodeSignature .\dist\StrasEdu-2.1.1-x64-setup.exe |
  Format-List Status, SignerCertificate, TimeStamperCertificate
```

| Statut | Signification |
| --- | --- |
| `Valid` | Signé, chaîne de confiance complète. **C'est ce qu'il faut viser.** |
| `UnknownError` | Signé, mais la racine n'est pas approuvée sur ce poste. Normal en interne tant que la GPO n'est pas passée. |
| `NotSigned` | Aucune signature : la fabrication n'a pas reçu de certificat. |
| `HashMismatch` | Le fichier a été modifié après signature. **Ne pas diffuser.** |

Un horodatage (`TimeStamperCertificate`) est indispensable : il permet aux
binaires de rester valides après l'expiration du certificat. electron-builder
horodate via `http://timestamp.digicert.com` par défaut.

---

## 6. Pièges rencontrés

**`Store::ImportCertObject() failed` (`0x80090010`)** — signtool n'arrive pas à
importer le `.pfx`. Le fichier peut être parfaitement valide (`certutil
-importPFX` l'accepte). Dans ce cas, installez le certificat dans le magasin et
signez par empreinte (§4.2), ce qui contourne l'import.

**`L'opération a été annulée par l'utilisateur`** — l'élévation a été refusée.
Un binaire non signé déclenche le même message qu'un binaire signé dont
l'éditeur est inconnu : vérifiez d'abord que la signature est bien présente
avant d'incriminer la stratégie de sécurité.

**Le certificat expire.** Notez `NotAfter` et renouvelez avant. Les binaires
déjà horodatés restent valides ; ceux signés après expiration non.
