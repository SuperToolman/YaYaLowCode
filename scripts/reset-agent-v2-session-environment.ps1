[CmdletBinding()]
param([Parameter(Mandatory=$true)][guid]$DeploymentId,[Parameter(Mandatory=$true)][guid]$UserId,[Parameter(Mandatory=$true)][string]$EmployeeId,[Parameter(Mandatory=$true)][guid]$SessionId,[Parameter(Mandatory=$true)][switch]$ConfirmReset,[string]$ManagerUrl=$env:YAYA_AGENT_V2_EXECUTION_URL)
$ErrorActionPreference='Stop'
if (-not $ConfirmReset) { throw 'Pass -ConfirmReset to remove this session dependency environment. Formal messages and workspace files are preserved.' }
if (-not $ManagerUrl) { $ManagerUrl='http://127.0.0.1:8791' }
if (-not $env:YAYA_EXECUTION_SECRET -or $env:YAYA_EXECUTION_SECRET.Length -lt 32) { throw 'YAYA_EXECUTION_SECRET is required.' }
$body=@{deploymentId=$DeploymentId.ToString();userId=$UserId.ToString();employeeId=$EmployeeId;sessionId=$SessionId.ToString()} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri ($ManagerUrl.TrimEnd('/')+'/sessions/reset') -Headers @{'x-execution-secret'=$env:YAYA_EXECUTION_SECRET} -ContentType 'application/json' -Body $body
