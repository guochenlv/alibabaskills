# 打包 alibaba-product-draft 技能为可分发 zip。
param(
  [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$skillSrc = Join-Path $root "skills\alibaba-product-draft"
$installSrc = Join-Path $root "share\INSTALL.md"
$dist = Join-Path $root $OutDir
$build = Join-Path $dist "alibaba-product-draft-skill"
$zip = Join-Path $dist "alibaba-product-draft-skill.zip"

$resolvedDist = [System.IO.Path]::GetFullPath($dist)
$resolvedBuild = [System.IO.Path]::GetFullPath($build)
if (-not $resolvedBuild.StartsWith($resolvedDist, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "build path outside dist: $resolvedBuild"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $resolvedBuild) { Remove-Item -LiteralPath $resolvedBuild -Recurse -Force }
New-Item -ItemType Directory -Force -Path $resolvedBuild | Out-Null

Copy-Item -LiteralPath $skillSrc -Destination (Join-Path $resolvedBuild 'alibaba-product-draft') -Recurse -Force
Copy-Item -LiteralPath $installSrc -Destination (Join-Path $resolvedBuild 'INSTALL.md') -Force

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $resolvedBuild '*') -DestinationPath $zip -CompressionLevel Optimal

Write-Output "built: $zip"
Get-ChildItem -Recurse -File $resolvedBuild | ForEach-Object { $_.FullName.Substring($resolvedBuild.Length + 1) }
