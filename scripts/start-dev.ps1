[CmdletBinding()]
param(
    [int]$BackendPort = 8788,
    [int]$FrontendPort = 8787,
    [int]$AgentPort = 8789,
    [string]$LicensePublicKeyPath,
    [switch]$SkipDshBuild
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repositoryRoot "api"
$webRoot = Join-Path $repositoryRoot "web"
$dshRoot = Join-Path $repositoryRoot "agent\deepseek-harness"
$defaultLicensePublicKeyPath = Join-Path $repositoryRoot "deploy\secrets\license-public.pem"
$backendHealthUrl = "http://127.0.0.1:$BackendPort/healthz"
$agentHealthUrl = "http://127.0.0.1:$AgentPort/healthz"
$backendLogDirectory = Join-Path $apiRoot "runtime\dev"
$backendLog = Join-Path $backendLogDirectory "backend.log"
$backendErrorLog = Join-Path $backendLogDirectory "backend-error.log"
$agentLogDirectory = Join-Path $dshRoot "runtime\dev"
$agentLog = Join-Path $agentLogDirectory "agent.log"
$agentErrorLog = Join-Path $agentLogDirectory "agent-error.log"

function Test-BackendReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $backendHealthUrl
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-AgentReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $agentHealthUrl
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-PostgresReady {
    $pgIsReady = Join-Path ${env:ProgramFiles} "PostgreSQL\18\bin\pg_isready.exe"
    if (-not (Test-Path -LiteralPath $pgIsReady)) {
        $pgIsReady = "E:\Soft\PostgreSQL\18\bin\pg_isready.exe"
    }
    if (-not (Test-Path -LiteralPath $pgIsReady)) {
        return $false
    }
    & $pgIsReady -h 127.0.0.1 -p 5432 *> $null
    return $LASTEXITCODE -eq 0
}

function Start-LocalPostgres {
    if (Test-PostgresReady) {
        return
    }

    $postgresService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue |
        Where-Object { $_.Status -ne "Running" } |
        Select-Object -First 1
    if ($postgresService) {
        Write-Host "Starting PostgreSQL service $($postgresService.Name)..."
        try {
            Start-Service -Name $postgresService.Name -ErrorAction Stop
        } catch {
            Write-Warning "Could not start PostgreSQL Windows service: $($_.Exception.Message)"
        }
    }

    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and -not (Test-PostgresReady)) {
        Start-Sleep -Milliseconds 500
    }
    if (Test-PostgresReady) {
        return
    }

    # Fall back to the installed local instance when the service requires elevation.
    $pgRoot = "E:\Soft\PostgreSQL\18"
    $pgCtl = Join-Path $pgRoot "bin\pg_ctl.exe"
    $dataDirectory = Join-Path $pgRoot "data"
    if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath $dataDirectory)) {
        Write-Host "Starting local PostgreSQL instance with pg_ctl..."
        $postgresLog = Join-Path $dataDirectory "log\yaya-start-dev.log"
        & $pgCtl start -D $dataDirectory -l $postgresLog -w -t 30 *> $null
        if ($LASTEXITCODE -eq 0) {
            $deadline = (Get-Date).AddSeconds(15)
            while ((Get-Date) -lt $deadline -and -not (Test-PostgresReady)) {
                Start-Sleep -Milliseconds 500
            }
        }
    }
}

function Get-ListeningProcessIds {
    param(
        [int]$Port
    )

    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-RunningService {
    param(
        [int]$Port,
        [string]$ServiceName
    )

    $processIds = Get-ListeningProcessIds -Port $Port
    foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }
        Write-Host "Stopping existing $ServiceName process tree on port $Port ($($process.ProcessName), PID $processId)..."
        & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to stop existing $ServiceName process tree (PID $processId)."
        }
    }

    if ($processIds.Count -eq 0) {
        return
    }

    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline -and (Get-ListeningProcessIds -Port $Port).Count -gt 0) {
        Start-Sleep -Milliseconds 250
    }
    if ((Get-ListeningProcessIds -Port $Port).Count -gt 0) {
        throw "$ServiceName port $Port is still occupied after stopping its process tree."
    }
}

function Stop-ProcessTree {
    param(
        [int]$ProcessId,
        [string]$ServiceName
    )

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) {
        return
    }
    Write-Host "Stopping $ServiceName process tree (PID $ProcessId)..."
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to stop $ServiceName process tree (PID $ProcessId)."
    }
}

