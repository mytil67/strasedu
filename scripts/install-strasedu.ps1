# ═══════════════════════════════════════════════════════════════════════════
# StrasEdu - déploiement et mise à jour par copie de dossier
# ---------------------------------------------------------------------------
# Installe l'application sans passer par l'installateur NSIS : aucun
# assistant, aucune écriture de registre pendant la copie, aucun droit
# administrateur en mode utilisateur courant.
#
# Conçu pour un parc : le script est IDEMPOTENT. Relancé sur un poste déjà à
# jour, il ne fait rien et se termine en une fraction de seconde — ce qui
# permet de le déclencher à chaque démarrage par GPO ou par une tâche planifiée
# sans craindre d'écraser quoi que ce soit.
#
# Le script se copie lui-même dans le dossier d'installation, de sorte que la
# désinstallation et les mises à jour suivantes disposent toujours de leur
# propre outil, même si le partage réseau d'origine disparaît.
#
# Exemples :
#   .\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu" `
#                         -RemoteAppsUrl "https://…/apps.json"
#
#   .\install-strasedu.ps1 -Source "\\serveur\partage\StrasEdu" -CheckOnly
#
#   .\install-strasedu.ps1 -Uninstall
# ═══════════════════════════════════════════════════════════════════════════

[CmdletBinding()]
param(
    # Dossier contenant « StrasEdu.exe » (généralement dist\win-unpacked).
    [string]$Source,

    # Dossier d'installation. Par défaut : profil de l'utilisateur, ou
    # C:\Program Files\StrasEdu avec -AllUsers.
    [string]$Destination,

    # Installer pour tous les utilisateurs (nécessite une élévation).
    [switch]$AllUsers,

    # URL https du catalogue mis à jour par l'établissement.
    [string]$RemoteAppsUrl,

    # Racines autorisées pour les outils de type « local ».
    [string[]]$AllowedLocalRoots,

    [switch]$DesktopShortcut,
    [switch]$StartWithWindows,

    # Ne rien copier : indiquer seulement si une mise à jour est disponible.
    # Code de sortie : 0 = à jour, 10 = mise à jour disponible.
    [switch]$CheckOnly,

    # Désinstaller.
    [switch]$Uninstall,

    # Conserver %APPDATA%\StrasEdu lors d'une désinstallation.
    [switch]$KeepUserData,

    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

# Sortie en UTF-8 : les journaux remontés depuis 2000 postes doivent rester
# lisibles une fois centralisés, quel que soit le code page du poste.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$AppName      = "StrasEdu"
$AppExe       = "$AppName.exe"
$RegKeyName   = "StrasEdu"
$SelfName     = "install-strasedu.ps1"

# ─── Journalisation ────────────────────────────────────────────────────────
$script:LogPath = Join-Path $env:TEMP "strasedu-deploiement.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    try { Add-Content -Path $script:LogPath -Value $line -Encoding UTF8 } catch { }
    if (-not $Quiet) {
        switch ($Level) {
            "WARN"  { Write-Host $line -ForegroundColor Yellow }
            "ERROR" { Write-Host $line -ForegroundColor Red }
            "OK"    { Write-Host $line -ForegroundColor Green }
            default { Write-Host $line }
        }
    }
}

