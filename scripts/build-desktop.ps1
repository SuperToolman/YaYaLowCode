[CmdletBinding()]
param(
    [ValidateSet("msi", "nsis", "all")]
    [string]$Target = "nsis",
    [switch]$DebugBuild,
    [switch]$SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repositoryRoot "web"
$tauriRoot = Join-Path $webRoot "src-tauri"

if (-not (Test-Path (Join-Path $webRoot "package.json"))) {
    throw "Web project was not found: $webRoot"
}

Write-Host "Building YaYa desktop application..." -ForegroundColor Cyan
Write-Host "Target: $Target"

Push-Location $webRoot
try {
    if (-not $SkipFrontendBuild) {
        Write-Host "Running frontend production build..." -ForegroundColor Yellow
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
    }

    $tauriArgs = @("tauri", "build")
    if ($DebugBuild) { $tauriArgs += "--debug" }
    if ($Target -ne "all") {
        $tauriArgs += "--bundles"
        $tauriArgs += $Target
    }

    Write-Host "Building Windows installer..." -ForegroundColor Yellow
    & pnpm @tauriArgs
    if ($LASTEXITCODE -ne 0) { throw "Tauri desktop bundle failed." }
}
finally {
    Pop-Location
}

$bundleRoot = Join-Path $tauriRoot $(if ($DebugBuild) { "target\debug\bundle" } else { "target\release\bundle" })
if (Test-Path $bundleRoot) {
    Write-Host "Desktop bundle completed:" -ForegroundColor Green
    Get-ChildItem $bundleRoot -Recurse -File |
        Where-Object { $_.Extension -in @(".exe", ".msi") } |
        Select-Object -ExpandProperty FullName
} else {
    Write-Host "Build completed. Bundle directory: $bundleRoot" -ForegroundColor Green
}
