[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$DatabaseConfig,
    [string]$Binary = '',
    [string]$PostgresBin = 'E:\Soft\PostgreSQL\18\bin'
)
$ErrorActionPreference='Stop'
$workspaceRoot=Split-Path -Parent $PSScriptRoot
if (!$Binary) { $Binary=Join-Path $workspaceRoot 'api/target/debug/yaya-execution.exe' }
$database=(Get-Content -LiteralPath $DatabaseConfig -Raw | ConvertFrom-Json).database
$runName='execution_migration_'+[guid]::NewGuid().ToString('N')
$output=Join-Path $workspaceRoot "api/runtime/dev/$runName"
New-Item -ItemType Directory -Path $output | Out-Null
$oldPassword=$env:PGPASSWORD
$oldSettings=$env:YAYA_SETTINGS_PATH
$oldRoot=$env:YAYA_API_RUNTIME_ROOT
$oldUrl=$env:DATABASE_URL
$env:PGPASSWORD=$database.password
$adminArgs=@('-h',$database.host,'-p',"$($database.port)",'-U',$database.username,'-d',$database.database)
function Invoke-AdminSql([string]$Sql) {
    & (Join-Path $PostgresBin 'psql.exe') @adminArgs -X -v ON_ERROR_STOP=1 -c $Sql
    if ($LASTEXITCODE -ne 0) { throw 'Migration test database operation failed' }
}
try {
    & (Join-Path $PostgresBin 'pg_dump.exe') @adminArgs -Fc -f (Join-Path $output 'source.dump')
    if ($LASTEXITCODE -ne 0) { throw 'Source backup failed' }
    foreach ($mode in @('empty','restored')) {
        $testDatabase=$runName+'_'+$mode
        Invoke-AdminSql "CREATE DATABASE $testDatabase;"
        try {
            if ($mode -eq 'restored') {
                & (Join-Path $PostgresBin 'pg_restore.exe') -h $database.host -p $database.port -U $database.username -d $testDatabase --no-owner --exit-on-error (Join-Path $output 'source.dump')
                if ($LASTEXITCODE -ne 0) { throw 'Restore fixture failed' }
            }
            $testSettings=@{database=@{host=$database.host;port=$database.port;username=$database.username;password=$database.password;database=$testDatabase}}
            $testSettings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'database.json') -Encoding utf8
            $env:YAYA_SETTINGS_PATH=Join-Path $output 'database.json'
            $env:YAYA_API_RUNTIME_ROOT=$output
            Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
            & $Binary --migrate-only 2>&1 | Set-Content -LiteralPath (Join-Path $output "$mode.log")
            if ($LASTEXITCODE -ne 0) { throw "Migration failed for $mode; inspect $output" }
            & (Join-Path $PostgresBin 'psql.exe') -h $database.host -p $database.port -U $database.username -d $testDatabase -X -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM seaql_migrations WHERE version='m20261012_000079_common_execution'; SELECT count(*) FROM automation_execution_tokens;"
            if ($LASTEXITCODE -ne 0) { throw 'Migration result validation failed' }
            & $Binary --migrate-only 2>&1 | Set-Content -LiteralPath (Join-Path $output "$mode-repeat.log")
            if ($LASTEXITCODE -ne 0) { throw 'Repeated migration failed' }
            Write-Host "PASS: $mode migration and repeat execution"
        } finally { Invoke-AdminSql "DROP DATABASE $testDatabase WITH (FORCE);" }
    }
} finally {
    $env:PGPASSWORD=$oldPassword
    $env:YAYA_SETTINGS_PATH=$oldSettings
    $env:YAYA_API_RUNTIME_ROOT=$oldRoot
    $env:DATABASE_URL=$oldUrl
}
