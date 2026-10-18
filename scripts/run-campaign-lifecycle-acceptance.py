"""Additional actual-SQL and signed-JWT checks inside the owned Zeffy harness."""
import sys,json,uuid,importlib,argparse
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--billing-repo',type=Path,required=True)
parser.add_argument('--clients-repo',type=Path,required=True)
parser.add_argument('--output-dir',type=Path)
parser.add_argument('--check-migration-sequence-only',action='store_true')
parser.add_argument('--baseline',action='store_true',help='Reproduce failures before the new corrective migration; never changes expected assertions')
args=parser.parse_args()
crm=Path(__file__).resolve().parents[1]
clients=args.clients_repo.resolve()
scripts=args.billing_repo.resolve()/'scripts'
if not (scripts/'run-zeffy-db-acceptance.py').is_file(): raise RuntimeError('Reviewed billing acceptance infrastructure missing')
sys.path.insert(0,str(scripts))
import zeffy_acceptance_5c as core
import zeffy_acceptance_5c_security as security
import zeffy_acceptance_5c_jwt as jwt
b=core.b
# All three repositories address one shared Supabase migration history. Reject
# newly authored version collisions before creating any disposable database.
versions={}
for repository in [crm,clients,args.billing_repo.resolve()]:
 for migration in (repository/'supabase/migrations').glob('*.sql'):
  version=migration.name[:14]
  if version.isdigit() and version>='20261018000000':
   content=migration.read_text(encoding='utf-8').replace('\r\n','\n')
   if version in versions and versions[version][1]!=content:
    raise RuntimeError(f'Migration version collision: {versions[version][0]} and {migration}')
   versions[version]=(migration,content)
print('PASS shared acceptance migration versions are unique',flush=True)
if args.check_migration_sequence_only: sys.exit(0)
original_bootstrap=security.bootstrap
ENROLL1='30000000-0000-4000-8000-000000000001'
ENROLL2='30000000-0000-4000-8000-000000000002'
ENROLL3='30000000-0000-4000-8000-000000000003'
lit=core.lit