function Stop-ExistingNextDevServer {
    param(
        [string]$WebDirectory
    )

    $resolvedWebDirectory = (Resolve-Path -LiteralPath $WebDirectory).Path
    $escapedWebDirectory = [regex]::Escape($resolvedWebDirectory)
    $candidates = @(Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -match 'next.*\sdev\b' -and $_.CommandLine -match $escapedWebDirectory
    })
    $candidateIds = @($candidates | ForEach-Object { [int]$_.ProcessId })
    $roots = @($candidates | Where-Object { $candidateIds -notcontains [int]$_.ParentProcessId })

    foreach ($process in $roots) {
        Write-Host "Stopping existing Next.js dev process tree for $resolvedWebDirectory (PID $($process.ProcessId))..."
        & taskkill.exe /PID $process.ProcessId /T /F 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to stop existing Next.js dev process tree (PID $($process.ProcessId))."
        }
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
$startedAgent = $false
$agentProcess = $null
$env:RUST_LOG = "yaya_api=debug,tower_http=info"
# Load local deployment credentials for development when the caller has not
# supplied an explicit DATABASE_URL/VALKEY_URL. The checked-in deploy/.env is
# the existing local-development source; production should inject secrets.
$developmentEnvFile = Join-Path $repositoryRoot "deploy\.env"
if (Test-Path -LiteralPath $developmentEnvFile) {
    $developmentValues = @{}
    foreach ($line in Get-Content -LiteralPath $developmentEnvFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$') {
            $developmentValues[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL) -and $developmentValues.ContainsKey("POSTGRES_USER") -and $developmentValues.ContainsKey("POSTGRES_PASSWORD") -and $developmentValues.ContainsKey("POSTGRES_DB")) {
        $env:DATABASE_URL = "postgres://$($developmentValues.POSTGRES_USER):$($developmentValues.POSTGRES_PASSWORD)@127.0.0.1:5432/$($developmentValues.POSTGRES_DB)"
    }
    if ([string]::IsNullOrWhiteSpace($env:VALKEY_URL) -and $developmentValues.ContainsKey("VALKEY_PASSWORD")) {
        $env:VALKEY_URL = "redis://:$($developmentValues.VALKEY_PASSWORD)@127.0.0.1:6379/0"
    }
    # Local development must use one stable signing key for both Next.js
    # (token issuer) and Rust (token verifier). In this script's development
    # mode the checked-in local value is authoritative; this also prevents a
    # stale AUTH_TOKEN_SECRET inherited from an older shell from splitting the
    # issuer/verifier pair after a restart.
    if ($developmentValues.ContainsKey("AUTH_TOKEN_SECRET") -and $env:APP_ENV -ne "production" -and $env:NODE_ENV -ne "production") {
        $env:AUTH_TOKEN_SECRET = $developmentValues.AUTH_TOKEN_SECRET
    }
    if ([string]::IsNullOrWhiteSpace($env:BACKEND_INTERNAL_TOKEN) -and $developmentValues.ContainsKey("BACKEND_INTERNAL_TOKEN")) {
        $env:BACKEND_INTERNAL_TOKEN = $developmentValues.BACKEND_INTERNAL_TOKEN
    }
}
# Development-only defaults. Production must inject both values from its secret
# manager before starting the Rust API and DSH Harness.
if ([string]::IsNullOrWhiteSpace($env:YAYA_BYOM_ENCRYPTION_KEY)) {
    $env:YAYA_BYOM_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
}
if ([string]::IsNullOrWhiteSpace($env:AGENT_RUNTIME_SHARED_SECRET)) {
    $env:AGENT_RUNTIME_SHARED_SECRET = "yaya-development-agent-runtime-secret"
}
# Keep runtime data within the component that owns it. Rust and DSH must still
# resolve one absolute per-session workspace root because they have different
# working directories.
$env:YAYA_AGENT_WORKSPACE_ROOT = Join-Path $repositoryRoot "agent\runtime\workspaces"
$env:YAYA_API_RUNTIME_ROOT = Join-Path $repositoryRoot "api\runtime"
$env:YAYA_UPLOAD_DIR = Join-Path $repositoryRoot "api\runtime\uploads"
$env:YAYA_LOG_DIRECTORY = Join-Path $repositoryRoot "api\runtime\logs"
if ([string]::IsNullOrWhiteSpace($LicensePublicKeyPath)) {
    $LicensePublicKeyPath = $defaultLicensePublicKeyPath
}

if (-not (Test-PostgresReady)) {
    Start-LocalPostgres
    if (-not (Test-PostgresReady)) {
        throw "PostgreSQL is not accepting connections on 127.0.0.1:5432. The service and local pg_ctl fallback both failed."
    }
}
Stop-RunningService -Port $BackendPort -ServiceName "backend"
Stop-RunningService -Port $FrontendPort -ServiceName "frontend"
Stop-RunningService -Port $AgentPort -ServiceName "DSH Agent"
Stop-ExistingNextDevServer -WebDirectory $webRoot

function Move-LegacyRuntimePath {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source) -or (Test-Path -LiteralPath $Destination)) {
        return
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Move-Item -LiteralPath $Source -Destination $Destination
}