function Test-Administrator {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-Destination {
    if ($Destination) { return $Destination.TrimEnd("\") }
    if ($AllUsers) { return (Join-Path $env:ProgramFiles $AppName) }
    return (Join-Path $env:LOCALAPPDATA ("Programs\" + $AppName))
}

function Get-AppVersion {
    param([string]$Directory)
    # Un lecteur absent fait lever Join-Path : on renvoie simplement « aucune
    # version », la validation de la destination produira le vrai message.
    try {
        $exe = Join-Path $Directory $AppExe
        if (-not (Test-Path $exe)) { return $null }
        $v = (Get-Item $exe).VersionInfo.FileVersion
        if (-not $v) { return "0.0.0" }
        return $v.Trim()
    } catch {
        return $null
    }
}

<#
  Vérifie que la destination peut réellement accueillir l'application AVANT de
  copier quoi que ce soit. Sans ce contrôle, un lecteur absent, en lecture
  seule ou un dossier protégé ne se manifeste qu'au milieu de la copie, par une
  erreur système difficile à interpréter.
#>
function Assert-WritableDestination {
    param([string]$Path)

    $qualifier = Split-Path -Qualifier $Path -ErrorAction SilentlyContinue
    if ($qualifier) {
        try {
            $drive = New-Object System.IO.DriveInfo($qualifier)
            if (-not $drive.IsReady) {
                throw "Le lecteur $qualifier n'est pas prêt (disque absent ou non monté)."
            }
        } catch [System.ArgumentException] {
            throw "Lecteur inconnu : $qualifier"
        }
    }

    try {
        if (-not (Test-Path $Path)) {
            New-Item -ItemType Directory -Path $Path -Force -ErrorAction Stop | Out-Null
        }
    } catch {
        throw "Impossible de créer le dossier de destination : $Path`n$($_.Exception.Message)"
    }

    $probe = Join-Path $Path ".strasedu-sonde-ecriture"
    try {
        Set-Content -Path $probe -Value "x" -ErrorAction Stop
        Remove-Item $probe -Force -ErrorAction SilentlyContinue
    } catch {
        throw ("Le dossier de destination n'accepte pas l'écriture : $Path`n" +
               "$($_.Exception.Message)`n" +
               "Choisissez un emplacement standard : `$env:LOCALAPPDATA\Programs\$AppName " +
               "ou `$env:ProgramFiles\$AppName.")
    }
}

function Stop-StrasEdu {
    $procs = Get-Process -Name $AppName -ErrorAction SilentlyContinue
    if (-not $procs) { return }
    Write-Log "Arrêt de $($procs.Count) instance(s) en cours..."
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# ─── Raccourcis ────────────────────────────────────────────────────────────
function New-Shortcut {
    param([string]$LinkPath, [string]$TargetPath, [string]$Description)

    $dir = Split-Path -Parent $LinkPath
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (Test-Path $LinkPath) { Remove-Item $LinkPath -Force -ErrorAction SilentlyContinue }

    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($LinkPath)
    $lnk.TargetPath = $TargetPath
    $lnk.WorkingDirectory = Split-Path -Parent $TargetPath
    $lnk.Description = $Description
    $lnk.IconLocation = "$TargetPath,0"
    $lnk.Save()
}

function Get-ShortcutPaths {
    param([string]$InstallDir)

    if ($AllUsers) {
        $programs = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"
        $startup  = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp"
        $desktop  = Join-Path $env:PUBLIC "Desktop"
    } else {
        $programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
        $startup  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\StartUp"
        $desktop  = [Environment]::GetFolderPath("Desktop")
    }

    return @{
        StartMenu = Join-Path $programs "$AppName.lnk"
        Desktop   = Join-Path $desktop "$AppName.lnk"
        Startup   = Join-Path $startup "$AppName.lnk"
    }
}

# ─── Entrée « Applications et fonctionnalités » ────────────────────────────
function Register-UninstallEntry {
    param([string]$InstallDir)

    $root = if ($AllUsers) {
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$RegKeyName"
    } else {
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$RegKeyName"
    }

    if (-not (Test-Path $root)) { New-Item -Path $root -Force | Out-Null }

    $size = 0
    try {
        $size = [int](((Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum) / 1KB)
    } catch { }

    # Le chemin et la portée sont figés dans la commande : la désinstallation
    # doit viser exactement l'installation concernée, même si le script est
    # relancé plus tard sans paramètre.
    $uninstallCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}" -Uninstall -Quiet -Destination "{1}"{2}' -f `
        (Join-Path $InstallDir "_deploy\$SelfName"),
        $InstallDir,
        $(if ($AllUsers) { " -AllUsers" } else { "" })

    New-ItemProperty -Path $root -Name "DisplayName"     -Value $AppName -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name "DisplayVersion"  -Value (Get-AppVersion $InstallDir) -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name "Publisher"       -Value "STRAS EDU" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name "InstallLocation" -Value $InstallDir -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name "DisplayIcon"     -Value (Join-Path $InstallDir $AppExe) -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name "UninstallString" -Value $uninstallCmd -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name "EstimatedSize"   -Value $size -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $root -Name "NoModify"        -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $root -Name "NoRepair"        -Value 1 -PropertyType DWord -Force | Out-Null
}

function Remove-UninstallEntry {
    foreach ($root in @(
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$RegKeyName",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$RegKeyName"
    )) {
        if (Test-Path $root) { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

# ─── Configuration du catalogue distant ────────────────────────────────────
function Write-DeployConfig {
    param([string]$InstallDir)

    if (-not $RemoteAppsUrl -and -not $AllowedLocalRoots) { return }

    $resources = Join-Path $InstallDir "resources"
    if (-not (Test-Path $resources)) {
        Write-Log "Dossier resources introuvable : $resources" "ERROR"
        throw "Installation incomplète"
    }

    $config = [ordered]@{}
    if ($RemoteAppsUrl) {
        if ($RemoteAppsUrl -notmatch '^https?://') {
            Write-Log "URL de catalogue invalide (http(s) attendu) : $RemoteAppsUrl" "ERROR"
            throw "URL invalide"
        }
        $config.remoteAppsUrl = $RemoteAppsUrl
        $config.checkIntervalMinutes = 30
    }
    if ($AllowedLocalRoots) { $config.allowedLocalRoots = $AllowedLocalRoots }

    $target = Join-Path $resources "strasedu.config.json"
    $config | ConvertTo-Json -Depth 4 | Set-Content -Path $target -Encoding UTF8
    Write-Log "Configuration écrite : $target"
}

# ─── Désinstallation ───────────────────────────────────────────────────────
if ($Uninstall) {
    $dest = Resolve-Destination
    Write-Log "=== Désinstallation depuis $dest ==="

    Stop-StrasEdu

    $links = Get-ShortcutPaths -InstallDir $dest
    foreach ($link in @($links.StartMenu, $links.Desktop, $links.Startup)) {
        if (Test-Path $link) { Remove-Item $link -Force -ErrorAction SilentlyContinue; Write-Log "Raccourci supprimé : $link" }
    }

    Remove-UninstallEntry

    if (Test-Path $dest) {
        Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
        Write-Log "Dossier supprimé : $dest"
    }

    if (-not $KeepUserData) {
        $ud = Join-Path $env:APPDATA $AppName
        if (Test-Path $ud) {
            Remove-Item $ud -Recurse -Force -ErrorAction SilentlyContinue
            Write-Log "Données utilisateur supprimées : $ud"
        }
    } else {
        Write-Log "Données utilisateur conservées (favoris, réglages, historique)."
    }

    Write-Log "=== Désinstallation terminée ===" "OK"
    exit 0
}

# ─── Vérifications préalables ──────────────────────────────────────────────
if ($AllUsers -and -not (Test-Administrator)) {
    Write-Log "L'installation pour tous les utilisateurs exige une élévation." "ERROR"
    exit 1
}

$dest = Resolve-Destination
Write-Log "=== Déploiement de $AppName ==="
Write-Log "Destination : $dest"

$installedVersion = Get-AppVersion $dest

# ─── Mode « vérification seule » ───────────────────────────────────────────
if ($CheckOnly) {
    if (-not $Source) { Write-Log "-Source est obligatoire en mode -CheckOnly." "ERROR"; exit 1 }
    $sourceVersion = Get-AppVersion $Source
    if (-not $sourceVersion) { Write-Log "Application introuvable dans $Source" "ERROR"; exit 1 }

    if ($installedVersion -eq $sourceVersion) {
        Write-Log "À jour (v$installedVersion)." "OK"
        exit 0
    }
    Write-Log "Mise à jour disponible : v$installedVersion -> v$sourceVersion"
    exit 10
}

if (-not $Source) { Write-Log "-Source est obligatoire." "ERROR"; exit 1 }
if (-not (Test-Path (Join-Path $Source $AppExe))) {
    Write-Log "« $AppExe » introuvable dans $Source" "ERROR"
    exit 1
}

$sourceVersion = Get-AppVersion $Source
Write-Log "Version source : $sourceVersion | version installée : $(if ($installedVersion) { $installedVersion } else { 'aucune' })"

# Vérification préalable de la destination : mieux vaut échouer franchement,
# avec un message lisible, que s'arrêter au milieu d'une copie de 268 Mo.
try {
    Assert-WritableDestination -Path $dest
} catch {
    Write-Log $_.Exception.Message "ERROR"
    exit 1
}

# ─── Copie des fichiers, uniquement si la version change ───────────────────
# `$installedVersion` doit être non vide : sans cette garde, deux versions
# illisibles (toutes deux vides) seraient considérées comme identiques et rien
# ne serait jamais copié.
$binaryChanged = -not ($installedVersion -and ($installedVersion -eq $sourceVersion))

if ($binaryChanged) {
    Stop-StrasEdu

    if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }

    Write-Log "Copie des fichiers..."
    # /MIR : le dossier de destination reflète exactement la source, ce qui
    #        retire les fichiers des versions précédentes.
    # /XF  : la configuration locale de l'établissement n'est jamais écrasée.
    $roboArgs = @(
        $Source, $dest,
        "/MIR", "/R:2", "/W:1",
        "/XF", "strasedu.config.json",
        "/NFL", "/NDL", "/NJH", "/NJS", "/NP"
    )

    & robocopy.exe @roboArgs | Out-Null
    $roboCode = $LASTEXITCODE

    # robocopy renvoie 0 à 7 pour un succès (1 = fichiers copiés, 2 = extras
    # supprimés, etc.) et 8 ou plus en cas d'échec réel.
    if ($roboCode -ge 8) {
        Write-Log "Échec de la copie (robocopy code $roboCode)." "ERROR"
        exit 1
    }
    Write-Log "Fichiers copiés (robocopy code $roboCode)."
} else {
    Write-Log "Binaire déjà à jour (v$sourceVersion) : aucune copie de fichiers."
}

# ─── Étapes appliquées à chaque exécution ──────────────────────────────────
# Configuration, raccourcis et entrée de désinstallation sont (re)posés même
# quand le binaire n'a pas changé. C'est indispensable à l'échelle d'un parc :
#   • changer l'URL du catalogue ne doit pas exiger un redéploiement ;
#   • un raccourci supprimé par un utilisateur doit réapparaître ;
#   • le script reste sans effet de bord, donc rejouable à chaque démarrage.

# L'outil de déploiement voyage avec l'application : désinstallation et mises
# à jour restent possibles même si le partage d'origine disparaît.
$deployDir = Join-Path $dest "_deploy"
if (-not (Test-Path $deployDir)) { New-Item -ItemType Directory -Path $deployDir -Force | Out-Null }
Copy-Item -Path $PSCommandPath -Destination (Join-Path $deployDir $SelfName) -Force

Write-DeployConfig -InstallDir $dest

$exePath = Join-Path $dest $AppExe
$links = Get-ShortcutPaths -InstallDir $dest

New-Shortcut -LinkPath $links.StartMenu -TargetPath $exePath `
    -Description "$AppName - lanceur d'applications pedagogiques"

if ($DesktopShortcut) {
    New-Shortcut -LinkPath $links.Desktop -TargetPath $exePath `
        -Description "$AppName - lanceur d'applications pedagogiques"
    Write-Log "Raccourci bureau créé."
}

if ($StartWithWindows) {
    New-Shortcut -LinkPath $links.Startup -TargetPath $exePath `
        -Description "$AppName - lanceur d'applications pedagogiques"
    Write-Log "Lancement automatique configuré."
}

Register-UninstallEntry -InstallDir $dest

if ($binaryChanged) {
    Write-Log "=== Déploiement terminé : v$sourceVersion ===" "OK"
} else {
    Write-Log "=== Poste conforme : v$sourceVersion ===" "OK"
}
Write-Log "Journal : $script:LogPath"
exit 0
