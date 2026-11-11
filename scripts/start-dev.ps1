[CmdletBinding()]
param(
    [int]$BackendPort = 8788,
    [int]$FrontendPort = 8787,
    [string]$LicensePublicKeyPath,
    [switch]$SkipAgentV2
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repositoryRoot "api"
$webRoot = Join-Path $repositoryRoot "web"
$defaultLicensePublicKeyPath = Join-Path $repositoryRoot "deploy\secrets\license-public.pem"
$backendHealthUrl = "http://127.0.0.1:$BackendPort/healthz"
$backendLogDirectory = Join-Path $apiRoot "runtime\dev"
$backendLog = Join-Path $backendLogDirectory "backend.log"
$backendErrorLog = Join-Path $backendLogDirectory "backend-error.log"
. (Join-Path $PSScriptRoot 'agent-v2-dev.ps1')
. (Join-Path $PSScriptRoot 'agent-v2-execution-dev.ps1')
. (Join-Path $PSScriptRoot 'agent-v2-process-ownership.ps1')
$agentV2Paths = Get-AgentV2DevelopmentPaths -RepositoryRoot $repositoryRoot

function Test-BackendReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $backendHealthUrl
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
        Assert-DevelopmentProcessOwnership -ProcessId $processId -RepositoryRoot $repositoryRoot -ServiceName $ServiceName
    }
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
$agentV2Process = $null
$env:RUST_LOG = "yaya_api=debug,yaya_agent_v2_worker=info,tower_http=info"
# Load local deployment credentials for development when the caller has not
# supplied an explicit DATABASE_URL/VALKEY_URL. The checked-in deploy/.env is
# the existing local-development source; production should inject secrets.
$developmentValues = @{}
$developmentEnvFile = Join-Path $repositoryRoot "deploy\.env"
if (Test-Path -LiteralPath $developmentEnvFile) {
    $developmentValues = @{}
    foreach ($line in Get-Content -LiteralPath $developmentEnvFile) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$') {
            $developmentValues[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL) -and $developmentValues.ContainsKey("POSTGRES_USER") -and $developmentValues.ContainsKey("POSTGRES_PASSWORD") -and $developmentValues.ContainsKey("POSTGRES_DB")) {
        $env:DATABASE_URL = "postgres://$([uri]::EscapeDataString($developmentValues.POSTGRES_USER)):$([uri]::EscapeDataString($developmentValues.POSTGRES_PASSWORD))@127.0.0.1:5432/$($developmentValues.POSTGRES_DB)"
    }
    if ([string]::IsNullOrWhiteSpace($env:VALKEY_URL) -and $developmentValues.ContainsKey("VALKEY_PASSWORD")) {
        $env:VALKEY_URL = "redis://:$($developmentValues.VALKEY_PASSWORD)@127.0.0.1:6379/0"
    }
    if ($developmentValues.ContainsKey("VALKEY_URL")) {
        $env:VALKEY_URL = $developmentValues.VALKEY_URL
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
    foreach ($name in @(
        "ALIYUN_ACCESS_KEY_ID",
        "ALIYUN_ACCESS_KEY_SECRET",
        "ALIYUN_SMS_SIGN_NAME",
        "ALIYUN_SMS_LOGIN_TEMPLATE_CODE",
        "ALIYUN_SMS_CODE_PARAM",
        "ALIYUN_SMS_REGION",
        "YAYA_BYOM_ENCRYPTION_KEY",
        "YAYA_AGENT_V2_WORKER_SECRET"
    )) {
        $useLocalSmsSetting = $name -like "ALIYUN_SMS_*" -and $env:APP_ENV -ne "production" -and $env:NODE_ENV -ne "production"
        if (($useLocalSmsSetting -or [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) -and $developmentValues.ContainsKey($name)) {
            Set-Item -Path "Env:$name" -Value $developmentValues[$name]
        }
    }
}
# Development-only defaults. Production must inject both values from its secret
# manager before starting the Rust API and AgentV2 Worker.
if ([string]::IsNullOrWhiteSpace($env:YAYA_BYOM_ENCRYPTION_KEY)) {
    $env:YAYA_BYOM_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
}
if (-not $SkipAgentV2) {
    Initialize-AgentV2DevelopmentEnvironment -RepositoryRoot $repositoryRoot -BackendPort $BackendPort
}
# API, BFF and the independent Worker must agree on custom development ports.
$env:APP_PORT = "$BackendPort"
$env:BACKEND_API_BASE_URL = "http://127.0.0.1:$BackendPort"
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

# A database connection can succeed while the application role still cannot
# use the target schema. Check this before compiling/starting the API so the
# failure explains the required administrator action instead of surfacing as a
# generic migration error (3F000 / 42501).
function Assert-DatabaseSchemaPrivileges {
    param([hashtable]$Values)

    if (-not $Values.ContainsKey("POSTGRES_USER") -or -not $Values.ContainsKey("POSTGRES_PASSWORD") -or -not $Values.ContainsKey("POSTGRES_DB")) {
        return
    }
    $psqlCandidates = @(
        (Join-Path ${env:ProgramFiles} "PostgreSQL\18\bin\psql.exe"),
        "E:\Soft\PostgreSQL\18\bin\psql.exe",
        "psql"
    )
    $psql = $psqlCandidates | Where-Object { $_ -eq "psql" -or (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $psql) {
        return
    }
    $previousPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $Values.POSTGRES_PASSWORD
        $result = & $psql -h 127.0.0.1 -p 5432 -U $Values.POSTGRES_USER -d $Values.POSTGRES_DB -Atc "SELECT has_schema_privilege(current_user, 'public', 'USAGE')::text || '|' || has_schema_privilege(current_user, 'public', 'CREATE')::text;" 2>$null
        if ($LASTEXITCODE -ne 0) {
            return
        }
        $privileges = (($result | Select-Object -Last 1) -as [string]).Trim()
        if ($privileges -notmatch "^(t|true)\|(t|true)$") {
            throw "Database role '$($Values.POSTGRES_USER)' can connect to '$($Values.POSTGRES_DB)' but lacks USAGE/CREATE on schema public. Ask a PostgreSQL administrator to run: GRANT USAGE, CREATE ON SCHEMA public TO $($Values.POSTGRES_USER);"
        }
        $foreignTables = & $psql -h 127.0.0.1 -p 5432 -U $Values.POSTGRES_USER -d $Values.POSTGRES_DB -Atc "SELECT format('%I (owner: %I)', c.relname, r.rolname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT EXISTS (SELECT 1 FROM pg_roles me WHERE me.rolname = current_user AND me.rolsuper) AND NOT pg_has_role(current_user, c.relowner, 'USAGE') ORDER BY c.relname;" 2>$null
        if ($LASTEXITCODE -eq 0 -and $foreignTables) {
            throw "Database role '$($Values.POSTGRES_USER)' cannot migrate tables owned by another role: $($foreignTables -join ', '). Have their owner or a PostgreSQL administrator transfer the application tables to the application role. For the diagnosed local tables, see scripts/repair-local-table-owners.sql."
        }
    } finally {
        if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previousPassword }
    }
}

