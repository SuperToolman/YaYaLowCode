# Functions only: dot-sourcing this file does not start services or change configuration.
function Initialize-AgentV2DevelopmentEnvironment {
    param([string]$RepositoryRoot, [int]$BackendPort)

    $profilePath = Join-Path $RepositoryRoot 'agent-v2/.env'
    if (Test-Path -LiteralPath $profilePath) {
        foreach ($line in Get-Content -LiteralPath $profilePath) {
            if ($line -match '^\s*(YAYA_AGENT_V2_[A-Z0-9_]+|YAYA_EXECUTION_(?:SECRET|ROOT|BIND|PYTHON|NODE|SHELL|BASH|TIMEOUT_SECONDS))=(.*)$') {
                $settingName = $Matches[1]
                $settingValue = $Matches[2].Trim().Trim('"').Trim("'")
                if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($settingName))) {
                    [Environment]::SetEnvironmentVariable($settingName, $settingValue, 'Process')
                }
            }
        }
    }
    if ([string]::IsNullOrWhiteSpace($env:YAYA_AGENT_V2_WORKER_SECRET)) {
        # Ephemeral development secret: inherited by API and Worker, never written to logs/files.
        $secretBytes = New-Object byte[] 32
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
        $env:YAYA_AGENT_V2_WORKER_SECRET = [Convert]::ToBase64String($secretBytes)
    }
    if ($env:YAYA_AGENT_V2_WORKER_SECRET.Length -lt 32 -or $env:YAYA_AGENT_V2_WORKER_SECRET.StartsWith('REPLACE_')) {
        throw 'Set a random YAYA_AGENT_V2_WORKER_SECRET of at least 32 bytes, or remove the placeholder to generate a development-only secret.'
    }
    $env:YAYA_AGENT_V2_API_URL = "http://127.0.0.1:$BackendPort"
    if ([string]::IsNullOrWhiteSpace($env:YAYA_AGENT_V2_CORDIS_HOST)) {
        $env:YAYA_AGENT_V2_CORDIS_HOST = Join-Path $RepositoryRoot 'agent-v2/cordis-host/src/host.mjs'
    }
}

