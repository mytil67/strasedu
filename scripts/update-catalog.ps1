# ═══════════════════════════════════════════════════════════════════════════
# StrasEdu — publication du catalogue (côté administrateur)
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
#                        -SharePath "\\serveur\partage\StrasEdu\apps.json"
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

# ─── Plafonds partagés avec l'application ──────────────────────────────────
# Ces valeurs DOIVENT rester alignées sur les constantes de lib/catalog.js :
# l'application écarte en silence tout ce qui dépasse, ce script doit donc
# prévenir l'administrateur avec exactement les mêmes seuils.
$MAX_NEWS_ITEMS       = 12
$MAX_HIGHLIGHTS       = 3
$MAX_HIGHLIGHTS_IDS   = 12
$MAX_SCREENSHOTS      = 4
$MAX_IMAGE_CHARS      = 192 * 1024
$MAX_APP_IMAGES_CHARS = 1536 * 1024
# Poids du fichier publié : au-delà, les postes refusent le catalogue ENTIER.
# On refuse donc de publier AVANT la limite, avec la même marge que l'outil
# d'administration : les deux voies de publication appliquent les mêmes seuils.
$MAX_CATALOG_BYTES    = 2 * 1024 * 1024
$MAX_PUBLISH_BYTES    = $MAX_CATALOG_BYTES - 128 * 1024
$WARN_CATALOG_BYTES   = 1600 * 1024
# Data URI d'image acceptée : logo, vignette d'outil, bandeau d'information.
$IMAGE_PATTERN = '^data:image/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$'

