# 打包 Alibaba Local Bridge 扩展为离线可用包（在线桥接模式仍保留）。
param(
  [string]$Version = "0.7.0",
  [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "edge-bridge"
$dist = Join-Path $root $OutDir
$build = Join-Path $dist "alibaba-local-bridge-v$Version"
$zip = Join-Path $dist "alibaba-local-bridge-v$Version.zip"

# 安全检查：构建目录必须位于 dist 下
$resolvedDist = [System.IO.Path]::GetFullPath($dist)
$resolvedBuild = [System.IO.Path]::GetFullPath($build)
if (-not $resolvedBuild.StartsWith($resolvedDist, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "build path outside dist: $resolvedBuild"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path -LiteralPath $resolvedBuild) {
  Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedBuild | Out-Null

# 复制扩展源码
Copy-Item -LiteralPath (Join-Path $src 'manifest.json') -Destination $resolvedBuild -Force
Copy-Item -LiteralPath (Join-Path $src 'background.js') -Destination $resolvedBuild -Force
Copy-Item -LiteralPath (Join-Path $src 'content.js') -Destination $resolvedBuild -Force
Copy-Item -LiteralPath (Join-Path $src 'panel.js') -Destination $resolvedBuild -Force
Copy-Item -LiteralPath (Join-Path $src 'README.md') -Destination $resolvedBuild -Force

# 打包内置离线数据
$offline = Join-Path $resolvedBuild 'offline'
New-Item -ItemType Directory -Force -Path $offline | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'output\product-draft.json') -Destination (Join-Path $offline 'product-draft.json') -Force
Copy-Item -LiteralPath (Join-Path $root 'output\plugin-config.json') -Destination (Join-Path $offline 'plugin-config.json') -Force

# 压缩
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $resolvedBuild '*') -DestinationPath $zip -CompressionLevel Optimal

Write-Output "built: $zip"
Write-Output "folder: $resolvedBuild"
Get-ChildItem -Recurse -File $resolvedBuild | ForEach-Object { $_.FullName.Substring($resolvedBuild.Length + 1) }
