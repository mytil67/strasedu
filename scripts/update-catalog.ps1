# ═══════════════════════════════════════════════════════════════════════════
# Portail Outils — publication du catalogue (côté administrateur)
# ---------------------------------------------------------------------------
# Valide le catalogue, incrémente sa version, puis le publie :
#   • sur un partage réseau   (recommandé en établissement : ni serveur web,
#     ni jeton, ni 96 000 requêtes par jour sur une forge) ;
#   • ou vers GitLab, si vous préférez garder le catalogue en gestion de
#     version avec un historique.
#
# La validation est le point important : le champ « version » déclenche la
# mise à jour sur les postes. Publier un catalogue dont la version n'a pas
# changé ne met rien à jour ; publier un catalogue invalide fait rejeter la
# mise à jour par les postes, qui conservent alors l'ancienne. Les deux cas
# sont détectés ici, avant publication.
#
# Exemples :
#   # Valider sans rien publier
#   .\update-catalog.ps1 -AppsJsonPath ..\..\apps.json -ValidateOnly
#
#   # Publier sur un partage réseau
#   .\update-catalog.ps1 -AppsJsonPath ..\..\apps.json `
#                        -SharePath "\\serveur\partage\PortailOutils\apps.json"
#
#   # Publier vers GitLab
#   .\update-catalog.ps1 -AppsJsonPath ..\..\apps.json `
#                        -GitLabUrl "https://gitlab.ac-strasbourg.fr" `
#                        -ProjectId "123" -Token "glpat-xxxxxxxxxxxx"
# ═══════════════════════════════════════════════════════════════════════════