function Write-Head { param([string]$Text) Write-Host ""; Write-Host "=== $Text ===" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "  [OK]   $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "  [ATTN] $Text" -ForegroundColor Yellow }
function Write-Err  { param([string]$Text) Write-Host "  [ERR]  $Text" -ForegroundColor Red }

# ─── Validation ────────────────────────────────────────────────────────────
# Reproduit les règles appliquées par l'application elle-même : tout ce qui
# est refusé ici serait silencieusement écarté sur les postes.
#
# ponytail: duplicata assumé de normalizeCatalog() dans lib/catalog.js. L'application
# doit valider ce qu'elle reçoit (frontière de confiance) et ce script doit
# prévenir avant diffusion ; les deux jeux de règles doivent évoluer ensemble.

# Valide un visuel embarqué (data URI d'image sous le plafond) et renvoie sa
# longueur en caractères, ou 0 s'il est absent.
#
# Un visuel absent ne dit rien : la plupart des outils n'en ont pas. Un visuel
# présent mais refusé est signalé nommant son emplacement ($Where), parce que
# l'application l'écarterait sans le dire à l'administrateur.
function Get-ValidImageChars {
    param([object]$Value, [string]$Where)

    $raw = if ($Value -is [string]) { ([string]$Value).Trim() } else { "" }
    if (-not $raw) { return 0 }

    if ($raw.Length -gt $MAX_IMAGE_CHARS) {
        $ko = [math]::Round($raw.Length / 1KB)
        $maxKo = [math]::Round($MAX_IMAGE_CHARS / 1KB)
        $warnings.Add("$Where : image de $ko Ko de data URI (maximum $maxKo Ko) - elle serait ignorée")
        return 0
    }
    if ($raw -notmatch $IMAGE_PATTERN) {
        $warnings.Add("$Where : image refusée (data URI d'image attendu, ex. data:image/png;base64,...) - elle serait ignorée")
        return 0
    }
    return $raw.Length
}

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

    # Budget global des visuels d'outils (vignettes + captures), en caractères
    # de data URI : il empêche qu'un catalogue devienne impossible à
    # distribuer. Contrairement à la taille d'une image seule, un dépassement
    # n'écarte pas l'outil : seuls les visuels suivants sont abandonnés.
    $imageBudget = $MAX_APP_IMAGES_CHARS

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

        # Visuels de l'outil : une vignette, puis jusqu'à quatre captures
        # d'écran. Un visuel refusé n'empêche pas la publication : il est
        # simplement absent du rendu, d'où l'avertissement et non l'erreur.
        $imageChars = Get-ValidImageChars -Value $a.image -Where "$id (vignette)"
        if ($imageChars -gt 0) {
            if ($imageBudget -ge $imageChars) {
                $imageBudget -= $imageChars
            } else {
                $warnings.Add("$id : budget global des visuels atteint - la vignette serait ignorée")
            }
        }

        if ($null -ne $a.screenshots) {
            if ($a.screenshots -isnot [array]) {
                $warnings.Add("$id : 'screenshots' doit être un tableau - les captures seraient ignorées")
            } else {
                $shots = @($a.screenshots)
                if ($shots.Count -gt $MAX_SCREENSHOTS) {
                    $warnings.Add("$id : $($shots.Count) captures d'écran pour $MAX_SCREENSHOTS au maximum - les suivantes seraient ignorées")
                }
                $shotRank = 0
                foreach ($shot in $shots) {
                    $shotRank += 1
                    $shotChars = Get-ValidImageChars -Value $shot -Where "$id (capture $shotRank)"
                    if ($shotChars -eq 0) { continue }
                    if ($imageBudget -lt $shotChars) {
                        $warnings.Add("$id : budget global des visuels atteint - les captures suivantes seraient ignorées")
                        break
                    }
                    $imageBudget -= $shotChars
                }
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

    # ── Informations du département ('news') ──────────────────────────────
    # Objet facultatif. Un élément inexploitable est écarté par l'application
    # sans faire tomber le carrousel : avertissement, jamais erreur bloquante.
    if ($null -ne $Json.news) {
        if ($Json.news -is [array]) {
            $problems.Add("'news' doit être un objet (title, subtitle, items), pas un tableau")
        } else {
            if ($null -eq $Json.news.items) {
                $warnings.Add("'news' sans 'items' : aucune information ne serait affichée")
            } elseif ($Json.news.items -isnot [array]) {
                $problems.Add("'news.items' doit être un tableau")
            } else {
                $newsItems = @($Json.news.items)
                if ($newsItems.Count -gt $MAX_NEWS_ITEMS) {
                    $warnings.Add("news.items : $($newsItems.Count) informations pour $MAX_NEWS_ITEMS au maximum - les suivantes seraient ignorées")
                }
                $rank = 0
                foreach ($item in $newsItems) {
                    $rank += 1
                    $where = "news.items[$rank]"
                    if ($item -isnot [pscustomobject]) {
                        $warnings.Add("$where : entrée invalide (objet attendu) - elle serait écartée")
                        continue
                    }

                    # Un élément sans titre, sans texte et sans image n'a rien à
                    # afficher : l'application le retire du carrousel.
                    $title = if ($item.title -is [string]) { $item.title.Trim() } else { "" }
                    $text = if ($item.text -is [string]) { $item.text.Trim() } else { "" }
                    $imageChars = Get-ValidImageChars -Value $item.image -Where $where
                    if (-not $title -and -not $text -and $imageChars -eq 0) {
                        $warnings.Add("$where : ni titre, ni texte, ni image - l'information serait écartée")
                    }

                    # Un lien non http(s) est retiré, mais l'information reste :
                    # le texte et l'image s'affichent quand même.
                    $url = if ($item.url -is [string]) { $item.url.Trim() } else { "" }
                    if ($url -and $url -notmatch '^https?://') {
                        $warnings.Add("$where : url refusée « $url » (http ou https attendu) - le lien serait retiré, l'information resterait")
                    }
                }
            }
        }
    }

    # ── Mises en avant ('highlights') ─────────────────────────────────────
    # Tableau facultatif de groupes « du moment », « du mois ». Les
    # identifiants inconnus comme les groupes vides sont écartés par
    # l'application : le rendu ne pointe jamais vers un outil absent.
    if ($null -ne $Json.highlights) {
        if ($Json.highlights -isnot [array]) {
            $warnings.Add("'highlights' doit être un tableau - aucune mise en avant ne serait affichée")
        } else {
            $groups = @($Json.highlights)
            if ($groups.Count -gt $MAX_HIGHLIGHTS) {
                $warnings.Add("highlights : $($groups.Count) groupes pour $MAX_HIGHLIGHTS au maximum - les suivants seraient ignorés")
            }
            $rank = 0
            foreach ($group in $groups) {
                $rank += 1
                $where = "highlights[$rank]"
                if ($group -isnot [pscustomobject]) {
                    $warnings.Add("$where : entrée invalide (objet attendu) - le groupe serait écarté")
                    continue
                }

                # Pas de 'label' : rien à signaler, le rendu affiche « À la une ».
                if ($null -eq $group.appIds -or $group.appIds -isnot [array] -or @($group.appIds).Count -eq 0) {
                    $warnings.Add("$where : 'appIds' absent, vide ou non tableau - le groupe serait écarté")
                    continue
                }

                $appIds = @($group.appIds)
                if ($appIds.Count -gt $MAX_HIGHLIGHTS_IDS) {
                    $warnings.Add("$where : $($appIds.Count) identifiants pour $MAX_HIGHLIGHTS_IDS au maximum - les suivants seraient ignorés")
                }

                $seenInGroup = @{}
                $unknown = New-Object System.Collections.Generic.List[string]
                foreach ($value in $appIds) {
                    $appId = [string]$value
                    if (-not $appId) { continue }
                    if ($seenInGroup.ContainsKey($appId)) {
                        $warnings.Add("$where : identifiant répété « $appId » - le doublon serait écarté")
                    } else {
                        $seenInGroup[$appId] = $true
                    }
                    if (-not $ids.ContainsKey($appId) -and -not $unknown.Contains($appId)) {
                        $unknown.Add($appId)
                    }
                }
                foreach ($appId in $unknown) {
                    $warnings.Add("$where : l'outil « $appId » est absent du catalogue - il serait écarté de la mise en avant")
                }
            }
        }
    }

    # ── Poids du fichier publié ───────────────────────────────────────────
    # Un catalogue trop lourd est refusé EN ENTIER par les postes : ni nouvel
    # outil, ni information. L'administrateur doit le savoir avant de publier,
    # pas le découvrir dans le journal d'un poste. La mise en forme est celle de
    # la publication, pour que la mesure corresponde au fichier écrit.
    $publie = $Json | ConvertTo-Json -Depth 10
    $octets = [System.Text.Encoding]::UTF8.GetByteCount($publie)
    $ko = [math]::Round($octets / 1KB)
    $publicationKo = [math]::Round($MAX_PUBLISH_BYTES / 1KB)
    $posteKo = [math]::Round($MAX_CATALOG_BYTES / 1KB)
    if ($octets -gt $MAX_PUBLISH_BYTES) {
        $problems.Add("catalogue de $ko Ko : la publication est refusée au-delà de $publicationKo Ko, car les postes refusent le catalogue entier dès $posteKo Ko - allégez les visuels")
    } elseif ($octets -gt $WARN_CATALOG_BYTES) {
        $warnings.Add("catalogue de $ko Ko : la publication sera refusée au-delà de $publicationKo Ko - allégez les visuels")
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
    Write-Host "Adresse à renseigner dans strasedu.config.json :" -ForegroundColor Yellow
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
        commit_message = "Catalogue StrasEdu v$($json.version)"
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
