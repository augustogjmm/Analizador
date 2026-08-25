$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:npm_config_cache = Join-Path $PSScriptRoot '.npm-cache'

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host 'Preparando Liquidity Lab por primera vez...'
  & npm.cmd install
}

$url = 'http://localhost:3100/?version=6'
$available = $false
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
  $available = $response.StatusCode -eq 200
} catch {}

if (-not $available) {
  $vinext = Join-Path $PSScriptRoot 'node_modules\.bin\vinext.cmd'
  Start-Process -FilePath $vinext -ArgumentList @('dev', '--port', '3100') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $available = $true; break }
    } catch {}
  }
}

if (-not $available) { throw 'La aplicación no pudo iniciarse en el puerto 3100.' }
Start-Process $url
