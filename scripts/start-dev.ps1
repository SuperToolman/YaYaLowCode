[CmdletBinding()]
param(
    [int]$BackendPort = 8787,
    [int]$FrontendPort = 3000,
    [string]$LicensePublicKeyPath = $env:YAYA_LICENSE_PUBLIC_KEY_PATH
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repositoryRoot "api"
$backendHealthUrl = "http://127.0.0.1:$BackendPort/healthz"
$backendLogDirectory = Join-Path $apiRoot "runtime\dev"
$backendLog = Join-Path $backendLogDirectory "backend.log"
$backendErrorLog = Join-Path $backendLogDirectory "backend-error.log"

function Test-BackendReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $backendHealthUrl
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Assert-PortAvailable {
    param(
        [int]$Port,
        [string]$ServiceName
    )

    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) {
        return
    }
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    throw "$ServiceName port $Port is occupied by $($process.ProcessName) (PID $($process.Id)). Stop it explicitly or select another port."
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo was not found. Install the Rust toolchain first."
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm was not found. Install pnpm first."
}

$startedBackend = $false
$backendProcess = $null
$env:RUST_LOG = "yaya_api=debug,tower_http=info"
if (Test-BackendReady) {
    Write-Host "Backend is already running: $backendHealthUrl"
}

if (-not (Test-BackendReady)) {
    Assert-PortAvailable -Port $BackendPort -ServiceName "Backend"
    New-Item -ItemType Directory -Force -Path $backendLogDirectory | Out-Null
    Remove-Item -Force $backendLog, $backendErrorLog -ErrorAction SilentlyContinue
    Write-Host "Starting backend..."
    $backendCommand = "cargo run"
    if ($LicensePublicKeyPath) {
        if (-not (Test-Path -LiteralPath $LicensePublicKeyPath)) {
            throw "License verification public key was not found: $LicensePublicKeyPath"
        }
        $escapedPublicKeyPath = $LicensePublicKeyPath.Replace("'", "''")
        $backendCommand = "`$env:YAYA_LICENSE_PUBLIC_KEY_PATH = '$escapedPublicKeyPath'; cargo run"
    }
    $backendProcess = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-Command", $backendCommand) `
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
    Assert-PortAvailable -Port $FrontendPort -ServiceName "Frontend"
    Write-Host "Starting frontend: http://127.0.0.1:$FrontendPort"
    & pnpm --dir $repositoryRoot dev:web -- --port $FrontendPort
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend exited with code $LASTEXITCODE."
    }
} finally {
    if ($startedBackend -and $backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id
    }
}
