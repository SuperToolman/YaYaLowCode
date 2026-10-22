[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$DatabaseConfig,
    [Parameter(Mandatory=$true)][switch]$DeleteAllOldWorkflowInstances,
    [string]$PostgresBin = 'E:\Soft\PostgreSQL\18\bin',
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
if (!$DeleteAllOldWorkflowInstances) { throw 'Explicit cleanup scope is required' }
$workspaceRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $workspaceRoot ('api/runtime/dev/execution-cutover-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$database = (Get-Content -LiteralPath $DatabaseConfig -Raw | ConvertFrom-Json).database
$oldPassword = $env:PGPASSWORD
$env:PGPASSWORD = $database.password
$connectionArgs = @('-h',$database.host,'-p',"$($database.port)",'-U',$database.username,'-d',$database.database)
try {
    $backup = Join-Path $OutputDirectory 'before-cleanup.dump'
    & (Join-Path $PostgresBin 'pg_dump.exe') @connectionArgs -Fc -f $backup
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $backup)) { throw 'Database backup failed; cleanup was not executed' }
    $maintenanceSql = Join-Path $PSScriptRoot 'cleanup-old-workflow-instances.sql'
    & (Join-Path $PostgresBin 'psql.exe') @connectionArgs -X -v ON_ERROR_STOP=1 -f $maintenanceSql 2>&1 |
        Tee-Object -FilePath (Join-Path $OutputDirectory 'cleanup.log')
    if ($LASTEXITCODE -ne 0) { throw 'Cleanup failed; inspect the log and preserve the backup' }
    Write-Host "Cleanup complete. Backup: $backup"
} finally { $env:PGPASSWORD = $oldPassword }
