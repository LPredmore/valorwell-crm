"""Actual signup hook and Realtime transport probes; no parity assertion."""
import json
import secrets
import uuid
from native_stack import DOCKER, run


def signup_probe(stack):
    email = 'signup-' + str(uuid.uuid4()) + '@example.invalid'
    code, session = stack.request('auth', '/signup', {'email': email, 'password': 'Synthetic-' + secrets.token_hex(24)})
    user = (session or {}).get('user') or {}
    user_id = user.get('id')
    profiles = 0
    if user_id and str(uuid.UUID(user_id)) == user_id:
        profiles = int(stack.sql("SELECT count(*) FROM public.profiles WHERE id='" + user_id + "';"))
    stack.report['native_signup_hook'] = dict(status='PASS' if code == 200 and session.get('access_token') and profiles == 1 else 'FAIL',
                                            http=code, profile_rows=profiles, scope='actual public GoTrue signup and captured application Auth hook; synthetic email only')
    stack.save()


def realtime_probe(stack, identity):
    # Fixed network target; Host selects the self-hosted synthetic Realtime tenant.
    script = r"""
const WebSocket=require('ws');let input='';
process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{
 const v=JSON.parse(input),topic='realtime:synthetic-'+v.id;
 const ws=new WebSocket('ws://realtime:4000/socket/websocket?apikey='+encodeURIComponent(v.token)+'&vsn=1.0.0',{headers:{Host:'realtime-dev.localhost'}});
 let done=false;const finish=(ok)=>{if(done)return;done=true;console.log(JSON.stringify({status:ok?'PASS':'FAIL',scope:'actual signed Realtime public broadcast; not application tenant authorization'}));ws.close();setTimeout(()=>process.exit(0),50);};
 const timer=setTimeout(()=>finish(false),10000);
 ws.on('open',()=>ws.send(JSON.stringify({topic,event:'phx_join',payload:{config:{broadcast:{ack:true,self:true},presence:{key:''},postgres_changes:[]},access_token:v.token},ref:'1'})));
 ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return finish(false)};
  if(m.event==='phx_reply'&&m.ref==='1'){if(m.payload.status!=='ok')return finish(false);ws.send(JSON.stringify({topic,event:'broadcast',payload:{type:'broadcast',event:'synthetic',payload:{marker:v.id}},ref:'2'}));}
  if(m.event==='broadcast'&&m.payload?.payload?.marker===v.id){clearTimeout(timer);finish(true);}
 });ws.on('error',()=>finish(false));
});"""
    try:
        value = run(DOCKER + ['exec', '-i', stack.containers['transport'], 'node', '-e', script],
                    json.dumps({'id': str(uuid.uuid4()), 'token': identity['token']}), timeout=20)
        stack.report['native_realtime_transport'] = json.loads(value)
    except Exception as error:
        stack.report['native_realtime_transport'] = dict(status='BLOCKED', reason=type(error).__name__)
    stack.save()
