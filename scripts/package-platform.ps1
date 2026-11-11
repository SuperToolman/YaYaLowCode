param(
  [string]$Platform = 'linux/amd64',
  [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$packageScript = Join-Path $PSScriptRoot 'package-platform.mjs'
$arguments = @()
if ($Platform) { $arguments += @('--platform', $Platform) }
if ($OutputDirectory) { $arguments += @('--output', $OutputDirectory) }
& node $packageScript @arguments
if ($LASTEXITCODE -ne 0) { throw '平台打包失败' }
