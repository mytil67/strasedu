# ═══════════════════════════════════════════════════════════════════════════
# StrasEdu — préparation du cache electron-builder sous Windows
# ---------------------------------------------------------------------------
# electron-builder télécharge le paquet « winCodeSign », qui contient des liens
# symboliques macOS (darwin/10.12/lib/libcrypto.dylib et libssl.dylib). Windows
# ne permet de créer un lien symbolique qu'à un compte disposant du privilège
# correspondant : administrateur, ou mode développeur activé. Sans ce privilège,
# 7-Zip sort en code 2 et la fabrication de l'installateur s'arrête — alors que
# ce paquet ne sert sous Windows qu'à signtool, rangé dans windows-10/.
#
# Ce script réextrait donc le paquet en écartant le dossier darwin, puis
# installe le résultat à l'emplacement attendu par electron-builder.
#
# Ce n'est nécessaire qu'une fois par poste de fabrication.
#
# Usage : .\scripts\fix-builder-cache.ps1
# ═══════════════════════════════════════════════════════════════════════════

[CmdletBinding()]
param(
    [string]$CacheDir = "",
    [string]$Version = "2.6.0"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if (-not $CacheDir) {
    $CacheDir = if ($env:ELECTRON_BUILDER_CACHE) {
        $env:ELECTRON_BUILDER_CACHE
    } else {
        Join-Path $env:LOCALAPPDATA "electron-builder\Cache"
    }
}

$sevenZip = Join-Path $root "node_modules\7zip-bin\win\x64\7za.exe"
if (-not (Test-Path $sevenZip)) {
    Write-Host "7za.exe introuvable - lancez d'abord « npm install »." -ForegroundColor Red
    exit 1
}

$artifactDir = Join-Path $CacheDir "winCodeSign"
$target = Join-Path $artifactDir "winCodeSign-$Version"
$marker = Join-Path $target "windows-10\x64\signtool.exe"

if (Test-Path $marker) {
    Write-Host "Cache deja en place : $target" -ForegroundColor Green
    exit 0
}

Write-Host "=== Preparation du cache electron-builder ===" -ForegroundColor Cyan
Write-Host "Cache : $CacheDir"
Write-Host "Cible : $target"

# Réutiliser l'archive si elle a déjà été téléchargée par une tentative ratée.
$archive = Get-ChildItem -Path $artifactDir -Filter "*.7z" -ErrorAction SilentlyContinue |
    Select-Object -First 1

if (-not $archive) {
    if (-not (Test-Path $artifactDir)) { New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null }
    $archivePath = Join-Path $artifactDir "winCodeSign-$Version.7z"
    $url = "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-$Version/winCodeSign-$Version.7z"
    Write-Host "Telechargement : $url"
    Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing
    $archive = Get-Item $archivePath
}

Write-Host "Archive : $($archive.FullName) ($([math]::Round($archive.Length / 1MB, 1)) Mo)"

if (Test-Path $target) { Remove-Item $target -Recurse -Force }

# -xr!darwin écarte le seul dossier porteur de liens symboliques.
& $sevenZip x $archive.FullName "-o$target" "-xr!darwin" -bd -y | Out-Null

if (-not (Test-Path $marker)) {
    Write-Host "Echec : signtool.exe reste introuvable apres extraction." -ForegroundColor Red
    exit 1
}

Write-Host "Cache pret." -ForegroundColor Green
exit 0
