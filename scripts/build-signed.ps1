$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $projectRoot 'package.json'
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = $packageJson.version
$installerPath = Join-Path $projectRoot "release\POS Multimodal-$version-setup.exe"
$appExePath = Join-Path $projectRoot 'release\win-unpacked\POSMultimodal.exe'

if (-not $env:WIN_CSC_LINK) {
  throw 'Falta WIN_CSC_LINK. Define la ruta absoluta a tu certificado .pfx.'
}

if (-not (Test-Path -LiteralPath $env:WIN_CSC_LINK)) {
  throw "No existe el certificado indicado en WIN_CSC_LINK: $($env:WIN_CSC_LINK)"
}

if (-not $env:WIN_CSC_KEY_PASSWORD) {
  throw 'Falta WIN_CSC_KEY_PASSWORD. Define la password del .pfx.'
}

Write-Host 'Iniciando build oficial firmado...'
& npm.cmd run build:official

if (-not (Test-Path -LiteralPath $installerPath)) {
  throw "No se encontro el instalador esperado: $installerPath"
}

if (-not (Test-Path -LiteralPath $appExePath)) {
  throw "No se encontro el ejecutable esperado: $appExePath"
}

$installerSignature = Get-AuthenticodeSignature -LiteralPath $installerPath
$appSignature = Get-AuthenticodeSignature -LiteralPath $appExePath

Write-Host ''
Write-Host 'Firma del instalador:'
$installerSignature | Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate

Write-Host ''
Write-Host 'Firma del ejecutable:'
$appSignature | Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate

if ($installerSignature.Status -ne 'Valid') {
  throw "La firma del instalador no es valida. Estado: $($installerSignature.Status)"
}

if ($appSignature.Status -ne 'Valid') {
  throw "La firma del ejecutable no es valida. Estado: $($appSignature.Status)"
}

Write-Host ''
Write-Host 'Build firmado y verificado correctamente.'