[CmdletBinding()]
param(
    [string]$AppsJsonPath = ".\apps.json",

    # Partage réseau ou chemin local de destination.
    [string]$SharePath,

    # Publication vers GitLab.
    [string]$GitLabUrl,
    [string]$ProjectId,
    [string]$Token,
    [string]$Branch = "main",
    [string]$FilePath = "apps.json",

    # Ne pas incrémenter la version (si vous l'avez déjà modifiée à la main).
    [switch]$NoVersionBump,

    # Valider et afficher le rapport, sans rien écrire ni publier.
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$problems = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Write-Head { param([string]$Text) Write-Host ""; Write-Host "=== $Text ===" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "  [OK]   $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "  [ATTN] $Text" -ForegroundColor Yellow }
function Write-Err  { param([string]$Text) Write-Host "  [ERR]  $Text" -ForegroundColor Red }

# ─── Validation ────────────────────────────────────────────────────────────
# Reproduit les règles appliquées par l'application elle-même : tout ce qui
# est refusé ici serait silencieusement écarté sur les postes.
#
# ponytail: duplicata assumé de normalizeCatalog() dans main.js. L'application
# doit valider ce qu'elle reçoit (frontière de confiance) et ce script doit
# prévenir avant diffusion ; les deux jeux de règles doivent évoluer ensemble.
function Test-Catalogue {
    param([object]$Json)

    if (-not $Json.version) {
        $problems.Add("champ 'version' absent : sans lui, aucun poste ne se mettra à jour")
    }
    if (-not $Json.apps -or @($Json.apps).Count -eq 0) {
        $problems.Add("le catalogue ne contient aucun outil")
    }

    $categories = @{}
    foreach ($c in @($Json.categories)) {
        $name = if ($c -is [string]) { $c } else { $c.name }
        if (-not $name) { $problems.Add("une entrée de 'categories' est vide"); continue }
        if ($categories.ContainsKey($name)) { $warnings.Add("catégorie déclarée deux fois : $name") }
        $categories[$name] = $true
    }

    $ids = @{}
    foreach ($a in @($Json.apps)) {
        $id = [string]$a.id
        if (-not $id) { $problems.Add("un outil n'a pas d'identifiant 'id'"); continue }
        if ($ids.ContainsKey($id)) { $problems.Add("identifiant en double : $id"); continue }
        $ids[$id] = $true

        if (-not $a.name) { $warnings.Add("$id : pas de nom affiché") }
        if (-not $a.category) {
            $warnings.Add("$id : pas de catégorie, il sera rangé dans « Autres »")
        } elseif (-not $categories.ContainsKey([string]$a.category)) {
            $warnings.Add("$id : catégorie « $($a.category) » absente de la liste 'categories'")
        }

        $type = if ($a.type) { [string]$a.type } else { "web" }
        if ($type -eq "local") {
            if (-not $a.path) {
                $problems.Add("$id : type 'local' sans champ 'path'")
            } elseif ($a.path -notmatch '\.(exe|lnk)$') {
                $problems.Add("$id : chemin local refusé, il doit finir par .exe ou .lnk")
            } elseif (-not [System.IO.Path]::IsPathRooted([string]$a.path)) {
                $problems.Add("$id : le chemin local doit être absolu")
            }
        } else {
            if (-not $a.url) {
                $problems.Add("$id : pas d'url")
            } elseif ($a.url -notmatch '^https?://') {
                $problems.Add("$id : url refusee (http ou https attendu) - l'outil serait ignore")
            }
        }
    }

    if ($Json.categoryMeta) {
        foreach ($p in $Json.categoryMeta.PSObject.Properties) {
            if (-not $categories.ContainsKey($p.Name)) {
                $warnings.Add("categoryMeta « $($p.Name) » ne correspond à aucune catégorie déclarée")
            }
            if ($p.Value.color -and $p.Value.color -notmatch '^#[0-9a-fA-F]{6}$') {
                $problems.Add("categoryMeta « $($p.Name) » : couleur invalide (format #RRGGBB attendu)")
            }
        }
        foreach ($name in $categories.Keys) {
            if (-not $Json.categoryMeta.PSObject.Properties[$name]) {
                $warnings.Add("catégorie « $name » sans categoryMeta : icône et couleur par défaut")
            }
        }
    } elseif (@($Json.categories).Count -gt 0) {
        $warnings.Add("aucun 'categoryMeta' : les tuiles de l'accueil n'auront ni icône ni description")
    }
}

# ─── Lecture ───────────────────────────────────────────────────────────────
if (-not (Test-Path $AppsJsonPath)) {
    Write-Host "ERREUR : fichier introuvable : $AppsJsonPath" -ForegroundColor Red
    exit 1
}

$raw = [System.IO.File]::ReadAllText((Resolve-Path $AppsJsonPath).Path, [System.Text.Encoding]::UTF8)
if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }

try {
    $json = $raw | ConvertFrom-Json
} catch {
    Write-Host "ERREUR : le fichier JSON est invalide." -ForegroundColor Red
    Write-Host "         $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Head "Validation du catalogue"
Write-Host "  Fichier : $AppsJsonPath"
Write-Host "  Version : $($json.version)"
Write-Host "  Outils  : $(@($json.apps).Count)"

Test-Catalogue -Json $json

if ($warnings.Count -gt 0) {
    Write-Head "Avertissements ($($warnings.Count)) - publication possible"
    $warnings | ForEach-Object { Write-Warn $_ }
}

if ($problems.Count -gt 0) {
    Write-Head "Erreurs bloquantes ($($problems.Count))"
    $problems | ForEach-Object { Write-Err $_ }
    Write-Host ""
    Write-Host "Publication annulée. Corrigez ces points puis relancez." -ForegroundColor Red
    exit 1
}

Write-Ok "Catalogue valide : $(@($json.apps).Count) outils, $(@($json.categories).Count) catégories."

if ($ValidateOnly) {
    Write-Host ""
    Write-Host "Mode -ValidateOnly : rien n'a été modifié." -ForegroundColor Cyan
    exit 0
}

# ─── Version ───────────────────────────────────────────────────────────────
$oldVersion = [string]$json.version

if (-not $NoVersionBump) {
    $parts = @($oldVersion -split '\.')
    while ($parts.Count -lt 3) { $parts += "0" }
    $parts[2] = ([int]$parts[2]) + 1
    $json.version = $parts[0..2] -join '.'
    Write-Head "Version"
    Write-Host "  $oldVersion -> $($json.version)"
    Write-Host "  C'est ce numéro qui déclenche la mise à jour sur les postes."
} else {
    Write-Head "Version"
    Write-Host "  Conservée : $oldVersion (-NoVersionBump)"
    Write-Host "  Vérifiez qu'elle diffère bien de celle déjà publiée," -ForegroundColor Yellow
    Write-Host "  sans quoi aucun poste ne se mettra à jour." -ForegroundColor Yellow
}

$json.lastUpdated = (Get-Date -Format "yyyy-MM-dd")

# Écriture sans BOM : Bloc-notes et PowerShell en ajoutent un par défaut, et
# JSON.parse le refuse côté application.
$updated = $json | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Resolve-Path $AppsJsonPath).Path, $updated, $utf8NoBom)
Write-Host "  Fichier local mis à jour : $AppsJsonPath"

