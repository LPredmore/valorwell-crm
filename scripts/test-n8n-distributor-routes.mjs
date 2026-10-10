// Execute the real n8n graph against a loopback-only fake provider/gateway. No secrets,
// production database, YouTube reads or social publishing requests are used.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {strict as assert} from 'node:assert';
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:20*1024*1024});
const server=`const http=require('http');let scenario='facebook',sent=0,checks=0,finishes=[],containerSaved=false,begun=false;
const ids={facebook:'page_123',linkedin:'urn:li:share:123',instagram:'98765'};
http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;let body={};try{body=JSON.parse(raw)}catch{};const path=req.url.split('?')[0];
const out=(value,status=200,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(value));};
if(req.headers.authorization||req.headers['x-distribution-token'])return out({error:'real_credentials_must_not_be_sent'},500);
if(path==='/reset'){scenario=body.scenario;sent=0;checks=0;finishes=[];containerSaved=false;begun=false;return out({ok:true});}
if(path==='/summary')return out({scenario,sent,checks,finishes,containerSaved,begun});
if(path==='/gateway'){
if(body.action==='claim')return out({job:{id:'11111111-1111-4111-8111-111111111111',lease_token:'22222222-2222-4222-8222-222222222222',platform:scenario.startsWith('facebook')?'facebook':scenario,external_account_id:scenario==='linkedin'?'urn:li:organization:98694960':'119382491255956',description_snapshot:'Platform-specific test copy',youtube_video_id:'fixture0001',video_url:'https://www.youtube.com/watch?v=fixture0001',title:'Test fixture',drive_file_id:'private-original'}});
if(body.action==='media')return out({ok:true,media_url:'http://127.0.0.1:18881/mp4'});
if(body.action==='container'){containerSaved=body.container_id==='container123';return out({recorded:containerSaved});}
if(body.action==='begin'){begun=true;return out({allowed:true});}
if(body.action==='finish'){finishes.push(body);return out({recorded:true});}
}
if(path==='/linkedin/images')return out({value:{image:'urn:li:image:fixture',uploadUrl:'https://api.linkedin.com/fixture-upload'}});
if(path==='/thumbnail'){res.writeHead(200,{'content-type':'image/jpeg'});return res.end(Buffer.from([255,216,255,217]));}
if(path==='/linkedin/upload'){res.writeHead(201);return res.end('');}
if(path==='/instagram/container')return out({id:'container123'});
if(path==='/instagram/status'){checks++;return out({status_code:checks===1?'IN_PROGRESS':'FINISHED'});}
if(path==='/instagram/permalink')return out({id:ids.instagram,permalink:'https://www.instagram.com/reel/fixture/',media_type:'VIDEO'});
if(path==='/facebook/publish'||path==='/linkedin/publish'||path==='/instagram/publish'){
if(!begun)return out({error:'unfenced_publish'},500);if(path==='/instagram/publish'&&(!containerSaved||checks<2))return out({error:'premature_reel_publish'},500);
sent++;
if(scenario==='facebook429')return out({error:{code:4}},429);
if(scenario==='facebook500')return out({error:'uncertain'},500);
if(path==='/linkedin/publish')return out({},201,{'x-restli-id':ids.linkedin});
return out({id:ids[scenario]},200);}
return out({error:'unexpected_route',path},404);
}).listen(18881,'127.0.0.1');`;
const serverPath='/tmp/distributor-mock-server.cjs';
execFileSync('docker',['exec','-i','n8n','sh','-c',`cat > ${serverPath}`],{input:server});
docker(['exec','-d','n8n','node',serverPath]);
const request=(path,body)=>docker(['exec','n8n','node','-e',`fetch('http://127.0.0.1:18881/${path}',${body?`{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}`:'{}'}).then(r=>r.text()).then(console.log)`]);
const workflow=JSON.parse(readFileSync(new URL('../n8n/ytSocialDispatcher002.json',import.meta.url),'utf8'));
workflow.id='ytDistributorMockTest';workflow.name='TEST ONLY - Distributor Mock Routes';workflow.active=false;
const removed=new Set(workflow.nodes.filter(n=>n.type.endsWith('scheduleTrigger')||n.type.endsWith('.webhook')).map(n=>n.name));
workflow.nodes=workflow.nodes.filter(n=>!removed.has(n.name));for(const name of removed)delete workflow.connections[name];
const paths={'Publish Facebook Link':'facebook/publish','Initialize LinkedIn Image':'linkedin/images','Download YouTube Thumbnail':'thumbnail','Upload LinkedIn Image':'linkedin/upload','Publish LinkedIn Link':'linkedin/publish','Create Reel Container':'instagram/container','Check Reel Status':'instagram/status','Publish Instagram Reel':'instagram/publish','Read Reel Permalink':'instagram/permalink'};
for(const n of workflow.nodes){
  delete n.credentials;
  if(n.type.endsWith('httpRequest')){delete n.parameters.authentication;delete n.parameters.genericAuthType;n.parameters.url='http://127.0.0.1:18881/'+(paths[n.name]??'gateway');}
  if(n.type.endsWith('.wait'))n.parameters.amount=1;
}
const temp='/tmp/distributor-mock-workflow.json';
execFileSync('docker',['exec','-i','n8n','sh','-c',`cat > ${temp}`],{input:JSON.stringify(workflow)});
docker(['exec','n8n','n8n','import:workflow',`--input=${temp}`,'--projectId=kgNZ0JtnkNjiRbgE']);
const results=[];
try{
  for(const scenario of ['facebook','linkedin','instagram','facebook429','facebook500']){
    request('reset',{scenario});
    let raw;
    try{raw=docker(['exec','-e','N8N_RUNNERS_BROKER_PORT=5681','-e','N8N_DIAGNOSTICS_ENABLED=false','n8n','n8n','execute','--id=ytDistributorMockTest','--rawOutput']);}
    catch(error){throw new Error('Mock n8n execution failed: '+String(error.stdout??'').slice(-3000));}
    const parsed=JSON.parse(raw.slice(raw.indexOf('{\n  "data":')));
    const summary=JSON.parse(request('summary'));
    if(parsed.status!=='success')throw new Error(JSON.stringify({scenario,error:parsed.data.resultData.error,summary}));
    assert.equal(summary.sent,1);assert.equal(summary.finishes.length,1);
    const expected=scenario==='facebook429'?'RETRY_WAIT':scenario==='facebook500'?'NEEDS_REVIEW':'PUBLISHED';
    assert.equal(summary.finishes[0].outcome,expected);
    if(scenario==='instagram'){assert.equal(summary.containerSaved,true);assert.equal(summary.checks,2);}
    results.push({scenario,status:'PASS',send_count:summary.sent,outcome:expected});
    console.log(JSON.stringify(results.at(-1)));
  }
}finally{
  // Stop only the exact temporary helper process created by this test.
  docker(['exec','n8n','node','-e',`const fs=require('fs');for(const id of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const a=fs.readFileSync('/proc/'+id+'/cmdline','utf8').split('\\0');if(a[0]==='node'&&a[1]==='${serverPath}')process.kill(Number(id));}catch{}}`]);
}
mkdirSync(new URL('../docs/distributor-evidence/',import.meta.url),{recursive:true});
writeFileSync(new URL('../docs/distributor-evidence/n8n-mock-routes.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),external_public_posts:0,results},null,2));
