$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root '.spk-stage'
$out = Join-Path $root 'StudioGallery-0.2.0-4-noarch.spk'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$stage\conf","$stage\scripts","$stage\backend","$stage\frontend","$stage\icons" | Out-Null
Copy-Item "$root\synology\INFO" "$stage\INFO"
Copy-Item "$root\synology\conf\privilege" "$stage\conf"
Copy-Item "$root\synology\scripts\*" "$stage\scripts"
Copy-Item "$root\backend\src" "$stage\backend\src" -Recurse
Copy-Item "$root\backend\node_modules" "$stage\backend\node_modules" -Recurse
Copy-Item "$root\backend\package.json" "$stage\backend\package.json"
Copy-Item "$root\frontend\.next\standalone\*" "$stage\frontend" -Recurse
Copy-Item "$root\frontend\.next\static" "$stage\frontend\frontend\.next\static" -Recurse
if (Test-Path "$root\frontend\public") { Copy-Item "$root\frontend\public" "$stage\frontend\frontend\public" -Recurse }
Copy-Item "$root\synology\icons\manager-256.png" "$stage\icon.png"
Copy-Item "$root\synology\icons\manager-72.png" "$stage\icon_72.png"
Copy-Item "$root\synology\icons\console-256.png" "$stage\icons\console-256.png"
Copy-Item "$root\synology\icons\console-72.png" "$stage\icons\console-72.png"
Remove-Item $out -Force -ErrorAction SilentlyContinue
tar --format=ustar -czf "$stage\package.tgz" -C $stage backend frontend icons
tar --format=ustar -cf $out -C $stage INFO conf scripts package.tgz icon.png icon_72.png
Get-Item $out | Select-Object FullName,Length
