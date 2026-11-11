// Ephemeral integration-test license. Never points at an installed customer's license.
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = process.argv[2];
if (!directory) throw new Error('test fixture directory required');
mkdirSync(directory, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const exp = Math.floor(Date.now() / 1000) + 3600;
const employee = id => ({ id, title: id, expiresAt: exp, templateVersion: 'test', skills: [], systemPrompt: 'Test', allowedTools: id === 'employee-a' ? ['diagnostic_echo', 'list_apps', 'create_app', 'update_app', 'delete_app', 'create_navigation_group', 'delete_navigation_group', 'create_form', 'delete_form', 'save_form_schema', 'yaya_apply_design_patch', 'yaya_get_form_schema', 'create_detail_form', 'create_automation_draft', 'delete_automation'] : ['diagnostic_echo'], applicationIds: [] });
const claims = { licenseId: 'agent-v2-integration-test', subject: 'isolated test', deploymentType: 'local', modules: ['platform'], exp, aiEmployees: [employee('employee-a'), employee('employee-b')], iss: 'yaya-operation-center', aud: 'yaya-low-code' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const content = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`;
const license = `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
writeFileSync(join(directory, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
writeFileSync(join(directory, 'license.json'), JSON.stringify({ licenseCenterUrl: 'http://127.0.0.1:1', license, activatedAt: new Date().toISOString() }));
writeFileSync(join(directory, 'installed.json'), JSON.stringify(['employee-a', 'employee-b']));
writeFileSync(join(directory, 'packages.json'), '{}');