function Get-AgentV2DevelopmentPaths {
    param([string]$RepositoryRoot)
    $root = Join-Path $RepositoryRoot 'agent-v2'
    $target = if ($env:CARGO_TARGET_DIR) {
        if ([IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) { $env:CARGO_TARGET_DIR }
        else { Join-Path $root $env:CARGO_TARGET_DIR }
    } else { Join-Path $root 'target' }
    $logDirectory = Join-Path $root 'runtime/dev'
    return @{
        Root = $root
        Binary = [IO.Path]::GetFullPath((Join-Path $target 'debug/yaya-agent-v2-worker.exe'))
        OfficeBinary = [IO.Path]::GetFullPath((Join-Path $target 'debug/yaya-agent-v2-office.exe'))
        LogDirectory = $logDirectory
        Log = Join-Path $logDirectory 'worker.log'
        ErrorLog = Join-Path $logDirectory 'worker-error.log'
        ProcessFile = Join-Path $logDirectory 'worker-process.json'
    }
}

function Stop-PreviousAgentV2DevelopmentWorker {
    param([hashtable]$Paths)
    if (-not (Test-Path -LiteralPath $Paths.ProcessFile)) {
        # A terminated launcher can lose its record while the executable remains open.
        # Only the exact build output of this checkout is eligible for recovery.
        Stop-AgentV2DevelopmentBuildOwner -Binary $Paths.Binary -ServiceName 'AgentV2 Worker'
        return
    }
    $saved = Get-Content -LiteralPath $Paths.ProcessFile -Raw | ConvertFrom-Json
    $previousWorker = Get-Process -Id ([int]$saved.processId) -ErrorAction SilentlyContinue
    if ($previousWorker) {
        # A reused PID must never cause an unrelated process to be terminated.
        if ($previousWorker.Path -ne $Paths.Binary -or $saved.binary -ne $Paths.Binary -or
            $previousWorker.StartTime.ToUniversalTime().Ticks.ToString() -ne $saved.startTimeUtcTicks) {
            throw "AgentV2 process record does not match the running process. Inspect $($Paths.ProcessFile) before restarting."
        }
        Stop-ProcessTree -ProcessId $previousWorker.Id -ServiceName 'AgentV2 Worker'
        if (-not $previousWorker.WaitForExit(10000)) { throw 'Previous AgentV2 Worker did not stop.' }
    }
    Remove-Item -LiteralPath $Paths.ProcessFile -Force
    Stop-AgentV2DevelopmentBuildOwner -Binary $Paths.Binary -ServiceName 'AgentV2 Worker'
}

function Stop-AgentV2DevelopmentBuildOwner {
    param([string]$Binary, [string]$ServiceName)
    $expected = [IO.Path]::GetFullPath($Binary)
    $processName = [IO.Path]::GetFileNameWithoutExtension($expected)
    foreach ($candidate in @(Get-Process -Name $processName -ErrorAction SilentlyContinue)) {
        if (-not $candidate.Path) { throw "Cannot verify $ServiceName executable (PID $($candidate.Id)); refusing to build over an unknown owner." }
        if (-not [string]::Equals($candidate.Path,$expected,[StringComparison]::OrdinalIgnoreCase)) { continue }
        $started = $candidate.StartTime.ToUniversalTime().Ticks
        $current = Get-Process -Id $candidate.Id -ErrorAction SilentlyContinue
        if (-not $current) { continue }
        if ($current.Path -ne $expected -or $current.StartTime.ToUniversalTime().Ticks -ne $started) {
            throw "$ServiceName process identity changed during restart."
        }
        Write-Host "Stopping previous $ServiceName from this build output (PID $($current.Id))..."
        Stop-ProcessTree -ProcessId $current.Id -ServiceName $ServiceName
        if (-not $current.WaitForExit(10000)) { throw "Previous $ServiceName did not release its executable." }
    }
}

function Build-AgentV2DevelopmentWorker {
    param([hashtable]$Paths)
    Stop-PreviousAgentV2DevelopmentWorker -Paths $Paths
    Stop-AgentV2DevelopmentBuildOwner -Binary $Paths.OfficeBinary -ServiceName 'AgentV2 Office helper'
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'Node.js and npm are required for the independent Cordis Host.'
    }
    Push-Location (Join-Path $Paths.Root 'cordis-host')
    try {
        & npm.cmd ci --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'AgentV2 Cordis dependency installation failed.' }
    } finally { Pop-Location }
    Push-Location $Paths.Root
    try {
        & cargo build --locked -p yaya-agent-v2-worker -p yaya-agent-v2-office
        if ($LASTEXITCODE -ne 0) { throw 'AgentV2 Worker build failed.' }
        $env:YAYA_AGENT_V2_OFFICE_PATH = $Paths.OfficeBinary
    } finally { Pop-Location }
}

function Start-AgentV2DevelopmentWorker {
    param([hashtable]$Paths)
    New-Item -ItemType Directory -Force -Path $Paths.LogDirectory | Out-Null
    $worker = Start-Process -FilePath $Paths.Binary -WorkingDirectory $Paths.Root -WindowStyle Hidden `
        -RedirectStandardOutput $Paths.Log -RedirectStandardError $Paths.ErrorLog -PassThru
    try {
        $record = @{
            processId = $worker.Id
            binary = $Paths.Binary
            startTimeUtcTicks = $worker.StartTime.ToUniversalTime().Ticks.ToString()
        }
        $record | ConvertTo-Json | Set-Content -LiteralPath $Paths.ProcessFile -Encoding UTF8
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline) {
            if ($worker.HasExited) { throw "AgentV2 Worker exited. See $($Paths.ErrorLog) and $($Paths.Log)." }
            if ((Test-Path -LiteralPath $Paths.Log) -and
                (Select-String -LiteralPath $Paths.Log -SimpleMatch 'Agent V2 worker ready' -Quiet)) {
                return $worker
            }
            Start-Sleep -Milliseconds 250
        }
        throw "Timed out waiting for AgentV2 Worker startup. See $($Paths.ErrorLog) and $($Paths.Log)."
    } catch {
        if (-not $worker.HasExited) { Stop-ProcessTree -ProcessId $worker.Id -ServiceName 'AgentV2 Worker' }
        Remove-Item -LiteralPath $Paths.ProcessFile -Force -ErrorAction SilentlyContinue
        throw
    }
}