def bootstrap(s,repo):
 m=original_bootstrap(s,repo)
 s.execute('''
create table public.crm_campaign_enrollments(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,campaign_id uuid,status text,current_step integer,paused_at timestamptz,pause_reason text,updated_at timestamptz,completed_at timestamptz,enrolled_at timestamptz,enrolled_by_profile_id uuid);
create table public.crm_campaign_steps(id uuid,campaign_id uuid,is_active boolean,step_order integer,delay_days integer,delay_hours integer,channel text);
create table public.crm_campaign_step_logs(enrollment_id uuid,step_id uuid,tenant_id uuid,client_id uuid,scheduled_for timestamptz,status text,skip_reason text,channel text,updated_at timestamptz);
create table public.crm_activity_events(id uuid default gen_random_uuid(),tenant_id uuid,client_id uuid,event_type text,old_value text,new_value text,metadata jsonb,created_by_profile_id uuid);
create table public.crm_idempotency_keys(key text primary key,operation text,actor_id uuid,tenant_id uuid,target_id uuid,status text,expires_at timestamptz,result_json jsonb,updated_at timestamptz default now());
'''+b.sql_file(m/'20260717171202_33c1c18e-b3cd-417a-b1d8-af7abe097eb5.sql')+b.sql_file(m/'20260719155541_repair_crm_manual_enrollment_rpc.sql')+b.sql_file(m/'20260719155555_harden_crm_campaign_rpc_grants.sql')+b.sql_file(m/'20261019000200_revoke_direct_crm_idempotency_helpers.sql'))
 for correction in ([] if args.baseline else sorted(m.glob('*campaign_lifecycle_authorization_and_idempotency.sql'))): s.execute(b.sql_file(correction))
 for enroll,tenant in [(ENROLL1,core.TENANT),(ENROLL2,core.TENANT),(ENROLL3,core.TENANT2)]:
  s.execute(f"insert into public.crm_campaign_enrollments(id,tenant_id,client_id,campaign_id,status) values({lit(enroll)},{lit(tenant)},gen_random_uuid(),gen_random_uuid(),'active');")
 def denied_readonly():
  for rpc in ['crm_pause_enrollment','crm_resume_enrollment','crm_cancel_enrollment','crm_mark_enrollment_responded','crm_restart_enrollment']:
   s.deny(f"select public.{rpc}({lit(ENROLL1)},'synthetic reason','readonly-key');",'permission',prefix=security.auth(core.READONLY))
  assert s.value(f'select status from public.crm_campaign_enrollments where id={lit(ENROLL1)}')=='active'
 s.check(7,'CRM readonly cannot invoke lifecycle write wrapper',denied_readonly)
 s.execute(f"update public.crm_campaign_enrollments set status='active';truncate public.crm_idempotency_keys,public.crm_activity_events;")
 def scoped_replay():
  first=s.value(f"select public.crm_pause_enrollment({lit(ENROLL1)},'synthetic reason','shared-key')",security.auth())
  assert first['ok'],first
  s.deny(f"select public.crm_pause_enrollment({lit(ENROLL3)},'synthetic reason','shared-key');",'idempotency',prefix=security.auth(core.BOB))
  assert s.value(f'select status from public.crm_campaign_enrollments where id={lit(ENROLL3)}')=='active'
 s.check(7,'CRM wrapper rejects cached idempotency result from another tenant actor and target',scoped_replay)
 def individual_scopes():
  s.deny(f"select public.crm_pause_enrollment({lit(ENROLL2)},'synthetic target scope','shared-key');",'idempotency',prefix=security.auth())
  s.deny(f"select public.crm_resume_enrollment({lit(ENROLL1)},'synthetic operation scope','shared-key');",'idempotency',prefix=security.auth())
  s.execute(f"update public.crm_user_capabilities set crm_role='crm_operator' where profile_id={lit(core.READONLY)};")
  try:s.deny(f"select public.crm_pause_enrollment({lit(ENROLL1)},'synthetic actor scope','shared-key');",'idempotency',prefix=security.auth(core.READONLY))
  finally:s.execute(f"update public.crm_user_capabilities set crm_role='crm_readonly' where profile_id={lit(core.READONLY)};")
 s.check(7,'idempotency independently rejects actor-only target-only and operation-only key reuse',individual_scopes)
 def unfinished():
  s.execute(f"insert into public.crm_idempotency_keys(key,operation,actor_id,tenant_id,target_id,status) values('unfinished','crm_resume_enrollment',{lit(core.ALICE)},{lit(core.TENANT)},{lit(ENROLL1)},'in_flight');")
  s.deny(f"select public.crm_resume_enrollment({lit(ENROLL1)},'synthetic unfinished key','unfinished');",'idempotency_request_in_progress',prefix=security.auth())
  assert s.value(f'select status from public.crm_campaign_enrollments where id={lit(ENROLL1)}')=='paused'
 s.check(7,'committed unfinished legacy key fails closed without changing enrollment state',unfinished)

 def race():
  s.execute("truncate public.crm_idempotency_keys,public.crm_activity_events;update public.crm_campaign_enrollments set status='active';")
  body=security.auth()+f"begin;select public.crm_pause_enrollment({lit(ENROLL2)},'synthetic concurrency','same-key');select pg_sleep(.4);select 'RESULT '||pg_backend_pid()::text;commit;"
  s.parallel([('lifecycle-worker-1',body),('lifecycle-worker-2',body)])
  assert s.value('select count(*) from public.crm_activity_events')==1,'duplicate audit events for one idempotent transition'
  assert s.value(f'select status from public.crm_campaign_enrollments where id={lit(ENROLL2)}')=='paused'
 s.check(7,'CRM simultaneous same-key lifecycle calls produce one transition audit',race)
 def legit():
  for role in ['crm_admin','crm_operator']:
   s.execute(f"update public.crm_user_capabilities set crm_role='{role}' where profile_id={lit(core.ALICE)};update public.crm_campaign_enrollments set status='active' where id={lit(ENROLL1)};")
   key=str(uuid.uuid4());expr=f"select public.crm_pause_enrollment({lit(ENROLL1)},'synthetic legitimate',{lit(key)})"
   first=s.value(expr,security.auth());second=s.value(expr,security.auth());assert first==second and first['ok'],(first,second)
  s.execute(f"update public.crm_user_capabilities set crm_role='crm_admin' where profile_id={lit(core.ALICE)};")
 s.check(7,'CRM admin and operator lifecycle writes and same-scope replay succeed',legit)
 def transitions():
  s.execute(f"update public.crm_campaign_enrollments set status='active' where id={lit(ENROLL3)};")
  for name,status in [('crm_pause_enrollment','paused'),('crm_resume_enrollment','active'),('crm_mark_enrollment_responded','responded')]:
   result=s.value(f"select public.{name}({lit(ENROLL3)},'synthetic lifecycle',{lit(str(uuid.uuid4()))})",security.auth(core.BOB))
   assert result['ok'] and result['status']==status,result
  restarted=s.value(f"select public.crm_restart_enrollment({lit(ENROLL3)},'synthetic restart',{lit(str(uuid.uuid4()))})",security.auth(core.BOB))
  assert restarted['ok'],restarted
  result=s.value(f"select public.crm_cancel_enrollment({lit(restarted['new_enrollment_id'])},'synthetic cancellation',{lit(str(uuid.uuid4()))})",security.auth(core.BOB))
  assert result['ok'] and result['status']=='cancelled',result
 s.check(7,'all five authorized lifecycle transitions retain legitimate results without delivery',transitions)
 def different_keys():
  s.execute("truncate public.crm_idempotency_keys,public.crm_activity_events;update public.crm_campaign_enrollments set status='active';")
  bodies=[('distinct-key-'+str(i),security.auth()+f"begin;select public.crm_pause_enrollment({lit(ENROLL2)},'synthetic concurrency','distinct-{i}');select pg_sleep(.4);select 'RESULT '||pg_backend_pid()::text;commit;") for i in range(2)]
  s.parallel(bodies)
  assert s.value('select count(*) from public.crm_activity_events')==1,'different keys duplicated one state transition'
 s.check(7,'different-key concurrent lifecycle calls recheck locked state and append one audit',different_keys)
 def manual():
  s.execute("alter table public.tenant_memberships add column user_id uuid;update public.tenant_memberships set user_id=profile_id;create table public.crm_campaigns(id uuid primary key,tenant_id uuid,is_active boolean);")
  campaign=str(uuid.uuid4());key=str(uuid.uuid4())
  s.execute(f"insert into public.crm_campaigns values({lit(campaign)},{lit(core.TENANT)},true);")
  expr=f"select public.crm_enroll_clients_in_campaign({lit(campaign)},array[]::uuid[],'synthetic compatibility',{lit(key)}::uuid,'isolated-contract')"
  first=s.value(expr,security.auth());second=s.value(expr,security.auth());assert first==second==[],(first,second)
  for actor in [core.READONLY,core.OUTSIDER]:
   s.deny(expr+';', 'permission' if actor==core.READONLY else 'unauthorized',prefix=security.auth(actor))
 s.check(7,'existing manual enrollment wrapper retains empty-batch replay compatibility without sending',manual)
 s.check(7,'campaign public RPC grants internal helper isolation and volatile locking preserved',lambda:s.execute("set app.zeffy_isolated_fixture='yes';"+b.sql_file(crm/'supabase/tests/campaign_lifecycle_rpc_boundary.sql')))



 # Apply the independently merged current-main retired-donor correction using
 # its exact operating context. No processor or transport is installed/called.
 s.execute(security.definition((m/'20260721233609_relationship_campaign_foundation_rpcs.sql').read_text(encoding='utf-8'),'private.relationship_campaign_context')+b.sql_file(m/'20261019000500_fail_closed_legacy_donor_attribution.sql')+"revoke all on function public.crm_donor_overview(),public.crm_enqueue_donor_transactions(text,boolean,integer) from public;grant execute on function public.crm_donor_overview(),public.crm_enqueue_donor_transactions(text,boolean,integer) to authenticated;")
 def donor_current():
  s.execute(b.sql_file(crm/'supabase/tests/legacy_donor_attribution_acl_contract.sql'))
  for actor in [core.ALICE,core.BOB]:
   overview=s.value('select public.crm_donor_overview()',security.auth(actor))
   assert overview['donors']==1 and overview['totalDonations'] is None and overview['totalDonationsStatus']=='legacy_source_tenant_ownership_unverified',overview
   s.deny("select public.crm_enqueue_donor_transactions('synthetic refusal',true,10);",'LEGACY_DONOR_SOURCE_OWNERSHIP_REQUIRED',prefix=security.auth(actor))
  assert s.value('select count(*) from public.crm_donor_ingest_queue')==0
 s.check(10,'current donor overview omits unverified global totals and authorized legacy replay fails closed',donor_current)
 # Install the exact Stripe function against minimal synthetic row types. It is
 # not invoked to post money; only missing-session and privilege boundaries run.
 s.execute('''
create table public.client_payment_links(id uuid,tenant_id uuid,client_id uuid,stripe_checkout_session_id text,stripe_account_id text,status text,amount_cents integer,allocation_plan jsonb,claim_line_ids uuid[],client_charge_ids uuid[],paid_at timestamptz,updated_at timestamptz);
'''+security.definition((clients/'supabase/migrations/20260904015000_harden_stripe_financial_integrity.sql').read_text(encoding='utf-8'),'public.process_stripe_checkout_payment'))
 # postgres is created by the genuine Auth bootstrap before HTTP starts.
 return m
