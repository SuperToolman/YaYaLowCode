[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$DatabaseConfig = "",
    [string]$Psql = "E:\Soft\PostgreSQL\18\bin\psql.exe",
    [string]$OutputDirectory = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (!$DatabaseConfig) { $DatabaseConfig = Join-Path $root "api/runtime/state/database.json" }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $root ("api/runtime/dev/get-data-cleanup-" + (Get-Date -Format "yyyyMMdd-HHmmss-fff")) }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$backupFile = (Join-Path $OutputDirectory "backup.json").Replace("\", "/").Replace("'", "''")
$inventoryFile = (Join-Path $OutputDirectory "inventory.json").Replace("\", "/").Replace("'", "''")
$database = (Get-Content -LiteralPath $DatabaseConfig -Raw | ConvertFrom-Json).database
$oldPassword = $env:PGPASSWORD
$env:PGPASSWORD = $database.password
$scopeSql = @'
BEGIN;
LOCK TABLE automation_flows, automation_flow_versions, automation_nodes, automation_edges, automation_flow_runs, automation_flow_run_nodes IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE legacy_get_scope ON COMMIT DROP AS
SELECT f.id, f.flow_uuid, f.name FROM automation_flows f
WHERE f.flow_type = 'trigger' AND (
  EXISTS (SELECT 1 FROM jsonb_array_elements(f.nodes_json) n WHERE n #>> '{data,kind}' IN ('get-one','get-many') AND (n #>> '{data,config,sourceMode}' = 'related-form' OR btrim(COALESCE(n #>> '{data,config,filterExpression}','')) <> ''))
  OR EXISTS (SELECT 1 FROM automation_flow_versions v CROSS JOIN LATERAL jsonb_array_elements(v.nodes_json) n WHERE v.flow_id=f.id AND n #>> '{data,kind}' IN ('get-one','get-many') AND (n #>> '{data,config,sourceMode}' = 'related-form' OR btrim(COALESCE(n #>> '{data,config,filterExpression}','')) <> ''))
);
SELECT flow_uuid, name FROM legacy_get_scope ORDER BY flow_uuid;
SELECT count(*) AS affected_integration_automations FROM legacy_get_scope;
'@
$inventorySql = @"
\o '$inventoryFile'
SELECT jsonb_pretty(jsonb_build_object('count', (SELECT count(*) FROM legacy_get_scope), 'automations', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.flow_uuid) FROM legacy_get_scope s), '[]'::jsonb)));
\o
"@
$backupSql = @"
\o '$backupFile'
SELECT jsonb_pretty(jsonb_build_object(
  'automation_flows', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM automation_flows t WHERE id IN (SELECT id FROM legacy_get_scope)), '[]'::jsonb),
  'automation_flow_versions', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM automation_flow_versions t WHERE flow_id IN (SELECT id FROM legacy_get_scope)), '[]'::jsonb),
  'automation_nodes', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM automation_nodes t WHERE flow_id IN (SELECT id FROM legacy_get_scope)), '[]'::jsonb),
  'automation_edges', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM automation_edges t WHERE flow_id IN (SELECT id FROM legacy_get_scope)), '[]'::jsonb),
  'automation_flow_runs', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM automation_flow_runs t WHERE flow_id IN (SELECT id FROM legacy_get_scope)), '[]'::jsonb),
  'automation_flow_run_nodes', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM automation_flow_run_nodes t WHERE run_id IN (SELECT id FROM automation_flow_runs WHERE flow_id IN (SELECT id FROM legacy_get_scope))), '[]'::jsonb)
));
\o
"@
$deleteSql = @'
DELETE FROM automation_flow_run_nodes WHERE run_id IN (SELECT id FROM automation_flow_runs WHERE flow_id IN (SELECT id FROM legacy_get_scope));
DELETE FROM automation_flow_runs WHERE flow_id IN (SELECT id FROM legacy_get_scope);
DELETE FROM automation_edges WHERE flow_id IN (SELECT id FROM legacy_get_scope);
DELETE FROM automation_nodes WHERE flow_id IN (SELECT id FROM legacy_get_scope);
DELETE FROM automation_flow_versions WHERE flow_id IN (SELECT id FROM legacy_get_scope);
DELETE FROM automation_flows WHERE id IN (SELECT id FROM legacy_get_scope) AND flow_type='trigger';
COMMIT;
'@
try {
    $sql = $scopeSql + "`n" + $inventorySql
    if ($Apply) { $sql += "`n" + $backupSql + "`n" + $deleteSql } else { $sql += "`nROLLBACK;" }
    $scriptFile = Join-Path $OutputDirectory "cleanup.sql"
    [IO.File]::WriteAllText($scriptFile, $sql, [Text.UTF8Encoding]::new($false))
    & $Psql -X -A -t -v ON_ERROR_STOP=1 -h $database.host -p $database.port -U $database.username -d $database.database -f $scriptFile
    if ($LASTEXITCODE -ne 0) { throw "清理失败，事务已回滚；检查 psql 输出。" }
    $inventory = Get-Content -LiteralPath (Join-Path $OutputDirectory "inventory.json") -Raw | ConvertFrom-Json
    Write-Host "命中数量: $($inventory.count)；清单目录: $OutputDirectory"
    if ($Apply) {
        Get-Content -LiteralPath (Join-Path $OutputDirectory "backup.json") -Raw | ConvertFrom-Json | Out-Null
        Write-Host "备份已保存，定向事务清理完成。"
    } else { Write-Host "仅预览，未删除数据。使用 -Apply 执行备份和清理。" }
} finally {
    if ($null -eq $oldPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $oldPassword }
}
