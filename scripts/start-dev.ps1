[CmdletBinding()]
param(
    [int]$BackendPort = 8787
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repositoryRoot "api"
$webRoot = Join-Path $repositoryRoot "web"
$backendHealthUrl = "http://127.0.0.1:$BackendPort/healthz"
$backendOpenApiUrl = "http://127.0.0.1:$BackendPort/openapi.json"
$backendLog = Join-Path $apiRoot ".dev-backend.log"
$backendErrorLog = Join-Path $apiRoot ".dev-backend-error.log"
$openApiPath = Join-Path $webRoot "openapi\openapi.json"
$openApiBasePath = Join-Path $webRoot "openapi\openapi.base.json"
$openApiGeneratedPath = Join-Path $webRoot "openapi\openapi.generated.json"

function Test-BackendReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $backendHealthUrl
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo was not found. Install the Rust toolchain first."
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm was not found. Install pnpm first."
}

$startedBackend = $false
$backendProcess = $null
if (Test-BackendReady) {
    Write-Host "Backend is already running: $backendHealthUrl"
} else {
    Remove-Item -Force $backendLog, $backendErrorLog -ErrorAction SilentlyContinue
    Write-Host "Starting backend..."
    $backendProcess = Start-Process `
        -FilePath "cargo" `
        -ArgumentList @("run") `
        -WorkingDirectory $apiRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError $backendErrorLog `
        -PassThru
    $startedBackend = $true

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and -not (Test-BackendReady)) {
        if ($backendProcess.HasExited) {
            $details = if (Test-Path $backendErrorLog) { Get-Content $backendErrorLog -Raw } else { "" }
            throw "Backend failed to start. $details"
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not (Test-BackendReady)) {
        throw "Timed out waiting for backend readiness. See $backendErrorLog"
    }
    Write-Host "Backend is ready: $backendHealthUrl"
}

try {
    Write-Host "Downloading the current OpenAPI document..."
    try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 $backendOpenApiUrl -OutFile $openApiGeneratedPath
    } catch {
        throw "The running backend does not expose $backendOpenApiUrl. Restart it with the current code before starting the frontend."
    }
    Get-Content $openApiGeneratedPath -Raw | ConvertFrom-Json | Out-Null
    & node (Join-Path $webRoot "scripts\merge-openapi.mjs") $openApiBasePath $openApiGeneratedPath $openApiPath
    if ($LASTEXITCODE -ne 0) {
        throw "OpenAPI merge failed."
    }

    Write-Host "Generating the HeyAPI client from web/openapi/openapi.json..."
    & pnpm --dir $webRoot codegen:api
    if ($LASTEXITCODE -ne 0) {
        throw "HeyAPI client generation failed."
    }

    Write-Host "Starting frontend: http://127.0.0.1:3000"
    & pnpm --dir $webRoot exec next dev
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend exited with code $LASTEXITCODE."
    }
} finally {
    Remove-Item -Force $openApiGeneratedPath -ErrorAction SilentlyContinue
    if ($startedBackend -and $backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id
    }
}