# Migrate pre-1.11a development data after dependent services stop. The move is
# deliberately non-overwriting so an existing component-owned runtime wins.
$legacyRuntimeRoot = Join-Path $repositoryRoot "runtime"
Move-LegacyRuntimePath (Join-Path $legacyRuntimeRoot "agent-workspaces") $env:YAYA_AGENT_WORKSPACE_ROOT
Move-LegacyRuntimePath (Join-Path $legacyRuntimeRoot "cargo-check-agent-skill") (Join-Path $repositoryRoot "agent\runtime\cargo-check-agent-skill")
Move-LegacyRuntimePath (Join-Path $legacyRuntimeRoot "dsh-restart.log") (Join-Path $repositoryRoot "agent\runtime\logs\dsh-restart.log")
Move-LegacyRuntimePath (Join-Path $legacyRuntimeRoot "uploads") $env:YAYA_UPLOAD_DIR
Move-LegacyRuntimePath (Join-Path $legacyRuntimeRoot "logs") $env:YAYA_LOG_DIRECTORY
Move-LegacyRuntimePath (Join-Path $legacyRuntimeRoot "state") (Join-Path $env:YAYA_API_RUNTIME_ROOT "state")
if ((Test-Path -LiteralPath $legacyRuntimeRoot) -and -not (Get-ChildItem -LiteralPath $legacyRuntimeRoot -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $legacyRuntimeRoot -Force
}

# Turbopack persists incremental metadata in .next. A previous interrupted
# publish/codegen can leave a truncated binary JSON record which Next repeatedly
# parses on every request. Rebuild this cache on each dev-session start.
$nextDirectory = Join-Path $webRoot ".next"
if (Test-Path -LiteralPath $nextDirectory) {
    Write-Host "Clearing stale Next.js cache..."
    Remove-Item -LiteralPath $nextDirectory -Recurse -Force -ErrorAction Stop
}

New-Item -ItemType Directory -Force -Path $backendLogDirectory | Out-Null
Remove-Item -Force $backendLog, $backendErrorLog -ErrorAction SilentlyContinue
Write-Host "Starting backend..."
$backendCommand = "cargo run"
if ($LicensePublicKeyPath) {
    if (-not (Test-Path -LiteralPath $LicensePublicKeyPath)) {
        throw "License verification public key was not found: $LicensePublicKeyPath"
    }
    $resolvedPublicKeyPath = (Resolve-Path -LiteralPath $LicensePublicKeyPath).Path
    $escapedPublicKeyPath = $resolvedPublicKeyPath.Replace("'", "''")
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

try {
    New-Item -ItemType Directory -Force -Path $agentLogDirectory | Out-Null
    Remove-Item -Force $agentLog, $agentErrorLog -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath (Join-Path $dshRoot "package.json"))) {
        throw "DSH workspace was not found at $dshRoot"
    }
    if (-not $SkipDshBuild) {
        Write-Host "Building DSH workspace..."
        & pnpm.cmd --dir $dshRoot build
        if ($LASTEXITCODE -ne 0) {
            throw "DSH build failed. Fix the DSH build errors, or use -SkipDshBuild when build artifacts are already current."
        }
    }
    Write-Host "Starting YaYa Agent Host..."
    $agentProcess = Start-Process `
        -FilePath "pnpm.cmd" `
        -ArgumentList @("yaya-agent-host") `
        -WorkingDirectory $dshRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $agentLog `
        -RedirectStandardError $agentErrorLog `
        -PassThru
    $startedAgent = $true

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and -not (Test-AgentReady)) {
        if ($agentProcess.HasExited) {
            $details = if (Test-Path $agentErrorLog) { Get-Content $agentErrorLog -Raw } else { "" }
            throw "DSH failed to start. $details"
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-AgentReady)) {
        throw "Timed out waiting for DSH readiness. See $agentErrorLog"
    }
    Write-Host "YaYa Agent Host is ready: $agentHealthUrl"

    $env:AGENT_RUNTIME_BASE_URL = "http://127.0.0.1:$AgentPort"
    Write-Host "Starting frontend: http://127.0.0.1:$FrontendPort"
    & pnpm --dir $webRoot dev --hostname 127.0.0.1 --port $FrontendPort
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend exited with code $LASTEXITCODE."
    }
} finally {
    if ($startedAgent -and $agentProcess -and -not $agentProcess.HasExited) {
        Stop-ProcessTree -ProcessId $agentProcess.Id -ServiceName "DSH Agent"
    }
    if ($startedBackend -and $backendProcess -and -not $backendProcess.HasExited) {
        Stop-ProcessTree -ProcessId $backendProcess.Id -ServiceName "Backend"
    }
}
