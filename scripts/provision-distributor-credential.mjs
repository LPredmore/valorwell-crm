// Creates a narrowly scoped n8n credential. Never prints or persists its plaintext on the host.
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const token=randomBytes(48).toString('base64url');
const credentials=[{id:'billingHubDistributor',name:'Billing Hub - Release Distributor',type:'httpHeaderAuth',data:{name:'x-distribution-token',value:token}}];
const path='/tmp/billinghub-distributor-credential.json';
try {
  execFileSync('docker',['exec','-i','n8n','sh','-c',`umask 077; cat > ${path}`],{input:JSON.stringify(credentials),stdio:['pipe','ignore','pipe']});
  execFileSync('docker',['exec','n8n','n8n','import:credentials',`--input=${path}`,'--projectId=kgNZ0JtnkNjiRbgE'],{stdio:['ignore','ignore','pipe']});
  writeFileSync(new URL('../distribution-worker-token.sha256',import.meta.url),createHash('sha256').update(token).digest('hex'));
  console.log('Scoped credential imported. Only its SHA-256 hash was written to the workspace.');
} finally { execFileSync('docker',['exec','n8n','rm','-f',path],{stdio:'ignore'}); }
