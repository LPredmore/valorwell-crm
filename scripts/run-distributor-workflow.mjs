import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
const id=process.argv[2];
const allowed=new Set(['ytDistributorPreflight002','ytReleaseMonitor002','ytDeliveryRecovery002','ytSocialDispatcher002']);
if(!allowed.has(id))throw new Error('Workflow is not in the non-public validation allowlist');
// Capture CLI output in memory; print only sanitized terminal-node results.
function execute(workflowId){try{return execFileSync('docker',['exec','-e','N8N_RUNNERS_BROKER_PORT=5681','-e','N8N_DIAGNOSTICS_ENABLED=false','n8n','n8n','execute',`--id=${workflowId}`,'--rawOutput'],{encoding:'utf8',maxBuffer:20*1024*1024});}catch{throw new Error('n8n execution failed; raw output suppressed to protect credentials');}}
if(id==='ytSocialDispatcher002'){
  const check=execute('ytDistributorPreflight002');
  const parsed=JSON.parse(check.slice(check.indexOf('{\n  "data":')));
  const config=parsed.data.resultData.runData?.['Inspect Gateway']?.[0]?.data?.main?.[0]?.[0]?.json;
  if(config?.publishing_enabled!==false||config?.test_delivery_id)throw new Error('Non-public validation requires publishing disabled and no approved test delivery');
}
const raw=execute(id);
const start=raw.indexOf('{\n  "data":');
if(start<0)throw new Error('No execution result returned');
const result=JSON.parse(raw.slice(start));
const data=result.data.resultData;
const names=['Sanitize Facebook','Sanitize LinkedIn','Inspect Gateway','Inspect Original MP4','Verify Channel Releases','Recover and Resolve','Claim Job','Persist Result'];
const summary={workflow:id,status:result.status,finished:result.finished,at:result.stoppedAt,results:{}};
for(const name of names){const runs=data.runData?.[name];if(runs)summary.results[name]=runs.map(r=>({status:r.executionStatus,items:r.data?.main?.flat().map(i=>name==='Inspect Gateway'?{publishing_enabled:i.json.publishing_enabled,baseline_completed_at:i.json.baseline_completed_at,sampled_delivery_count:i.json.deliveries?.length}:i.json)}));}
if(data.error)summary.error={name:data.error.name,node:data.error.node?.name,httpCode:data.error.httpCode};
mkdirSync(new URL('../docs/distributor-evidence/',import.meta.url),{recursive:true});
writeFileSync(new URL(`../docs/distributor-evidence/${id}.json`,import.meta.url),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
if(result.status!=='success')process.exitCode=1;