# ─── Publication ───────────────────────────────────────────────────────────
if ($SharePath) {
    Write-Head "Publication sur le partage"
    $target = $SharePath

    $dir = Split-Path -Parent $target
    if ($dir -and -not (Test-Path $dir)) {
        Write-Host "ERREUR : dossier de destination introuvable : $dir" -ForegroundColor Red
        exit 1
    }

    # Écriture par fichier temporaire puis remplacement : un poste qui lit
    # pendant la copie ne tombe jamais sur un catalogue à moitié écrit.
    $temp = "$target.tmp"
    try {
        [System.IO.File]::WriteAllText($temp, $updated, $utf8NoBom)
        Move-Item -Path $temp -Destination $target -Force
    } catch {
        Remove-Item $temp -Force -ErrorAction SilentlyContinue
        Write-Host "ERREUR lors de l'écriture : $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }

    Write-Ok "Publié : $target"
    Write-Host ""
    Write-Host "Les postes le récupéreront à leur prochaine vérification (30 min),"
    Write-Host "ou immédiatement via Réglages > Catalogue > Vérifier."
    Write-Host ""
    Write-Host "Adresse à renseigner dans portail.config.json :" -ForegroundColor Yellow
    Write-Host ('  {{ "remoteAppsUrl": "{0}" }}' -f $target)
    exit 0
}

if ($GitLabUrl -and $ProjectId -and $Token) {
    Write-Head "Publication vers GitLab"

    $encodedPath = [uri]::EscapeDataString($FilePath)
    $apiUrl = "$GitLabUrl/api/v4/projects/$ProjectId/repository/files/$encodedPath"

    $body = @{
        branch         = $Branch
        content        = $updated
        commit_message = "Catalogue Portail Outils v$($json.version)"
    } | ConvertTo-Json

    $headers = @{ "PRIVATE-TOKEN" = $Token; "Content-Type" = "application/json" }

    try {
        Invoke-RestMethod -Method Put -Uri $apiUrl -Headers $headers -Body $body | Out-Null
        Write-Ok "Fichier mis à jour sur GitLab."
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 404) {
            try {
                Invoke-RestMethod -Method Post -Uri $apiUrl -Headers $headers -Body $body | Out-Null
                Write-Ok "Fichier créé sur GitLab."
            } catch {
                Write-Host "ERREUR lors de la création : $_" -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "ERREUR lors de l'envoi vers GitLab : $_" -ForegroundColor Red
            exit 1
        }
    }

    $rawUrl = "$GitLabUrl/api/v4/projects/$ProjectId/repository/files/$encodedPath/raw?ref=$Branch"
    Write-Host ""
    Write-Host "Adresse de lecture des postes :" -ForegroundColor Yellow
    Write-Host "  $rawUrl"
    Write-Host ""
    Write-Host "ATTENTION : l'application lit cette adresse SANS authentification." -ForegroundColor Yellow
    Write-Host "Le projet doit donc être lisible publiquement, ou le catalogue être" -ForegroundColor Yellow
    Write-Host "publié vers un emplacement public. Sinon, préférez -SharePath." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Aucune destination indiquée : le fichier local a été mis à jour," -ForegroundColor Yellow
Write-Host "mais rien n'a été publié. Utilisez -SharePath ou les paramètres GitLab." -ForegroundColor Yellow
exit 0
