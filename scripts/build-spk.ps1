$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root '.spk-stage'
$out = Join-Path $root 'StudioGallery-0.1.0-noarch.spk'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$stage\conf","$stage\scripts","$stage\var\deploy" | Out-Null
Copy-Item "$root\synology\INFO" "$stage\INFO"
Copy-Item "$root\synology\conf\privilege" "$stage\conf"
Copy-Item "$root\synology\scripts\*" "$stage\scripts"
Copy-Item "$root\docker-compose.registry.yml" "$stage\var\docker-compose.yml"
Copy-Item "$root\deploy\nginx.conf" "$stage\var\deploy\nginx.conf"
Remove-Item $out -Force -ErrorAction SilentlyContinue
$payload = Join-Path $stage 'package-root'
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Move-Item "$stage\var" $payload
tar --format=ustar -czf "$stage\package.tgz" -C $payload .
Remove-Item $payload -Recurse -Force
tar --format=ustar -cf $out -C $stage INFO conf scripts package.tgz
Get-Item $out | Select-Object FullName,Length
