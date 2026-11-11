[CmdletBinding()]
param([string]$TestDatabaseUrl=$env:AGENT_V2_TEST_DATABASE_URL,[switch]$Offline,[switch]$UseLocalDevelopmentDatabase,[switch]$DesignOnly)
$ErrorActionPreference='Stop'
$repositoryRoot=Split-Path -Parent $PSScriptRoot
$v2Root=Join-Path $repositoryRoot 'agent-v2'
if ($UseLocalDevelopmentDatabase -and -not $TestDatabaseUrl) {
    $values=@{}
    Get-Content (Join-Path $repositoryRoot 'deploy/.env') | ForEach-Object {if ($_ -match '^([A-Z_]+)=(.*)$') {$values[$matches[1]]=$matches[2].Trim('"',"'")}}
    $TestDatabaseUrl="postgres://$([uri]::EscapeDataString($values.POSTGRES_USER)):$([uri]::EscapeDataString($values.POSTGRES_PASSWORD))@127.0.0.1:5432/$($values.POSTGRES_DB)"
}
if (-not $TestDatabaseUrl) {throw 'Pass -TestDatabaseUrl or -UseLocalDevelopmentDatabase. Tests only create/drop randomly named schemas.'}
function Checked([string]$Program,[string[]]$Arguments) { & $Program @Arguments; if ($LASTEXITCODE -ne 0) {throw "$Program failed with code $LASTEXITCODE"} }
$cargoOptions=@('--locked');if ($Offline) {$cargoOptions+='--offline'}
$temporaryRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture=[IO.Path]::GetFullPath((Join-Path $temporaryRoot ('agent-v2-test-'+[guid]::NewGuid().ToString('N'))))
if (-not $fixture.StartsWith($temporaryRoot,[StringComparison]::OrdinalIgnoreCase)) {throw 'Invalid test fixture path'}
$oldVariables=@{};$previous=Get-Location
foreach ($name in @('CARGO_TARGET_DIR','YAYA_AGENT_V2_OFFICE_PATH','YAYA_AGENT_V2_WORKER_SECRET','AGENT_V2_TEST_DATABASE_URL','RECORD_VALIDATION_TEST_DATABASE_URL','AUTH_TOKEN_SECRET','YAYA_LICENSE_PUBLIC_KEY_PATH','YAYA_LICENSE_PUBLIC_KEY_PEM','YAYA_LICENSE_SETTINGS_PATH','YAYA_INSTALLED_AI_EMPLOYEES_PATH','YAYA_INSTALLED_AI_EMPLOYEE_PACKAGES_PATH')) {$oldVariables[$name]=[Environment]::GetEnvironmentVariable($name)}
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR=Join-Path $v2Root 'target/validation' }
try {
    Checked node @((Join-Path $repositoryRoot 'web/scripts/export-development-contracts.mjs'),'--check')
    $env:AGENT_V2_TEST_DATABASE_URL=$TestDatabaseUrl
    $env:RECORD_VALIDATION_TEST_DATABASE_URL=$TestDatabaseUrl
    Checked node @((Join-Path $v2Root 'scripts/create-test-license.mjs'),$fixture)
    Checked node @('--test',(Join-Path $v2Root 'scripts/test-fresh-database.test.mjs'))
    $env:YAYA_AGENT_V2_WORKER_SECRET='isolated-agent-v2-worker-test-secret-32'
    $env:AUTH_TOKEN_SECRET='agent-v2-isolated-test-secret'
    $env:YAYA_LICENSE_PUBLIC_KEY_PEM=''
    $env:YAYA_LICENSE_PUBLIC_KEY_PATH=Join-Path $fixture 'public.pem'
    $env:YAYA_LICENSE_SETTINGS_PATH=Join-Path $fixture 'license.json'
    $env:YAYA_INSTALLED_AI_EMPLOYEES_PATH=Join-Path $fixture 'installed.json'
    $env:YAYA_INSTALLED_AI_EMPLOYEE_PACKAGES_PATH=Join-Path $fixture 'packages.json'
    Set-Location $v2Root
    Checked cargo (@('build','-p','yaya-agent-v2-office')+$cargoOptions)
    $officeTarget=if([IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)){$env:CARGO_TARGET_DIR}else{Join-Path $v2Root $env:CARGO_TARGET_DIR}
    $env:YAYA_AGENT_V2_OFFICE_PATH=Join-Path $officeTarget 'debug/yaya-agent-v2-office.exe'
    if (-not $DesignOnly) {
        Set-Location (Join-Path $v2Root 'cordis-host')
        $npmOptions=@('ci','--ignore-scripts');if ($Offline) {$npmOptions+='--offline'}
        Checked npm $npmOptions; Checked npm @('test')
        Set-Location $v2Root
        Checked cargo (@('fmt','--all','--check'))
        Checked cargo (@('test','--workspace')+$cargoOptions+@('--','--include-ignored'))
        Checked cargo (@('build','-p','yaya-agent-v2-worker')+$cargoOptions)
        Checked powershell.exe @('-NoProfile','-File',(Join-Path $repositoryRoot 'scripts/test-agent-v2-build-owner.ps1'))
        Checked powershell.exe @('-NoProfile','-File',(Join-Path $repositoryRoot 'scripts/test-agent-v2-startup.ps1'))
    }
    Set-Location (Join-Path $repositoryRoot 'api')
    Checked cargo (@('test')+$cargoOptions+@('infrastructure::migrator::retirement_tests','--','--ignored','--test-threads=1'))
    Checked cargo (@('test')+$cargoOptions+@('modules::agent_v2::tests::api_employee_permissions_and_private_sessions','--','--ignored','--test-threads=1'))
    if (-not $DesignOnly) {
        Checked cargo (@('test')+$cargoOptions+@('modules::agent_v2::tools::read_database_tests','--','--ignored','--test-threads=1'))
        Checked cargo (@('test')+$cargoOptions+@('modules::agent_v2::tools::authorization_tests'))
        Checked cargo (@('test')+$cargoOptions+@('platform::'))
        Checked cargo (@('test')+$cargoOptions+@('platform::record_validation_database_tests::record_validation_database','--','--ignored','--test-threads=1'))
    }
    Checked cargo (@('test')+$cargoOptions+@('modules::agent_v2::design::tests'))
    Checked cargo (@('test')+$cargoOptions+@('modules::agent_v2::preview::tests'))
    Checked cargo (@('test')+$cargoOptions+@('skill_environment_configuration_survives_package_roundtrip_and_is_scoped'))
    Checked cargo (@('test')+$cargoOptions+@('modules::agent_v2::executions::'))
    Set-Location (Join-Path $repositoryRoot 'web')
    if ($DesignOnly) {
        Checked node @('node_modules/vitest/vitest.mjs','run','features/agent-v2/components/ConfirmationCard.test.tsx')
    } else {
        Checked node @('node_modules/vitest/vitest.mjs','run','features/agent-v2','app/(protected)/agent-v2/page.test.tsx','app/api/agent/v2/[...segments]/route.test.ts','app/(protected)/settings/ai-employee-market/page.test.tsx')
        Checked node @('node_modules/eslint/bin/eslint.js','app/(protected)/agent-v2','features/agent-v2','app/api/agent/v2')
        Checked node @('scripts/check-http-boundaries.mjs')
    }
} finally {
    Set-Location $previous
    foreach ($name in $oldVariables.Keys) {[Environment]::SetEnvironmentVariable($name,$oldVariables[$name],'Process')}
    if (Test-Path -LiteralPath $fixture) {Remove-Item -LiteralPath $fixture -Recurse -Force}
}
