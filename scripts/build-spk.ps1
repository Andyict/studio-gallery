$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root '.spk-stage'
$out = Join-Path $root 'StudioGallery-0.1.0-5-noarch.spk'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$stage\conf","$stage\scripts","$stage\deploy" | Out-Null
Copy-Item "$root\synology\INFO" "$stage\INFO"
Copy-Item "$root\synology\conf\privilege" "$stage\conf"
Copy-Item "$root\synology\scripts\*" "$stage\scripts"
Copy-Item "$root\docker-compose.registry.yml" "$stage\docker-compose.yml"
Copy-Item "$root\deploy\nginx.conf" "$stage\deploy\nginx.conf"
Remove-Item $out -Force -ErrorAction SilentlyContinue
tar --format=ustar -czf "$stage\package.tgz" -C $stage docker-compose.yml deploy
tar --format=ustar -cf $out -C $stage INFO conf scripts package.tgz
Get-Item $out | Select-Object FullName,Length