if ($null -ne $developmentValues) {
    Assert-DatabaseSchemaPrivileges -Values $developmentValues
}
# Validate both listeners before stopping either one.
foreach ($service in @(@{port=$BackendPort;name='backend'},@{port=$FrontendPort;name='frontend'})) {
    foreach ($serviceProcessId in (Get-ListeningProcessIds -Port $service.port)) {
        Assert-DevelopmentProcessOwnership -ProcessId $serviceProcessId -RepositoryRoot $repositoryRoot -ServiceName $service.name
    }
}
Stop-RunningService -Port $BackendPort -ServiceName "backend"
Stop-RunningService -Port $FrontendPort -ServiceName "frontend"
Stop-ExistingNextDevServer -WebDirectory $webRoot
# Stop the Worker from this checkout before restarting API/compiling its executable.
# Also stop it when V2 is disabled so a prior development Worker is not left running.
Stop-PreviousAgentV2DevelopmentWorker -Paths $agentV2Paths
if (-not $SkipAgentV2) {
    Write-Host 'Preparing independent AgentV2 Worker and Cordis Host...'
    Build-AgentV2DevelopmentWorker -Paths $agentV2Paths
}

function Move-LegacyRuntimePath {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source) -or (Test-Path -LiteralPath $Destination)) {
        return
    }
    $workspacePrefix = [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    foreach ($candidate in @($Source, $Destination)) {
        if (-not [IO.Path]::GetFullPath($candidate).StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Runtime move must stay inside this repository: $candidate"
        }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Move-Item -LiteralPath $Source -Destination $Destination
}

# Migrate pre-1.11a development data after dependent services stop. The move is
# deliberately non-overwriting so an existing component-owned runtime wins.
$legacyRuntimeRoot = Join-Path $repositoryRoot "runtime"
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
    $resolvedNextDirectory = (Resolve-Path -LiteralPath $nextDirectory).Path
    if ($resolvedNextDirectory -ne [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'web/.next'))) {
        throw 'Next.js cache path must remain inside this checkout.'
    }
    Write-Host "Clearing stale Next.js cache..."
    Remove-Item -LiteralPath $nextDirectory -Recurse -Force -ErrorAction Stop
}

