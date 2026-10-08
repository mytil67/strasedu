# StrasEdu - creation d'un certificat de signature auto-signe
#
# A QUOI CELA SERT
#
#   Deux usages, tous deux legitimes :
#
#   1. Eprouver la chaine de signature sans acheter de certificat.
#   2. Signer les binaires pour un deploiement interne. Si la racine est
#      distribuee sur les postes par GPO, Windows affiche le nom de
#      l'editeur au lieu de « Editeur inconnu ». C'est gratuit.
#
#   Ce que ce certificat NE fait PAS : supprimer l'avertissement SmartScreen
#   pour un fichier telecharge depuis Internet. SmartScreen s'appuie sur la
#   reputation de l'editeur, qu'un certificat auto-signe n'a pas. Pour cela il
#   faut un certificat delivre par une autorite (voir docs/SIGNATURE.md).
#
# Usage :
#   .\scripts\new-signing-cert.ps1
#   .\scripts\new-signing-cert.ps1 -Name "Mon Etablissement" -Out "C:\cles"

[CmdletBinding()]
param(
    # Nom affiche comme editeur dans les boites de dialogue Windows.
    [string]$Name = "StrasEdu (test)",

    # Dossier de sortie du fichier .pfx. Il ne doit PAS etre versionne.
    [string]$Out = "",

    # Duree de validite, en annees.
    [int]$Years = 3,

    # Mot de passe du .pfx. Sans lui, un mot de passe est tire au hasard.
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Out)) {
    $Out = Join-Path (Split-Path -Parent $PSScriptRoot) ".signing"
}

$pfxPath = Join-Path $Out "strasedu-test.pfx"
$cerPath = Join-Path $Out "strasedu-test.cer"

# Un mot de passe tire au hasard vaut mieux qu'un mot de passe faible : ce
# fichier circule, il ne doit pas etre reutilisable ailleurs.
if ([string]::IsNullOrWhiteSpace($Password)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $Password = [Convert]::ToBase64String($bytes)
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null

Write-Host "Creation du certificat « $Name »..." -ForegroundColor Cyan

# Le magasin CurrentUser suffit : aucune elevation n'est necessaire.
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=$Name" `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears($Years) `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null

# La partie publique, a distribuer par GPO aux postes.
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host ""
Write-Host "Certificat cree." -ForegroundColor Green
Write-Host "  Empreinte   : $($cert.Thumbprint)"
Write-Host "  Expire le   : $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "  Fichier pfx : $pfxPath"
Write-Host "  Partie pub. : $cerPath"
Write-Host ""
Write-Host "Pour signer les deux applications lors de la fabrication :" -ForegroundColor Yellow
Write-Host ""
Write-Host "  `$env:CSC_LINK = `"$pfxPath`""
Write-Host "  `$env:CSC_KEY_PASSWORD = `"$Password`""
Write-Host "  npm run build:all"
Write-Host ""
Write-Host "Pour que les postes fassent confiance a ce certificat, deployez" -ForegroundColor Yellow
Write-Host "« $cerPath » par GPO dans « Autorites de certification racines de confiance »."
Write-Host "Sans cela, Windows continuera d'afficher « Editeur inconnu »."
Write-Host ""
Write-Host "ATTENTION : ce certificat ne supprime pas l'avertissement SmartScreen" -ForegroundColor Red
Write-Host "pour un fichier telecharge depuis Internet. Voir docs/SIGNATURE.md."
