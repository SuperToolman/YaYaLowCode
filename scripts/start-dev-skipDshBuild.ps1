[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "start-dev.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "The main startup script was not found: $scriptPath"
}

& $scriptPath -SkipDshBuild
exit $LASTEXITCODE
