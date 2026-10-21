// HTTP transport inside the owned internal network. No arbitrary host, proxy,
// redirect, provider, public listener, or external socket capability is exposed.
import http from 'node:http';
const targets = {auth:['auth',9999],rest:['rest',3000],storage:['storage',5000],realtime:['realtime',4000]};
let input='';
for await (const part of process.stdin) input+=part;
try {
  const item=JSON.parse(input), target=targets[item.service];
  if(!target || !item.path.startsWith('/') || item.path.startsWith('//') || item.path.includes('\\')) throw Error('Endpoint denied');
  const method=item.method??'GET';
  if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method)) throw Error('Method denied');
  const body=item.body ? Buffer.from(item.body,'base64') : undefined;
  const headers={...(item.headers??{})};
  if(body) headers['content-length']=body.length;
  const request=http.request({hostname:target[0],port:target[1],path:item.path,method,headers},response=>{
    const chunks=[];
    response.on('data',part=>chunks.push(part));
    response.on('end',()=>process.stdout.write(JSON.stringify({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('base64')})));
  });
  request.on('error',()=>{process.stderr.write('Owned service request failed');process.exitCode=2;});
  request.setTimeout(8000,()=>request.destroy());
  request.end(body);
} catch {
  process.stderr.write('Owned service input denied');process.exitCode=2;
}
