// Read an existing enabled default BYOM route; keep decrypted credentials in child environment only.
// No application data is modified. The Rust test creates and removes its own schema.
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../..',import.meta.url));
const values=Object.fromEntries(readFileSync(new URL('../../deploy/.env',import.meta.url),'utf8').split(/\r?\n/).filter(s=>/^[A-Z_]+=/.test(s)).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^["']|["']$/g,'')];}));
const url=new URL(process.env.AGENT_V2_TEST_DATABASE_URL ?? `postgres://${encodeURIComponent(values.POSTGRES_USER)}:${encodeURIComponent(values.POSTGRES_PASSWORD)}@127.0.0.1:5432/${values.POSTGRES_DB}`);
const psql=process.env.PSQL_PATH ?? 'E:/Soft/PostgreSQL/18/bin/psql.exe';
const result=execFileSync(psql,['-h',url.hostname,'-p',url.port||'5432','-U',decodeURIComponent(url.username),'-d',url.pathname.slice(1),'-Atc',"SELECT row_to_json(x) FROM (SELECT id,api_base_url,encrypted_api_key,default_chat_model FROM byom_model_routes WHERE enabled=true AND is_default=true ORDER BY id LIMIT 1) x"],{encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)},stdio:['ignore','pipe','pipe']}).trim();
if (!result) throw new Error('No enabled default BYOM route; live test unavailable');
const route=JSON.parse(result);
let encryption=process.env.YAYA_BYOM_ENCRYPTION_KEY;
if (!encryption && process.env.AGENT_V2_USE_DEVELOPMENT_KEY==='1') {
  const script=readFileSync(new URL('../../scripts/start-dev.ps1',import.meta.url),'utf8');
  encryption=script.match(/\$env:YAYA_BYOM_ENCRYPTION_KEY = "([^"]+)"/)?.[1];
}
if (!encryption) throw new Error('Existing BYOM encryption key required; no key rotation is performed');
const [version,nonce,encoded]=route.encrypted_api_key.split(':');if(version!=='v1')throw new Error('Unknown key format');
const encrypted=Buffer.from(encoded,'base64');const cipher=createDecipheriv('aes-256-gcm',Buffer.from(encryption,'base64'),Buffer.from(nonce,'base64'));
cipher.setAuthTag(encrypted.subarray(-16));
const key=Buffer.concat([cipher.update(encrypted.subarray(0,-16)),cipher.final()]).toString('utf8');
const context={employee_id:'isolated-live-contract-test',system_prompt:'For this diagnostic test, call diagnostic_echo once with text hello, then answer with the returned text.',allowed_tools:['diagnostic_echo'],model:{id:route.id,api_base_url:route.api_base_url,api_key:key,chat_model:route.default_chat_model}};
let replayCheckpoint;
if (process.env.AGENT_V2_LIVE_REPLAY_RUN) {
 const run=process.env.AGENT_V2_LIVE_REPLAY_RUN;
 if(!/^[0-9a-f-]{36}$/i.test(run))throw new Error('Invalid replay run ID');
 const raw=execFileSync(psql,['-h',url.hostname,'-p',url.port||'5432','-U',decodeURIComponent(url.username),'-d',url.pathname.slice(1),'-Atc',`SELECT jsonb_build_object('checkpoint',checkpoint,'snapshot',context_snapshot) FROM agent_v2_runs WHERE id='${run}'::uuid`],{encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)},stdio:['ignore','pipe','pipe']}).trim();
 if(!raw)throw new Error('Replay run not found');
 const saved=JSON.parse(raw);
 if(saved.snapshot.route_id!==route.id || saved.snapshot.api_base_url!==route.api_base_url)throw new Error('Replay requires the original model route');
 context.system_prompt=saved.snapshot.system_prompt;
 context.allowed_tools=saved.snapshot.allowed_tools;
 replayCheckpoint=JSON.stringify(saved.checkpoint);
}
const test=spawnSync('cargo',['test','--manifest-path','agent-v2/Cargo.toml','--locked','--offline','-p','yaya-agent-v2-worker','runtime::tests::rig_stream_tool_and_worker_recovery','--','--ignored','--nocapture'],{cwd:root,stdio:'inherit',env:{...process.env,AGENT_V2_TEST_DATABASE_URL:url.toString(),AGENT_V2_LIVE_CONTEXT:JSON.stringify(context),...(replayCheckpoint?{AGENT_V2_REPLAY_CHECKPOINT:replayCheckpoint}:{})}});
if(test.status!==0)process.exitCode=1;
