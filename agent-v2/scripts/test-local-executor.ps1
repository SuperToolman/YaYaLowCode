[CmdletBinding()]
param([string]$Binary=(Join-Path $PSScriptRoot '../target/dependency-alignment/debug/yaya-agent-v2-executor.exe'))
$ErrorActionPreference='Stop'
$binaryPath=(Resolve-Path -LiteralPath $Binary).Path
$repositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
# Keep acceptance fixtures outside the platform's Node ancestry (normal Node resolution
# can see account-accessible ancestor modules; the executor is explicitly not a sandbox).
$state=Join-Path (Join-Path (Split-Path -Parent $repositoryRoot) '.yaya-execution-tests') ('live-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $state | Out-Null
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$prior=@{}
foreach($key in @('YAYA_EXECUTION_ROOT','YAYA_EXECUTION_SECRET','YAYA_EXECUTION_BIND','YAYA_EXECUTION_TIMEOUT_SECONDS','YAYA_AGENT_V2_EXECUTION_URL')){$prior[$key]=[Environment]::GetEnvironmentVariable($key)}
$env:YAYA_EXECUTION_ROOT=$state
$env:YAYA_EXECUTION_SECRET=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
$env:YAYA_EXECUTION_BIND="127.0.0.1:$port"
$env:YAYA_EXECUTION_TIMEOUT_SECONDS='120'
$env:YAYA_AGENT_V2_EXECUTION_URL="http://127.0.0.1:$port"
$manager=$null
function Start-TestManager {
    $p=Start-Process -FilePath $binaryPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $state 'stdout.log') -RedirectStandardError (Join-Path $state 'stderr.log')
    $deadline=(Get-Date).AddSeconds(20)
    while((Get-Date) -lt $deadline){
        if($p.HasExited){throw 'Test manager exited before readiness'}
        try{$health=Invoke-RestMethod "$env:YAYA_AGENT_V2_EXECUTION_URL/healthz" -TimeoutSec 1;if($health.backend -eq 'local'){return $p}}catch{}
        Start-Sleep -Milliseconds 100
    }
    Stop-Process -Id $p.Id -Force
    throw 'Test manager readiness timed out'
}
try {
    $manager=Start-TestManager
    $standard=& (Join-Path $PSScriptRoot 'test-executor-live.ps1') -ExpectedExecutionTimeoutSeconds 120 | ConvertFrom-Json
    $standard | ConvertTo-Json -Depth 5 -Compress | Write-Output
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'Live execution tests failed'}
    $prepared=& (Join-Path $PSScriptRoot 'test-executor-live.ps1') -Mode PrepareRecovery | ConvertFrom-Json
    Start-Sleep -Seconds 2
    Stop-Process -Id $manager.Id -Force;$manager.WaitForExit();$manager=$null
    $manager=Start-TestManager
    & (Join-Path $PSScriptRoot 'test-executor-live.ps1') -Mode ValidateRecovery -RecoveryExecutionId $prepared.executionId
    if($LASTEXITCODE -and $LASTEXITCODE -ne 0){throw 'Restart tests failed'}
    $headers=@{'x-execution-secret'=$env:YAYA_EXECUTION_SECRET}
    foreach($entry in @(@{language='python';code='import openpyxl; print(openpyxl.__version__)'},@{language='node';code="import ExcelJS from 'exceljs'; console.log(typeof ExcelJS.Workbook);"})){
        $request=@{id=[guid]::NewGuid().ToString();epoch=1;scope=$standard.scope;language=$entry.language;script=$entry.code;scriptPath='';arguments=@();files=@();resources=@();environment=@{};version='restart-check-v1'}
        $null=Invoke-RestMethod -Method Post -Uri "$env:YAYA_AGENT_V2_EXECUTION_URL/executions" -Headers $headers -ContentType 'application/json' -Body (ConvertTo-Json $request -Depth 10)
        $deadline=(Get-Date).AddSeconds(30)
        do{
            $result=Invoke-RestMethod "$env:YAYA_AGENT_V2_EXECUTION_URL/executions/$($request.id)" -Headers $headers
            if($result.status -notin @('queued','running')){break}
            if((Get-Date) -ge $deadline){throw 'Dependency restart probe timed out'}
            Start-Sleep -Milliseconds 100
        }while($true)
        if($result.status -ne 'succeeded'){throw 'Installed dependencies were not preserved after manager restart'}
    }
    Write-Output "PASS local HTTP execution; retained test state: $state"
} finally {
    if($manager -and -not $manager.HasExited){Stop-Process -Id $manager.Id -Force;$manager.WaitForExit()}
    foreach($key in $prior.Keys){[Environment]::SetEnvironmentVariable($key,$prior[$key])}
}