security.bootstrap=bootstrap
original_jwt=jwt.jwt_cases

def extra_jwt(s):
 original_request=jwt.request
 state={'tokens':[],'done':False}
 def tracked(url,token=None,body=None,method=None,headers=None,timeout=15):
  if url.endswith('/admin/users') and token: state['service']=token
  if url.endswith('/') and '/health' not in url: state['rest']=url.rstrip('/')
  if '/report' in url and body is not None and len(state['tokens'])==2 and not state['done']:
   state['done']=True
   # The Auth role now exists. Emulate the reviewed preexisting explicit service grant
   # before applying the ACL-only migration; do not change migration expectations.
   s.execute("grant execute on function public.process_stripe_checkout_payment(text,text,integer,uuid[],uuid[]) to service_role;alter role postgres superuser;alter function public.process_stripe_checkout_payment(text,text,integer,uuid[],uuid[]) owner to postgres;"+b.sql_file(b.MIGRATIONS/'20261019000100_stripe_checkout_payment_service_only.sql')+b.sql_file(b.TESTS/'stripe_checkout_payment_rpc_acl.sql')+"notify pgrst,'reload schema';")
   import time;time.sleep(.5)
   outcomes=[]
   def run(name,action):
    def wrapped():
     observed=action();outcomes.append(dict(name=name,observed=observed))
     (s.root/'additional-jwt-outcomes.json').write_text(json.dumps(outcomes,indent=2),encoding='utf-8')
    s.check(7,name,wrapped)
   target=state['rest']+'/rpc/process_stripe_checkout_payment'
   args=dict(p_session_id='synthetic-missing-session',p_payment_intent_id='synthetic-no-operation',p_amount_cents=7500)
   def browser_denied():
    codes=[]
    for identity in [None,*state['tokens']]:
     code,data=original_request(target,identity,args);assert code in [401,403,404],(code,data)
     # A hidden RPC (404) must specifically be missing from this role's schema.
     if code==404:assert data.get('code')=='PGRST202',data
     codes.append(code)
    return dict(http_statuses=codes,financial_rows=0)
   run('Stripe posting RPC rejects anonymous and both genuine signed users',browser_denied)
   def service_allowed():
    code,data=original_request(target,state['service'],args);assert code==200 and data['reason']=='payment_link_not_found',(code,data)
    assert s.value('select count(*) from public.client_payment_links')==0
    return dict(status=code,result=data,posting_invoked=False)
   run('Stripe service JWT retains callable RPC and missing-session path creates no financial rows',service_allowed)
   def helpers_denied():
    codes=[]
    for user in [None,*state['tokens']]:
     for name,args in [('_crm_idempotency_claim',dict(p_key='synthetic',p_operation='x',p_tenant_id=core.TENANT,p_target_id=ENROLL1)),('_crm_idempotency_record',dict(p_key='synthetic',p_operation='x',p_result={}))]:
      code,data=original_request(state['rest']+'/rpc/'+name,user,args);assert code in [401,403,404],(code,data)
      if code==404:assert data.get('code')=='PGRST202',data
      codes.append(code)
    return dict(http_statuses=codes)
   run('CRM internal helpers reject anonymous and genuine signed browser JWT calls',helpers_denied)
   def signed_lifecycle():
    codes=[]
    for name in ['crm_pause_enrollment','crm_resume_enrollment','crm_cancel_enrollment','crm_mark_enrollment_responded','crm_restart_enrollment']:
     code,data=original_request(state['rest']+'/rpc/'+name,state['tokens'][0],dict(p_enrollment_id=ENROLL1,p_reason='synthetic JWT test',p_idempotency_key=str(uuid.uuid4())))
     assert code==403 and data.get('code')=='42501',(code,data)
     codes.append(code)
    claims=json.loads(__import__('base64').urlsafe_b64decode(state['tokens'][0].split('.')[1]+'=='))
    uid=claims['sub']
    s.execute(f"insert into public.tenant_memberships(profile_id,tenant_id,tenant_role,user_id) values({lit(uid)},{lit(core.TENANT)},'member',{lit(uid)});")
    campaign=s.value('select id from public.crm_campaigns limit 1')
    code,data=original_request(state['rest']+'/rpc/crm_enroll_clients_in_campaign',state['tokens'][0],dict(p_campaign_id=campaign,p_client_ids=[],p_reason='synthetic JWT test',p_idempotency_key=str(uuid.uuid4()),p_contract_version='isolated-contract'))
    assert code==403 and data.get('code')=='42501',(code,data)
    codes.append(code)
    return dict(http_statuses=codes,roles='actual GoTrue-signed crm_readonly tenant member')
   run('all six public campaign mutation RPCs reject a genuine readonly tenant JWT',signed_lifecycle)
   def signed_donor():
    for tenant,amount in [(core.TENANT,11),(core.TENANT2,22)]:
     s.execute(f"insert into public.crm_donors(tenant_id,givebutter_contact_id,display_name,lifetime_amount) values({lit(tenant)},'synthetic-overlapping-provider-id','Synthetic shared identity',{amount});")
    observed=[]
    for index,identity in enumerate(state['tokens']):
     code,data=original_request(state['rest']+'/rpc/crm_donor_overview',identity,{})
     assert code==200 and data['donors']==2 and data['lifetimeAmount']==[11,22][index] and data['totalDonations'] is None,(code,data)
     claims=json.loads(__import__('base64').urlsafe_b64decode(identity.split('.')[1]+'=='));uid=claims['sub']
     s.execute(f"update public.crm_user_capabilities set crm_role='crm_operator' where profile_id={lit(uid)};")
     try:
      denied,error=original_request(state['rest']+'/rpc/crm_enqueue_donor_transactions',identity,dict(p_reason='synthetic refusal',p_historical=True,p_limit=10))
      assert denied==403 and 'LEGACY_DONOR_SOURCE_OWNERSHIP_REQUIRED' in error.get('message',''),(denied,error)
     finally:s.execute(f"update public.crm_user_capabilities set crm_role='crm_readonly' where profile_id={lit(uid)};")
     observed.append(dict(status=code,overview=data,replay_status=denied))
    assert s.value('select count(*) from public.crm_donor_ingest_queue')==0
    return observed
   run('current donor reporting with overlapping synthetic identities remains tenant scoped under real JWTs and queues nothing',signed_donor)


  result=original_request(url,token,body,method,headers,timeout)
  if '/token?grant_type=password' in url and result[0]==200:state['tokens'].append(result[1]['access_token'])
  return result
 jwt.request=tracked
 try:original_jwt(s)
 finally:jwt.request=original_request
jwt.jwt_cases=extra_jwt
if __name__=='__main__':
 sys.argv=[str(scripts/'run-zeffy-db-acceptance.py'),'--part5c','--crm-repo',str(crm)]
 if args.output_dir: sys.argv.extend(['--output-dir',str(args.output_dir.resolve())])
 b.main()

