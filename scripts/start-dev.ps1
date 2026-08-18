[CmdletBinding()]
param(
    [int]$BackendPort = 8788,
    [int]$FrontendPort = 8787,
    [int]$AgentPort = 8789,
    [string]$LicensePublicKeyPath
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $repositoryRoot "api"
$webRoot = Join-Path $repositoryRoot "web"
$agentRoot = Join-Path $repositoryRoot "agent"
$defaultLicensePublicKeyPath = Join-Path $repositoryRoot "deploy\secrets\license-public.pem"
$backendHealthUrl = "http://127.0.0.1:$BackendPort/healthz"
$agentHealthUrl = "http://127.0.0.1:$AgentPort/healthz"
$backendLogDirectory = Join-Path $apiRoot "runtime\dev"
$backendLog = Join-Path $backendLogDirectory "backend.log"
$backendErrorLog = Join-Path $backendLogDirectory "backend-error.log"
$agentLogDirectory = Join-Path $agentRoot "runtime\dev"
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
if ([string]::IsNullOrWhiteSpace($LicensePublicKeyPath)) {
    $LicensePublicKeyPath = $defaultLicensePublicKeyPath
}
Stop-RunningService -Port $BackendPort -ServiceName "backend"
Stop-RunningService -Port $FrontendPort -ServiceName "frontend"
Stop-RunningService -Port $AgentPort -ServiceName "Cordis Agent"
Stop-ExistingNextDevServer -WebDirectory $webRoot

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
    Write-Host "Starting Cordis Agent..."
    $agentProcess = Start-Process `
        -FilePath "pnpm.cmd" `
        -ArgumentList @("start") `
        -WorkingDirectory $agentRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $agentLog `
        -RedirectStandardError $agentErrorLog `
        -PassThru
    $startedAgent = $true

    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and -not (Test-AgentReady)) {
        if ($agentProcess.HasExited) {
            $details = if (Test-Path $agentErrorLog) { Get-Content $agentErrorLog -Raw } else { "" }
            throw "Cordis Agent failed to start. $details"
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-AgentReady)) {
        throw "Timed out waiting for Cordis Agent readiness. See $agentErrorLog"
    }
    Write-Host "Cordis Agent is ready: $agentHealthUrl"

    $env:AGENT_RUNTIME_BASE_URL = "http://127.0.0.1:$AgentPort"
    Write-Host "Starting frontend: http://127.0.0.1:$FrontendPort"
    & pnpm --dir $webRoot dev --port $FrontendPort
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend exited with code $LASTEXITCODE."
    }
} finally {
    if ($startedAgent -and $agentProcess -and -not $agentProcess.HasExited) {
        Stop-ProcessTree -ProcessId $agentProcess.Id -ServiceName "Cordis Agent"
    }
    if ($startedBackend -and $backendProcess -and -not $backendProcess.HasExited) {
        Stop-ProcessTree -ProcessId $backendProcess.Id -ServiceName "Backend"
    }
}
