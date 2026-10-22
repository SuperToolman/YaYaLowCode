[CmdletBinding()]
param([string]$Psql = "E:\Soft\PostgreSQL\18\bin\psql.exe")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$database = (Get-Content (Join-Path $root "api/runtime/state/database.json") -Raw | ConvertFrom-Json).database
$schema = "get_cleanup_test_" + [guid]::NewGuid().ToString("N")
$output = Join-Path $root "api/runtime/dev/$schema"
New-Item -ItemType Directory -Path $output | Out-Null
$oldPassword = $env:PGPASSWORD
$oldOptions = $env:PGOPTIONS
$env:PGPASSWORD = $database.password
function Invoke-TestSql([string]$sql) {
    $sqlFile = Join-Path $output "test.sql"
    [IO.File]::WriteAllText($sqlFile, $sql, [Text.UTF8Encoding]::new($false))
    & $Psql -X -q -v ON_ERROR_STOP=1 -h $database.host -p $database.port -U $database.username -d $database.database -f $sqlFile
    if ($LASTEXITCODE -ne 0) { throw "Cleanup fixture assertion failed" }
}
try {
    Invoke-TestSql "CREATE SCHEMA $schema;"
    $env:PGOPTIONS = "-c search_path=$schema"
    Invoke-TestSql @'
CREATE TABLE automation_flows (LIKE public.automation_flows INCLUDING ALL);
CREATE TABLE automation_flow_versions (LIKE public.automation_flow_versions INCLUDING ALL);
CREATE TABLE automation_nodes (LIKE public.automation_nodes INCLUDING ALL);
CREATE TABLE automation_edges (LIKE public.automation_edges INCLUDING ALL);
CREATE TABLE automation_flow_runs (LIKE public.automation_flow_runs INCLUDING ALL);
CREATE TABLE automation_flow_run_nodes (LIKE public.automation_flow_run_nodes INCLUDING ALL);
CREATE TABLE form_business_records (id int PRIMARY KEY, value text);
INSERT INTO form_business_records VALUES (1, 'must survive');
INSERT INTO automation_flows
SELECT (jsonb_populate_record(NULL::automation_flows, to_jsonb(template) || jsonb_build_object('id',gen_random_uuid(), 'flow_uuid',fixture.id, 'name',fixture.id, 'flow_type',fixture.type, 'nodes_json', fixture.nodes))).*
FROM (SELECT * FROM public.automation_flows LIMIT 1) template
CROSS JOIN (VALUES
 ('current-related','trigger','[{"data":{"kind":"get-one","config":{"sourceMode":"related-form"}}}]'::jsonb),
 ('current-expression','trigger','[{"data":{"kind":"get-many","config":{"filterExpression":"a == b"}}}]'::jsonb),
 ('history-only','trigger','[]'::jsonb),
 ('process-keep','process','[{"data":{"kind":"get-one","config":{"sourceMode":"related-form"}}}]'::jsonb),
 ('unaffected-keep','trigger','[{"data":{"kind":"get-many","config":{"filterExpression":" "}}}]'::jsonb),
 ('other-kind-keep','trigger','[{"data":{"kind":"update-data","config":{"filterExpression":"a == b"}}}]'::jsonb)
) fixture(id,type,nodes);
INSERT INTO automation_flow_versions (id,flow_id,version,name,status,trigger_config,nodes_json,edges_json,created_by,created_at)
SELECT gen_random_uuid(), id, 1, name, status, trigger_config,
CASE WHEN flow_uuid='history-only' THEN '[{"data":{"kind":"get-many","config":{"filterExpression":"legacy"}}}]'::jsonb ELSE nodes_json END,
edges_json,created_by,created_at FROM automation_flows;
INSERT INTO automation_nodes (id,flow_id,version,node_key,node_kind,label,position_x,position_y,config_json,raw_json,created_at,updated_at)
SELECT gen_random_uuid(),id,1,'query','get-one','query',0,0,'{}','{}',now(),now() FROM automation_flows;
INSERT INTO automation_edges (id,flow_id,version,edge_key,source_node_key,target_node_key,raw_json,created_at,updated_at)
SELECT gen_random_uuid(),id,1,'edge','trigger','query','{}',now(),now() FROM automation_flows;
INSERT INTO automation_flow_runs (id,run_uuid,flow_id,flow_version,trigger_event,trigger_payload,status,started_at,created_at,updated_at)
SELECT gen_random_uuid(),flow_uuid,id,1,'after_create','{}','success',now(),now(),now() FROM automation_flows;
INSERT INTO automation_flow_run_nodes (id,run_id,node_key,node_kind,node_label,status,input_json,started_at,created_at,updated_at)
SELECT gen_random_uuid(),id,'query','get-one','query','success','{}',now(),now(),now() FROM automation_flow_runs;
DO $$ BEGIN IF (SELECT count(*) FROM automation_flows) <> 6 THEN RAISE EXCEPTION 'fixture count'; END IF; END $$;
'@
    & (Join-Path $PSScriptRoot "cleanup-legacy-get-data.ps1") -Apply -Psql $Psql -OutputDirectory (Join-Path $output "first")
    $backup = Get-Content (Join-Path $output "first/backup.json") -Raw | ConvertFrom-Json
    foreach ($table in @('automation_flows','automation_flow_versions','automation_nodes','automation_edges','automation_flow_runs','automation_flow_run_nodes')) {
        if ($backup.$table.Count -ne 3) { throw "Incomplete backup: $table" }
    }
    Invoke-TestSql @'
DO $$ BEGIN
IF (SELECT array_agg(flow_uuid ORDER BY flow_uuid) FROM automation_flows) <> ARRAY['other-kind-keep','process-keep','unaffected-keep']::varchar[] THEN RAISE EXCEPTION 'deleted wrong flows'; END IF;
IF (SELECT count(*) FROM automation_flow_versions) <> 3 OR (SELECT count(*) FROM automation_nodes) <> 3 OR (SELECT count(*) FROM automation_edges) <> 3 OR (SELECT count(*) FROM automation_flow_runs) <> 3 OR (SELECT count(*) FROM automation_flow_run_nodes) <> 3 THEN RAISE EXCEPTION 'associated data scope'; END IF;
IF (SELECT value FROM form_business_records WHERE id=1) <> 'must survive' THEN RAISE EXCEPTION 'business records deleted'; END IF;
END $$;
'@
    & (Join-Path $PSScriptRoot "cleanup-legacy-get-data.ps1") -Apply -Psql $Psql -OutputDirectory (Join-Path $output "repeat")
    $inventory = Get-Content (Join-Path $output "repeat/inventory.json") -Raw | ConvertFrom-Json
    if ($inventory.count -ne 0) { throw "Cleanup is not repeatable" }
    Write-Host "PASS: current/history scope, process exclusion, full backup, related deletion, business preservation and repeat execution."
} finally {
    $env:PGOPTIONS = $oldOptions
    Invoke-TestSql "DROP SCHEMA IF EXISTS $schema CASCADE;"
    $env:PGPASSWORD = $oldPassword
}
