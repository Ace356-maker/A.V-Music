# Compila el instalador de release con la firma de actualizaciones.
#
# El auto-update exige firmar cada release: `tauri build` busca la llave
# privada en las variables de entorno, que en local se pierden al cerrar
# la terminal. Este script las prepara (llave desde ~/.tauri/avmusic.key y
# contraseña, que pide una sola vez de forma segura) y ejecuta el build.
#
# Uso:  pnpm build:release

$ErrorActionPreference = "Stop"

$keyFile = Join-Path $HOME ".tauri\avmusic.key"
if (-not (Test-Path $keyFile)) {
    Write-Error "No se encontró la llave de firma en $keyFile. Genérala con: pnpm tauri signer generate -w `"$keyFile`""
    exit 1
}

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $keyFile

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    $secure = Read-Host "Contraseña de la llave de firma" -AsSecureString
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
}

pnpm tauri build
