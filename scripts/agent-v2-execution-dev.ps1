# Local execution under the current account. Session directories are not an OS sandbox.
function Initialize-AgentV2ExecutionDevelopment {
    param([string]$RepositoryRoot)
    $paths=Get-AgentV2DevelopmentPaths -RepositoryRoot $RepositoryRoot
    $binary=Join-Path (Split-Path -Parent $paths.Binary) 'yaya-agent-v2-executor.exe'
    # A URL left in the launching shell must not turn this checkout's old binary
    # into an external service. Rebuild only a verified owner at the default endpoint.
    $localEndpoint = -not $env:YAYA_AGENT_V2_EXECUTION_URL
    if ($env:YAYA_AGENT_V2_EXECUTION_URL) {
        $endpoint=$null
        if (-not [uri]::TryCreate($env:YAYA_AGENT_V2_EXECUTION_URL,[UriKind]::Absolute,[ref]$endpoint) -or
            $endpoint.Scheme -notin @('http','https') -or $endpoint.UserInfo -or $endpoint.Query -or $endpoint.Fragment) {
            throw 'YAYA_AGENT_V2_EXECUTION_URL must be an HTTP(S) URL without credentials, query or fragment.'
        }
        $localEndpoint=$endpoint.Scheme -eq 'http' -and $endpoint.Host -in @('127.0.0.1','localhost','[::1]') -and
            $endpoint.Port -eq 8791 -and $endpoint.AbsolutePath -eq '/'
    }
    $ownedLocalManager=$false
    $localPortAvailable=$false
    if ($localEndpoint) {
        $listeners=@(Get-NetTCPConnection -State Listen -LocalPort 8791 -ErrorAction SilentlyContinue)
        $localPortAvailable=$listeners.Count -eq 0
        foreach ($listener in $listeners) {
            $owner=Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
            if ($owner -and [string]::Equals($owner.Path,$binary,[StringComparison]::OrdinalIgnoreCase)) {
                $ownedLocalManager=$true
            } else {
                # Never restart an unrelated listener, even if another address is ours.
                $ownedLocalManager=$false
                break
            }
        }
    }
    if ($env:YAYA_AGENT_V2_EXECUTION_URL -and -not $ownedLocalManager -and -not $localPortAvailable) {
        if (-not $env:YAYA_EXECUTION_SECRET -or $env:YAYA_EXECUTION_SECRET.Length -lt 32) {
            throw 'An existing execution manager requires its YAYA_EXECUTION_SECRET (at least 32 characters).'
        }
        try {
            $health=Invoke-RestMethod -TimeoutSec 3 -Uri ($env:YAYA_AGENT_V2_EXECUTION_URL.TrimEnd('/')+'/healthz')
        } catch { throw 'Configured AgentV2 execution manager health request failed. Check that the configured service is running and reachable; for a stopped development manager, remove Env:YAYA_AGENT_V2_EXECUTION_URL and retry.' }
        if ($health.executionProtocol -ne 2) { throw 'Configured AgentV2 execution manager requires executionProtocol 2; upgrade/restart the executor from the current agent-v2 sources.' }
        if (-not $health.ready -or $health.backend -ne 'local') { throw 'Configured AgentV2 execution manager is not ready with the local backend.' }
        return
    }
    if (-not $env:YAYA_EXECUTION_SECRET) { $env:YAYA_EXECUTION_SECRET=$env:YAYA_AGENT_V2_WORKER_SECRET }
    if (-not $env:YAYA_EXECUTION_SECRET -or $env:YAYA_EXECUTION_SECRET.Length -lt 32) { throw 'AgentV2 execution secret must have at least 32 characters.' }
    Stop-AgentV2DevelopmentBuildOwner -Binary $binary -ServiceName 'AgentV2 Execution Manager'
    foreach ($interpreterName in @('python','node')) {
        if (-not (Get-Command $interpreterName -ErrorAction SilentlyContinue)) { Write-Warning "$interpreterName is missing: install it or configure YAYA_EXECUTION_PYTHON / YAYA_EXECUTION_NODE. Other platform tools remain available." }
    }
    if (Get-NetTCPConnection -State Listen -LocalPort 8791 -ErrorAction SilentlyContinue) {
        throw 'Port 8791 is already occupied. Set YAYA_AGENT_V2_EXECUTION_URL and YAYA_EXECUTION_SECRET to reuse an existing manager, or stop its owner first.'
    }
    Push-Location (Join-Path $RepositoryRoot 'agent-v2')
    try { & cargo build --locked -p yaya-agent-v2-executor; if ($LASTEXITCODE -ne 0) { throw 'AgentV2 execution manager build failed.' } } finally { Pop-Location }
    $env:YAYA_EXECUTION_ROOT=Join-Path $RepositoryRoot 'agent-v2/runtime/executions'
    $env:YAYA_EXECUTION_BIND='127.0.0.1:8791'
    $log=Join-Path $paths.LogDirectory 'executor.log';$errorLog=Join-Path $paths.LogDirectory 'executor-error.log'
    New-Item -ItemType Directory -Force -Path $paths.LogDirectory | Out-Null
    $process=Start-Process -FilePath $binary -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errorLog -PassThru
    $deadline=(Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) { throw "AgentV2 execution manager exited. See $errorLog" }
        try {
            $health=Invoke-RestMethod -TimeoutSec 2 -Uri 'http://127.0.0.1:8791/healthz'
            if ($health.ready -and $health.backend -eq 'local' -and $health.executionProtocol -eq 2) {
                $env:YAYA_AGENT_V2_EXECUTION_URL='http://127.0.0.1:8791'
                return $process
            }
        } catch {}
        Start-Sleep -Milliseconds 250
    }
    Stop-Process -Id $process.Id -Force
    throw 'AgentV2 execution manager readiness timed out.'
}
