[CmdletBinding()]
param(
    [string]$BaseUrl=$env:YAYA_AGENT_V2_EXECUTION_URL,
    [ValidateSet('Standard','PrepareRecovery','ValidateRecovery')][string]$Mode='Standard',
    [guid]$RecoveryExecutionId=[guid]::Empty,
    [ValidateRange(1,600)][int]$ExpectedExecutionTimeoutSeconds=120
)
$ErrorActionPreference='Stop'
if (-not $BaseUrl -or -not $env:YAYA_EXECUTION_SECRET) { Write-Output '{"status":"blocked","stage":"manager-preflight","reason":"Execution URL and existing secret required"}'; exit 2 }
$headers=@{'x-execution-secret'=$env:YAYA_EXECUTION_SECRET}
$scope=@{deploymentId=[guid]::NewGuid().ToString();userId=[guid]::NewGuid().ToString();employeeId='local-execution-acceptance';sessionId=[guid]::NewGuid().ToString()}
function Call([string]$Method,[string]$Path,$Body=$null) {
    $parameters=@{Method=$Method;Uri=($BaseUrl.TrimEnd('/')+$Path);Headers=$headers;TimeoutSec=45}
    if ($null -ne $Body) {$parameters.Body=ConvertTo-Json -InputObject $Body -Depth 20 -Compress;$parameters.ContentType='application/json'}
    Invoke-RestMethod @parameters
}
function Request([string]$Language,[string]$Code) {
    @{id=[guid]::NewGuid().ToString();epoch=1;scope=$scope;language=$Language;script=$Code;scriptPath='';arguments=@();files=@();resources=@();environment=@{};version='live-test-1'}
}
function Await-Result([string]$Id,[int]$TimeoutSeconds=90) {
    $deadline=(Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $result=Call GET "/executions/$Id"
        if ($result.status -notin @('queued','running')) {return $result}
        Start-Sleep -Milliseconds 300
    }
    throw "Execution $Id did not finish"
}
function Expect-Conflict([scriptblock]$Action) {
    try { & $Action | Out-Null } catch {
        if ([int]$_.Exception.Response.StatusCode -eq 409) { return }
        throw
    }
    throw 'Expected HTTP 409, but execution was accepted'
}
if ($Mode -eq 'PrepareRecovery') {
    $recovery=Request node 'console.log("recovery-started"); setTimeout(()=>{},660000);'
    $null=Call POST /executions $recovery
    $deadline=(Get-Date).AddSeconds(20)
    do {
        $logs=Call GET "/executions/$($recovery.id)/logs?stream=stdout&offset=0"
        if($logs.text -match 'recovery-started'){break}
        if((Get-Date) -ge $deadline){throw 'Recovery fixture never started'}
        Start-Sleep -Milliseconds 100
    } while($true)
    # Deliberately leave this test job active. Restart ONLY the test manager, then validate this ID.
    Write-Output (ConvertTo-Json @{status='awaiting-manager-restart';executionId=$recovery.id} -Compress)
    exit 0
}
if ($Mode -eq 'ValidateRecovery') {
    if ($RecoveryExecutionId -eq [guid]::Empty) { throw 'Provide RecoveryExecutionId from PrepareRecovery' }
    $result=Call GET "/executions/$RecoveryExecutionId"
    if ($result.status -ne 'outcome_unknown') { throw 'Restart must preserve uncertain outcome without automatic replay' }
    Write-Output '{"status":"passed","scenario":"manager-restart-no-replay"}'
    exit 0
}
$health=Call GET /healthz
if ($health.backend -ne 'local' -or -not $health.ready) {throw 'Local backend required'}
$jobs=@()
function Run-Checked($Request) {
    $script:jobs+=$Request.id
    $null=Call POST /executions $Request
    $result=Await-Result $Request.id 240
    if($result.status -ne 'succeeded'){throw "Execution failed: $($result.status) $($result.result | ConvertTo-Json -Depth 8 -Compress)"}
    return $result
}
try {
    $missing=Request python 'import openpyxl'
    $jobs+=$missing.id;$null=Call POST /executions $missing
    $result=Await-Result $missing.id
    if($result.status -ne 'failed' -or $result.result.stderr -notmatch 'ModuleNotFoundError'){throw 'Fresh session must demonstrate missing openpyxl'}
    $null=Run-Checked (Request shell 'python -m pip install openpyxl')
    $python=Request python @'
import os
from pathlib import Path
from openpyxl import Workbook
assert 'DATABASE_URL' not in os.environ
assert os.environ['LIVE_SKILL_CONFIG'] == 'live-test-config-value'
book=Workbook()
book.active.append(['item','value'])
book.active.append(['example',42])
book.save(Path(os.environ['YAYA_OUTPUT_DIR'])/'report.xlsx')
(Path(os.environ['YAYA_OUTPUT_DIR'])/'notes.txt').write_text('Two artifacts',encoding='utf-8')
print(os.environ['LIVE_SKILL_CONFIG'])
'@
    $python.environment=@{LIVE_SKILL_CONFIG='live-test-config-value'}
    $jobs+=$python.id
    $null=Call POST /executions $python
    $result=Await-Result $python.id
    if ($result.status -ne 'succeeded' -or $result.result.artifacts.Count -ne 2) {throw 'Python / multi-artifact execution failed'}
    if ($result.result.stdout.Contains('live-test-config-value')) {throw 'Skill configuration leaked through logs'}
    $logs=Call GET "/executions/$($python.id)/logs?stream=stdout&offset=0"
    if ($logs.text.Contains('live-test-config-value')) {throw 'Skill configuration leaked through persisted logs'}
    $replay=Call POST /executions $python
    if ($replay.status -ne 'succeeded') {throw 'Execution replay changed the result'}
    $python.epoch=2
    $null=Call POST /executions $python
    Expect-Conflict { Call POST "/executions/$($python.id)/cancel" @{epoch=1} }
    $python.script+='; print("changed")'
    Expect-Conflict { Call POST /executions $python }
    $missingNode=Request node "import ExcelJS from 'exceljs';"
    $jobs+=$missingNode.id;$null=Call POST /executions $missingNode
    $result=Await-Result $missingNode.id
    if($result.status -ne 'failed' -or $result.result.stderr -notmatch 'ERR_MODULE_NOT_FOUND'){throw 'Fresh session must demonstrate missing exceljs'}
    $null=Run-Checked (Request shell 'npm install exceljs --no-audit --no-fund --fetch-retries=0 --fetch-timeout=30000 --loglevel=info')
    $node=Request node @'
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
const template=fs.readFileSync(path.join(process.env.YAYA_SKILL_DIR,'templates/header.txt'),'utf8');
const workbook=new ExcelJS.Workbook();
workbook.addWorksheet('Report').addRow([template,42]);
await workbook.xlsx.writeFile(path.join(process.env.YAYA_OUTPUT_DIR,'node-report.xlsx'));
'@
    $node.scriptPath='scripts/report.mjs'
    $node.resources=@(@{path=$node.scriptPath;data=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($node.script))},@{path='templates/header.txt';data=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('value'))})
    $jobs+=$node.id
    $null=Call POST /executions $node
    $result=Await-Result $node.id
    if ($result.status -ne 'succeeded' -or $result.result.artifacts.Count -ne 1) {throw 'Node / template / base dependency execution failed'}
    $commonjs=Request node 'const ExcelJS=require("exceljs"); console.log(typeof ExcelJS.Workbook);'
    $commonjs.scriptPath='scripts/check.cjs'
    $commonjs.resources=@(@{path=$commonjs.scriptPath;data=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($commonjs.script))})
    $null=Run-Checked $commonjs
    $cancel=Request python 'import time; time.sleep(60)'
    $jobs+=$cancel.id
    $null=Call POST /executions $cancel
    $result=Call POST "/executions/$($cancel.id)/cancel" @{epoch=1}
    if ($result.status -ne 'cancelled') {throw 'Cancellation failed'}
    $timeout=Request python "import time; time.sleep($($ExpectedExecutionTimeoutSeconds+60))"
    $jobs+=$timeout.id
    $null=Call POST /executions $timeout
    $result=Await-Result $timeout.id ($ExpectedExecutionTimeoutSeconds+45)
    if ($result.status -ne 'timed_out') {throw 'Execution timeout was not persisted; check expected manager timeout configuration'}
    Write-Output (ConvertTo-Json @{status='passed';scope=$scope;scenarios=@('python-missing-install-rerun','node-missing-install-rerun','commonjs-esm','template','multi-artifact','config-redaction','replay','conflict','old-epoch','cancel','timeout')} -Depth 5 -Compress)
} finally {
    foreach ($job in $jobs) {try {$null=Call POST "/executions/$job/cancel" @{epoch=1}} catch {}}
}
