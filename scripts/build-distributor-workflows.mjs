import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const gateway='https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/release-distributor';
const cred={httpHeaderAuth:{id:'billingHubDistributor',name:'Billing Hub - Release Distributor'}};
const fb={httpBearerAuth:{id:'6voUSGFRvzWmX5nr',name:'Facebook - ValorWell Page'}};
const li={httpBearerAuth:{id:'lT3xuNtEX1Vk7oR9',name:'LinkedIn - ValorWell Publisher'}};
const settings={executionOrder:'v1',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,executionTimeout:600};
const node=(name,type,parameters,extra={})=>({id:randomUUID(),name,type:`n8n-nodes-base.${type}`,typeVersion:type==='httpRequest'?4.2:type==='code'?2:type==='if'?2.2:type==='scheduleTrigger'?1.2:1,position:[0,0],parameters,...extra});
const manual=()=>node('Manual Trigger','manualTrigger',{});
const schedule=minutes=>node(`Every ${minutes} Minutes`,'scheduleTrigger',{rule:{interval:[{field:'minutes',minutesInterval:minutes}]}});
const call=(name,body)=>node(name,'httpRequest',{method:'POST',url:gateway,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:body,options:{timeout:240000}},{credentials:cred,retryOnFail:false});
const code=(name,jsCode)=>node(name,'code',{jsCode});
function flow(id,name,nodes,edges){const connections={};for(const [a,b,index=0] of edges){connections[a]??={main:[]};connections[a].main[index]??=[];connections[a].main[index].push({node:b,type:'main',index:0});}nodes.forEach((n,i)=>n.position=[i*240,(i%2)*100]);return {id,name,active:false,nodes,connections,settings};}
const monitor=flow('ytReleaseMonitor002','YouTube Release Monitor - Billing Hub',[manual(),schedule(5),call('Verify Channel Releases',JSON.stringify({action:'monitor'}))],[['Manual Trigger','Verify Channel Releases'],['Every 5 Minutes','Verify Channel Releases']]);
const reconcile=flow('ytDeliveryRecovery002','Delivery Reconciliation - Billing Hub',[manual(),schedule(5),call('Recover and Resolve',JSON.stringify({action:'recover'}))],[['Manual Trigger','Recover and Resolve'],['Every 5 Minutes','Recover and Resolve']]);
const options={timeout:30000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}};
const platformNode=(name,parameters,credentials)=>node(name,'httpRequest',{authentication:'genericCredentialType',genericAuthType:'httpBearerAuth',options,...parameters},{credentials,retryOnFail:false,onError:'continueRegularOutput'});
const branch=(name,expression)=>node(name,'if',{conditions:{options:{caseSensitive:true,typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:expression,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}});
const job="$('Claim Job').first().json.job";
const dispatch=flow('ytSocialDispatcher002','Social Delivery Dispatcher - Billing Hub',[
  manual(),schedule(1),call('Claim Job',"={{ {action:'claim',worker_id:'n8n-'+$execution.id} }}"),
  code('Require Job',"const job=$json.job; return job?[{json:job}]:[];"),
  branch('Instagram?',"={{ $json.platform === 'instagram' }}"),
  code('Instagram Requires Setup',"return [{json:{outcome:'BLOCKED_AUTH',error_category:'platform_auth'}}];"),
  call('Fence Publishing Request',`={{ {action:'begin',delivery_id:${job}.id,lease_token:${job}.lease_token} }}`),
  code('Require Send Permission',`if(!$json.allowed) return []; return [{json:${job}}];`),
  branch('Facebook?',"={{ $json.platform === 'facebook' }}"),
  platformNode('Publish Facebook Link',{method:'POST',url:"={{ 'https://graph.facebook.com/v25.0/'+$json.external_account_id+'/feed' }}",sendBody:true,contentType:'form-urlencoded',bodyParameters:{parameters:[{name:'message',value:'={{ $json.description_snapshot }}'},{name:'link',value:'={{ $json.video_url }}'},{name:'published',value:'true'}]}},fb),
  platformNode('Publish LinkedIn Link',{method:'POST',url:'https://api.linkedin.com/rest/posts',sendHeaders:true,headerParameters:{parameters:[{name:'LinkedIn-Version',value:'202608'},{name:'X-Restli-Protocol-Version',value:'2.0.0'}]},sendBody:true,specifyBody:'json',jsonBody:"={{ {author:$json.external_account_id,commentary:$json.description_snapshot,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},content:{article:{source:$json.video_url,title:$json.title}},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false} }}"},li),
  code('Classify Result',`const j=${job}; const r=$json; const s=Number(r.statusCode||0); const b=r.body||{}; const id=j.platform==='facebook'?b.id:r.headers?.['x-restli-id']; let outcome='NEEDS_REVIEW',error_category='platform_ambiguous'; if(s>=200&&s<300&&id&&!b.error){outcome='PUBLISHED';error_category=null;} else if(s===401||s===403||b.error?.code===190){outcome='BLOCKED_AUTH';error_category='platform_auth';} else if(s===429){outcome='RETRY_WAIT';error_category='platform_rate_limit';} else if(s>=400&&s<500){outcome='FAILED';error_category='platform_rejected';} const external_post_url=id?(j.platform==='facebook'?'https://www.facebook.com/'+id:'https://www.linkedin.com/feed/update/'+id+'/'):null; return [{json:{outcome,http_status:s||null,external_post_id:id||null,external_post_url,error_category}}];`),
  call('Persist Result',`={{ {action:'finish',delivery_id:${job}.id,lease_token:${job}.lease_token,outcome:$json.outcome,http_status:$json.http_status,external_post_id:$json.external_post_id,external_post_url:$json.external_post_url,error_category:$json.error_category} }}`),
], [['Manual Trigger','Claim Job'],['Every 1 Minutes','Claim Job'],['Claim Job','Require Job'],['Require Job','Instagram?'],['Instagram?','Instagram Requires Setup',0],['Instagram Requires Setup','Persist Result'],['Instagram?','Fence Publishing Request',1],['Fence Publishing Request','Require Send Permission'],['Require Send Permission','Facebook?'],['Facebook?','Publish Facebook Link',0],['Facebook?','Publish LinkedIn Link',1],['Publish Facebook Link','Classify Result'],['Publish LinkedIn Link','Classify Result'],['Classify Result','Persist Result']]);
const preflight=flow('ytDistributorPreflight002','Release Distributor - Read Only Preflight',[
  manual(),
  platformNode('Inspect Facebook Account',{method:'GET',url:'https://graph.facebook.com/v25.0/119382491255956?fields=id,name,instagram_business_account'},fb),
  code('Sanitize Facebook',"const r=$json;return [{json:{platform:'facebook',http_status:r.statusCode,id:r.body?.id,name:r.body?.name,instagram_account_id:r.body?.instagram_business_account?.id,error_code:r.body?.error?.code}}];"),
  platformNode('Inspect LinkedIn Organization',{method:'GET',url:'https://api.linkedin.com/rest/organizations/98694960',sendHeaders:true,headerParameters:{parameters:[{name:'LinkedIn-Version',value:'202608'},{name:'X-Restli-Protocol-Version',value:'2.0.0'}]}},li),
  code('Sanitize LinkedIn',"const r=$json;return [{json:{platform:'linkedin',http_status:r.statusCode,id:r.body?.id,error_code:r.body?.serviceErrorCode}}];"),
  call('Inspect Gateway',JSON.stringify({action:'status'})),
  call('Inspect Original MP4',JSON.stringify({action:'media_preflight'})),
],[['Manual Trigger','Inspect Facebook Account'],['Inspect Facebook Account','Sanitize Facebook'],['Manual Trigger','Inspect LinkedIn Organization'],['Inspect LinkedIn Organization','Sanitize LinkedIn'],['Manual Trigger','Inspect Gateway'],['Manual Trigger','Inspect Original MP4']]);
// Instagram uses Meta's Facebook Login route and the Page credential; the connected
// Instagram professional account and publishing permissions must pass preflight first.
dispatch.nodes=dispatch.nodes.filter(n=>n.name!=='Instagram Requires Setup');
delete dispatch.connections['Instagram Requires Setup'];
dispatch.connections['Instagram?'].main[0]=[{node:'Existing Reel Container?',type:'main',index:0}];
const igNodes=[
  branch('Existing Reel Container?',"={{ !!$json.external_container_id }}"),
  call('Prepare Private MP4',`={{ {action:'media',delivery_id:${job}.id,lease_token:${job}.lease_token} }}`),
  branch('MP4 Available?',"={{ $json.ok === true }}"),
  code('Missing MP4',"return [{json:{outcome:'NEEDS_MEDIA',error_category:'media_unavailable'}}];"),
  platformNode('Create Reel Container',{method:'POST',url:`={{ 'https://graph.facebook.com/v25.0/'+${job}.external_account_id+'/media' }}`,sendBody:true,contentType:'form-urlencoded',bodyParameters:{parameters:[{name:'media_type',value:'REELS'},{name:'video_url',value:'={{ $json.media_url }}'},{name:'caption',value:`={{ ${job}.description_snapshot }}`},{name:'share_to_feed',value:'true'}]}},fb),
  code('Require Container ID',"const id=$json.body?.id;return [{json:{container_id:id||null,ok:!!id}}];"),
  branch('Container Created?',"={{ $json.ok === true }}"),
  call('Save Reel Container',`={{ {action:'container',delivery_id:${job}.id,lease_token:${job}.lease_token,container_id:$json.container_id} }}`),
  code('Require Saved Container',"if(!$json.recorded)throw new Error('container_checkpoint_failed');return [{json:{}}];"),
  node('Wait for Reel Processing','wait',{amount:15,unit:'seconds'},{typeVersion:1.1,webhookId:randomUUID()}),
  platformNode('Check Reel Status',{method:'GET',url:`={{ 'https://graph.facebook.com/v25.0/'+(${job}.external_container_id || $('Require Container ID').first().json.container_id)+'?fields=status_code' }}`},fb),
  code('Evaluate Reel Processing',"const status=$json.body?.status_code;return [{json:{ready:status==='FINISHED',again:status==='IN_PROGRESS'&&$runIndex<35}}];"),
  branch('Reel Ready?',"={{ $json.ready === true }}"),
  branch('Keep Polling?',"={{ $json.again === true }}"),
  code('Reel Needs Review',"return [{json:{outcome:'NEEDS_REVIEW',error_category:'platform_ambiguous'}}];"),
  call('Fence Reel Publish',`={{ {action:'begin',delivery_id:${job}.id,lease_token:${job}.lease_token} }}`),
  code('Require Reel Permission',"if(!$json.allowed)return [];return [{json:{}}];"),
  platformNode('Publish Instagram Reel',{method:'POST',url:`={{ 'https://graph.facebook.com/v25.0/'+${job}.external_account_id+'/media_publish' }}`,sendBody:true,contentType:'form-urlencoded',bodyParameters:{parameters:[{name:'creation_id',value:`={{ ${job}.external_container_id || $('Require Container ID').first().json.container_id }}`}]}},fb),
  code('Inspect Reel Publication',"const r=$json;return [{json:{id:r.body?.id||null,ok:!!r.body?.id&&r.statusCode>=200&&r.statusCode<300}}];"),
  branch('Reel Published?',"={{ $json.ok === true }}"),
  platformNode('Read Reel Permalink',{method:'GET',url:"={{ 'https://graph.facebook.com/v25.0/'+$json.id+'?fields=id,permalink,media_type' }}"},fb),
  code('Confirm Reel Publication',"const r=$json;const id=$('Inspect Reel Publication').first().json.id;return [{json:{outcome:r.statusCode===200&&r.body?.id===id&&r.body?.permalink?'PUBLISHED':'NEEDS_REVIEW',external_post_id:id,external_post_url:r.body?.permalink||null,http_status:r.statusCode||null,error_category:r.statusCode===200?null:'platform_ambiguous'}}];"),
];
dispatch.nodes.push(...igNodes);
const igEdges=[['Existing Reel Container?','Wait for Reel Processing',0],['Existing Reel Container?','Prepare Private MP4',1],['Prepare Private MP4','MP4 Available?'],['MP4 Available?','Create Reel Container',0],['MP4 Available?','Missing MP4',1],['Missing MP4','Persist Result'],['Create Reel Container','Require Container ID'],['Require Container ID','Container Created?'],['Container Created?','Save Reel Container',0],['Container Created?','Reel Needs Review',1],['Save Reel Container','Require Saved Container'],['Require Saved Container','Wait for Reel Processing'],['Wait for Reel Processing','Check Reel Status'],['Check Reel Status','Evaluate Reel Processing'],['Evaluate Reel Processing','Reel Ready?'],['Reel Ready?','Fence Reel Publish',0],['Reel Ready?','Keep Polling?',1],['Keep Polling?','Wait for Reel Processing',0],['Keep Polling?','Reel Needs Review',1],['Reel Needs Review','Persist Result'],['Fence Reel Publish','Require Reel Permission'],['Require Reel Permission','Publish Instagram Reel'],['Publish Instagram Reel','Inspect Reel Publication'],['Inspect Reel Publication','Reel Published?'],['Reel Published?','Read Reel Permalink',0],['Reel Published?','Reel Needs Review',1],['Read Reel Permalink','Confirm Reel Publication'],['Confirm Reel Publication','Persist Result']];
for(const [a,b,index=0] of igEdges){dispatch.connections[a]??={main:[]};dispatch.connections[a].main[index]??=[];dispatch.connections[a].main[index].push({node:b,type:'main',index:0});}
dispatch.nodes.forEach((n,i)=>n.position=[(i%8)*260,Math.floor(i/8)*220]);
// LinkedIn article previews accept uploaded image URNs. Image setup failure must not
// invent a successful post: stop and let the durable recovery path surface it.
const imageNodes=[
  platformNode('Initialize LinkedIn Image',{method:'POST',url:'https://api.linkedin.com/rest/images?action=initializeUpload',sendHeaders:true,headerParameters:{parameters:[{name:'LinkedIn-Version',value:'202608'},{name:'X-Restli-Protocol-Version',value:'2.0.0'}]},sendBody:true,specifyBody:'json',jsonBody:`={{ {initializeUploadRequest:{owner:${job}.external_account_id}} }}`},li),
  code('Validate LinkedIn Image Upload',"const v=$json.body?.value;if(!v?.image||!v?.uploadUrl)throw new Error('linkedin_image_initialization_failed');const authority=String(v.uploadUrl).split('/')[2]||'';if(!v.uploadUrl.startsWith('https://')||!(authority==='linkedin.com'||/^[a-z0-9.-]+\\.linkedin\\.com$/.test(authority))||v.uploadUrl.includes(String.fromCharCode(92)))throw new Error('untrusted_image_upload_url');return [{json:{image:v.image,uploadUrl:v.uploadUrl}}];"),
  node('Download YouTube Thumbnail','httpRequest',{method:'GET',url:`={{ 'https://i.ytimg.com/vi/'+${job}.youtube_video_id+'/hqdefault.jpg' }}`,options:{timeout:20000,response:{response:{responseFormat:'file',outputPropertyName:'data'}}}}),
  platformNode('Upload LinkedIn Image',{method:'PUT',url:"={{ $('Validate LinkedIn Image Upload').first().json.uploadUrl }}",sendBody:true,contentType:'binaryData',inputDataFieldName:'data',options:{timeout:30000,response:{response:{fullResponse:true,neverError:true,responseFormat:'text'}}}},li),
  code('Restore LinkedIn Job',`if($json.statusCode<200||$json.statusCode>=300)throw new Error('linkedin_image_upload_failed');return [{json:{...${job},linkedin_image_urn:$('Validate LinkedIn Image Upload').first().json.image}}];`),
];
dispatch.nodes.push(...imageNodes);
dispatch.connections['Facebook?'].main[1]=[{node:'Initialize LinkedIn Image',type:'main',index:0}];
for(const [a,b] of [['Initialize LinkedIn Image','Validate LinkedIn Image Upload'],['Validate LinkedIn Image Upload','Download YouTube Thumbnail'],['Download YouTube Thumbnail','Upload LinkedIn Image'],['Upload LinkedIn Image','Restore LinkedIn Job'],['Restore LinkedIn Job','Publish LinkedIn Link']])dispatch.connections[a]={main:[[{node:b,type:'main',index:0}]]};
dispatch.nodes.find(n=>n.name==='Publish LinkedIn Link').parameters.jsonBody="={{ {author:$json.external_account_id,commentary:$json.description_snapshot,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},content:{article:{source:$json.video_url,title:$json.title,thumbnail:$json.linkedin_image_urn}},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false} }}";
// Fence only the public post itself. Thumbnail/container preparation is recoverable
// before that boundary and must report credential failures without retrying publication.
const setupFailure="const s=Number($json.statusCode||0),e=$json.body?.error?.code;const auth=s===401||s===403||[190,10,200].includes(e);const retry=s===0||s===429||s>=500;return [{json:{outcome:auth?'BLOCKED_AUTH':retry?'RETRY_WAIT':'FAILED',http_status:s||null,error_category:auth?'platform_auth':retry?'platform_rate_limit':'platform_rejected'}}];";
dispatch.nodes.push(
  branch('LinkedIn Image Initialized?',"={{ $json.statusCode >= 200 && $json.statusCode < 300 && !!$json.body?.value?.image && !!$json.body?.value?.uploadUrl }}"),
  branch('LinkedIn Image Uploaded?',"={{ $json.statusCode >= 200 && $json.statusCode < 300 }}"),
  code('Classify Setup Failure',setupFailure),
  call('Fence LinkedIn Post',`={{ {action:'begin',delivery_id:${job}.id,lease_token:${job}.lease_token} }}`),
  code('Require LinkedIn Permission',"if(!$json.allowed)return [];return [{json:$('Restore LinkedIn Job').first().json}];"),
  code('Reel Container Failure',"const r=$('Create Reel Container').first().json;const s=Number(r.statusCode||0),e=r.body?.error?.code;const auth=s===401||s===403||[190,10,200].includes(e);return [{json:{outcome:auth?'BLOCKED_AUTH':s===429?'RETRY_WAIT':'NEEDS_REVIEW',http_status:s||null,error_category:auth?'platform_auth':s===429?'platform_rate_limit':'platform_ambiguous'}}];"),
  code('Reel Publish Failure',"const r=$('Publish Instagram Reel').first().json;const s=Number(r.statusCode||0),e=r.body?.error?.code;const auth=s===401||s===403||[190,10,200].includes(e);return [{json:{outcome:auth?'BLOCKED_AUTH':s===429?'RETRY_WAIT':'NEEDS_REVIEW',http_status:s||null,error_category:auth?'platform_auth':s===429?'platform_rate_limit':'platform_ambiguous'}}];"),
);
const setEdge=(from,to,index=0)=>{dispatch.connections[from]??={main:[]};dispatch.connections[from].main[index]=[{node:to,type:'main',index:0}];};
setEdge('Instagram?','Facebook?',1);
setEdge('Facebook?','Fence Publishing Request',0);
setEdge('Require Send Permission','Publish Facebook Link');
setEdge('Initialize LinkedIn Image','LinkedIn Image Initialized?');
setEdge('LinkedIn Image Initialized?','Validate LinkedIn Image Upload',0);setEdge('LinkedIn Image Initialized?','Classify Setup Failure',1);
setEdge('Upload LinkedIn Image','LinkedIn Image Uploaded?');
setEdge('LinkedIn Image Uploaded?','Restore LinkedIn Job',0);setEdge('LinkedIn Image Uploaded?','Classify Setup Failure',1);
setEdge('Restore LinkedIn Job','Fence LinkedIn Post');setEdge('Fence LinkedIn Post','Require LinkedIn Permission');setEdge('Require LinkedIn Permission','Publish LinkedIn Link');
setEdge('Classify Setup Failure','Persist Result');
setEdge('Container Created?','Reel Container Failure',1);setEdge('Reel Container Failure','Persist Result');
setEdge('Reel Published?','Reel Publish Failure',1);setEdge('Reel Publish Failure','Persist Result');
dispatch.nodes.forEach((n,i)=>n.position=[(i%8)*260,Math.floor(i/8)*220]);
const reviewNodes=[
  code('Review Known Posts',"return ($json.review||[]).map(r=>({json:r}));"),
  branch('Review LinkedIn?',"={{ $json.platform === 'linkedin' }}"),
  platformNode('Read Existing LinkedIn Post',{method:'GET',url:"={{ 'https://api.linkedin.com/rest/posts/'+encodeURIComponent($json.external_post_id) }}",sendHeaders:true,headerParameters:{parameters:[{name:'LinkedIn-Version',value:'202608'},{name:'X-Restli-Protocol-Version',value:'2.0.0'}]}},li),
  platformNode('Read Existing Meta Post',{method:'GET',url:"={{ 'https://graph.facebook.com/v25.0/'+$json.external_post_id+'?fields=id,'+($json.platform==='instagram'?'permalink':'permalink_url,is_published') }}"},fb),
  code('Verify Existing Post',"return $input.all().flatMap((item,index)=>{const r=item.json;const d=$('Review Known Posts').itemMatching(index).json;const b=r.body||{};const ok=r.statusCode===200&&b.id===d.external_post_id&&(d.platform==='linkedin'?b.lifecycleState==='PUBLISHED':d.platform==='facebook'?b.is_published===true:!!b.permalink);if(!ok)return [];return [{json:{action:'confirm_existing',delivery_id:d.id,external_post_id:d.external_post_id,external_post_url:b.permalink||b.permalink_url||('https://www.linkedin.com/feed/update/'+d.external_post_id+'/')},pairedItem:{item:index}}];});"),
  call('Save Reconciled Publication',"={{ $json }}"),
];
reconcile.nodes.push(...reviewNodes);
for(const [a,b,index=0] of [['Recover and Resolve','Review Known Posts'],['Review Known Posts','Review LinkedIn?'],['Review LinkedIn?','Read Existing LinkedIn Post',0],['Review LinkedIn?','Read Existing Meta Post',1],['Read Existing LinkedIn Post','Verify Existing Post'],['Read Existing Meta Post','Verify Existing Post'],['Verify Existing Post','Save Reconciled Publication']]){reconcile.connections[a]??={main:[]};reconcile.connections[a].main[index]??=[];reconcile.connections[a].main[index].push({node:b,type:'main',index:0});}
reconcile.nodes.forEach((n,i)=>n.position=[i*240,(i%2)*100]);
for(const [wf,path,target] of [[monitor,'valorwell-youtube-release-v2','Verify Channel Releases'],[dispatch,'valorwell-social-dispatch-v2','Claim Job']]){
  const hook=node('Authenticated Wake Up','webhook',{httpMethod:'POST',path,authentication:'headerAuth',responseMode:'onReceived',options:{}},{typeVersion:2,webhookId:randomUUID(),credentials:cred});
  wf.nodes.push(hook);wf.connections[hook.name]={main:[[{node:target,type:'main',index:0}]]};
}
mkdirSync(new URL('../n8n/',import.meta.url),{recursive:true});
// Keep nested object braces separate from n8n's expression-closing delimiter.
function normalizeExpressions(value){
  if(typeof value==='string'&&value.startsWith('={{')&&value.endsWith('}}')){
    let inner=value.slice(3,-2);while(inner.includes('}}'))inner=inner.replaceAll('}}','} }');return '={{'+inner+'}}';
  }
  if(Array.isArray(value))return value.map(normalizeExpressions);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizeExpressions(v)]));
  return value;
}
for(const wf of [monitor,dispatch,reconcile,preflight])writeFileSync(new URL(`../n8n/${wf.id}.json`,import.meta.url),JSON.stringify(normalizeExpressions(wf),null,2));
console.log('Built three inactive production workflows and a read-only preflight workflow.');
