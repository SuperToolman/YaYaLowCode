[CmdletBinding()]
param([ValidateSet('Api','Worker','Web')][string]$Service='Worker',[int]$ApiPort=8788,[int]$WebPort=8787)
$ErrorActionPreference='Stop'
$repositoryRoot=Split-Path -Parent $PSScriptRoot
$v2Root=Join-Path $repositoryRoot 'agent-v2'
# Load only shared platform secrets and the new V2 profile. Never read DSH configuration.
foreach ($profilePath in @((Join-Path $repositoryRoot 'deploy/.env'),(Join-Path $v2Root '.env'))) {
    if (Test-Path -LiteralPath $profilePath) {
        foreach ($line in Get-Content -LiteralPath $profilePath) {
            if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
                $settingName=$matches[1];$settingValue=$matches[2].Trim().Trim('"',"'")
                if (($settingName -in @('DATABASE_URL','AUTH_TOKEN_SECRET','YAYA_BYOM_ENCRYPTION_KEY','YAYA_LICENSE_PUBLIC_KEY_PATH','YAYA_LICENSE_PUBLIC_KEY_PEM')) -or $settingName.StartsWith('YAYA_AGENT_V2_')) {
                    if (-not [Environment]::GetEnvironmentVariable($settingName)) { [Environment]::SetEnvironmentVariable($settingName,$settingValue,'Process') }
                }
            }
        }
    }
}
if ($Service -ne 'Web' -and ([string]::IsNullOrWhiteSpace($env:YAYA_AGENT_V2_WORKER_SECRET) -or $env:YAYA_AGENT_V2_WORKER_SECRET.Length -lt 32 -or $env:YAYA_AGENT_V2_WORKER_SECRET.StartsWith('REPLACE_'))) { throw 'Set one random YAYA_AGENT_V2_WORKER_SECRET for API and Worker in agent-v2/.env.' }
$previous=Get-Location
try {
    switch ($Service) {
        'Api' {
            if (-not $env:DATABASE_URL) {throw 'DATABASE_URL is required.'}
            if (-not $env:YAYA_LICENSE_PUBLIC_KEY_PATH -and -not $env:YAYA_LICENSE_PUBLIC_KEY_PEM) { $env:YAYA_LICENSE_PUBLIC_KEY_PATH=Join-Path $repositoryRoot 'deploy/secrets/license-public.pem' }
            $env:APP_PORT="$ApiPort"
            Set-Location $v2Root
            & cargo build --locked -p yaya-agent-v2-office
            if ($LASTEXITCODE -ne 0) {throw 'AgentV2 office helper build failed.'}
            $officeTarget=if($env:CARGO_TARGET_DIR){[IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)}else{Join-Path $v2Root 'target'}
            $env:YAYA_AGENT_V2_OFFICE_PATH=Join-Path $officeTarget 'debug/yaya-agent-v2-office.exe'
            Set-Location (Join-Path $repositoryRoot 'api'); & cargo run --locked
        }
        'Worker' {
            if (-not $env:DATABASE_URL) {throw 'DATABASE_URL is required.'}
            if (-not $env:YAYA_AGENT_V2_API_URL) {$env:YAYA_AGENT_V2_API_URL="http://127.0.0.1:$ApiPort"}
            Set-Location (Join-Path $v2Root 'cordis-host'); & npm ci --ignore-scripts
            if ($LASTEXITCODE -ne 0) {throw 'Cordis dependency installation failed.'}
            Set-Location $v2Root; & cargo run --locked -p yaya-agent-v2-worker
        }
        'Web' {
            $env:BACKEND_API_BASE_URL="http://127.0.0.1:$ApiPort"
            Set-Location (Join-Path $repositoryRoot 'web'); & pnpm dev --port $WebPort
        }
    }
    if ($LASTEXITCODE -ne 0) {throw "$Service exited with code $LASTEXITCODE"}
} finally {Set-Location $previous}