$previousExecutionUrl=$env:YAYA_AGENT_V2_EXECUTION_URL
$previousExecutionSecret=$env:YAYA_EXECUTION_SECRET
try {
    $executionProcess = if (-not $SkipAgentV2) { Initialize-AgentV2ExecutionDevelopment -RepositoryRoot $repositoryRoot }
    New-Item -ItemType Directory -Force -Path $backendLogDirectory | Out-Null
    Remove-Item -Force $backendLog, $backendErrorLog -ErrorAction SilentlyContinue
    # Compilation (including Cargo lock waits) is not service startup. A cold
    # Rust build can exceed the readiness deadline by several minutes.
    Write-Host "Building backend..."
    Push-Location $apiRoot
    try {
        & cargo build --locked
        if ($LASTEXITCODE -ne 0) {
            throw "Backend build failed. See the Cargo errors above."
        }
    } finally {
        Pop-Location
    }
    Write-Host "Starting backend..."
    $backendCommand = "cargo run --locked"
    if ($LicensePublicKeyPath) {
        if (-not (Test-Path -LiteralPath $LicensePublicKeyPath)) {
            throw "License verification public key was not found: $LicensePublicKeyPath"
        }
        $resolvedPublicKeyPath = (Resolve-Path -LiteralPath $LicensePublicKeyPath).Path
        $escapedPublicKeyPath = $resolvedPublicKeyPath.Replace("'", "''")
        $backendCommand = "`$env:YAYA_LICENSE_PUBLIC_KEY_PATH = '$escapedPublicKeyPath'; cargo run --locked"
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

    if (-not $SkipAgentV2) {
        $agentV2Process = Start-AgentV2DevelopmentWorker -Paths $agentV2Paths
        Write-Host "AgentV2 Worker is ready. Logs: $($agentV2Paths.Log)"
        Write-Host "AgentV2 page: http://127.0.0.1:$FrontendPort/agent-v2"
    }
    Write-Host "Starting frontend: http://127.0.0.1:$FrontendPort"
    & pnpm --dir $webRoot dev --hostname 127.0.0.1 --port $FrontendPort
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend exited with code $LASTEXITCODE."
    }
} finally {
    # Do not leave a stopped development manager configured in the caller's shell.
    $env:YAYA_AGENT_V2_EXECUTION_URL=$previousExecutionUrl
    $env:YAYA_EXECUTION_SECRET=$previousExecutionSecret
    if ($executionProcess -and -not $executionProcess.HasExited) { Stop-ProcessTree -ProcessId $executionProcess.Id -ServiceName 'AgentV2 Execution Manager' }
    if ($agentV2Process) {
        if (-not $agentV2Process.HasExited) {
            Stop-ProcessTree -ProcessId $agentV2Process.Id -ServiceName 'AgentV2 Worker'
        }
        Remove-Item -LiteralPath $agentV2Paths.ProcessFile -Force -ErrorAction SilentlyContinue
    }
    if ($startedBackend -and $backendProcess -and -not $backendProcess.HasExited) {
        Stop-ProcessTree -ProcessId $backendProcess.Id -ServiceName "Backend"
    }
}
