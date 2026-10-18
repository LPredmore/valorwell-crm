"""Optional actual CRM worker-body checks; synthetic contracts, never full-schema proof."""
import base64,json,time,uuid,subprocess,socket,hashlib,hmac

def run_workers(s, crm, core, security, request, state, run):
    lit=core.lit
    m=crm/'supabase/migrations'
    source=(m/'20260814221322_a9c43e79-b2f1-4753-85ca-8575a65cdf84.sql').read_text(encoding='utf-8')
    # Minimal dependency contracts are explicit. No transport/dispatcher is installed.
    ddl='''
create table public.crm_campaign_registry(id uuid primary key,tenant_id uuid,engine text,source_campaign_id uuid,concurrency_group text);
create table public.crm_campaign_concurrency_groups(tenant_id uuid,group_key text,is_exclusive boolean);
create table public.crm_campaign_trigger_rules(id uuid primary key,tenant_id uuid,active boolean,event_type text,filter_definition jsonb,required_source_campaign_registry_id uuid,required_source_outcome text,delay_unit text,delay_amount integer);
create table public.crm_campaign_trigger_jobs(tenant_id uuid,event_id uuid,trigger_rule_id uuid,person_id uuid,subject_type text,subject_id uuid,due_at timestamptz,unique(event_id,trigger_rule_id));
alter table public.crm_automation_events add column processed_at timestamptz;
create function private.crm_control_plane_flag(uuid,text) returns boolean language sql as $$select true$$;
create table public.crm_email_messages(id uuid primary key,tenant_id uuid,client_id uuid,direction text,in_reply_to_message_id uuid,metadata jsonb,provider_thread_id text,enrollment_id uuid,occurred_at timestamptz);
'''
    social=(crm/'src/test/sql/social-publish-claim-fixture.sql').read_text(encoding='utf-8')
    ddl+=social+'''alter table public.ai_operations_social_publications add column tenant_id uuid,add column project_id uuid,add column clip_id uuid;'''
    names=['crm_enqueue_campaign_trigger_jobs','crm_evaluate_campaign_concurrency','crm_correlate_client_email_reply']
    for name in names:ddl+=security.definition(source,'public.'+name)
    ddl+=security.definition((m/'20260922190000_social_media_publish_queue.sql').read_text(encoding='utf-8'),'public.social_queue_publish')
    ddl+=(m/'20261019000400_internal_campaign_social_worker_acl.sql').read_text(encoding='utf-8')
    # Same owner contract as production; no new SECURITY DEFINER is introduced.
    signatures=['social_queue_publish(uuid)','crm_enqueue_campaign_trigger_jobs(uuid)','crm_correlate_client_email_reply(uuid)','crm_evaluate_campaign_concurrency(uuid,uuid,text,uuid)']
    for sig in signatures:ddl+='alter function public.'+sig+' owner to postgres;'
    ddl+="notify pgrst,'reload schema';"
    s.execute(ddl);time.sleep(.5)
    ident=lambda:str(uuid.uuid4())
    pub,project,reg,campaign,client,rule,event,outbound,inbound,enroll=[ident() for _ in range(10)]
    s.execute(f"""
insert into public.ai_operations_social_publications(id,status,tenant_id,project_id) values({lit(pub)},'approved',{lit(core.TENANT)},{lit(project)});
insert into public.crm_campaign_registry values({lit(reg)},{lit(core.TENANT)},'crm_campaigns',{lit(campaign)},'synthetic');
insert into public.crm_campaign_concurrency_groups values({lit(core.TENANT)},'synthetic',true);
insert into public.crm_campaign_trigger_rules values({lit(rule)},{lit(core.TENANT)},true,'synthetic.worker','{{}}',null,null,'minutes',0);
insert into public.crm_automation_events(id,tenant_id,event_type,subject_type,subject_id,idempotency_key,payload,occurred_at) values({lit(event)},{lit(core.TENANT)},'synthetic.worker','client',{lit(client)},'worker-fixture','{{}}',now());
insert into public.crm_campaign_enrollments(id,tenant_id,client_id,campaign_id,status) values({lit(enroll)},{lit(core.TENANT)},{lit(client)},{lit(campaign)},'active');
insert into public.crm_email_messages(id,tenant_id,client_id,direction,metadata,enrollment_id,occurred_at) values({lit(outbound)},{lit(core.TENANT)},{lit(client)},'outbound','{{}}',{lit(enroll)},now());
insert into public.crm_email_messages(id,tenant_id,client_id,direction,in_reply_to_message_id,metadata,occurred_at) values({lit(inbound)},{lit(core.TENANT)},{lit(client)},'inbound',{lit(outbound)},'{{}}',now());
insert into public.crm_campaign_step_logs(enrollment_id,status) values({lit(enroll)},'scheduled');
""")
    calls=[('social_queue_publish',dict(p_publication_id=pub)),('crm_enqueue_campaign_trigger_jobs',dict(p_event_id=event)),('crm_correlate_client_email_reply',dict(p_inbound_email_message_id=inbound)),('crm_evaluate_campaign_concurrency',dict(p_tenant_id=core.TENANT,p_campaign_registry_id=reg,p_subject_type='client',p_subject_id=client))]
    def rpc(name,args,token=None):return request(state['rest']+'/rpc/'+name,token,args)
    def genuine_anonymous():
        # A separate owned GoTrue instance issues a real anonymous-user token.
        # Reuse only this run's ephemeral signing key and guarded database route.
        # No email provider is enabled and SMTP remains loopback port 9.
        template=next(s.root.glob('zeffy5c-auth-*.env'))
        env=dict(line.split('=',1) for line in template.read_text().splitlines() if '=' in line)
        assert 'host.docker.internal:' in env['GOTRUE_DB_DATABASE_URL']
        expected=s.value('select system_identifier::text from pg_control_system()')
        pgport=s.psql[s.psql.index('-p')+1]
        def docker(args):
            proc=subprocess.run(['docker',*args],capture_output=True,text=True,env=core.b.ENV,creationflags=core.b.FLAGS,timeout=45)
            assert proc.returncode==0,proc.stderr
            return proc.stdout
        actual=docker(['run','--rm','postgres:16.14','psql','-X','-w','-h','host.docker.internal','-p',pgport,'-U','fixture_admin','-d','postgres','-Atc','select system_identifier from pg_control_system()']).strip()
        assert actual==expected,'BLOCKED anonymous Auth database identity mismatch'
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        url='http://127.0.0.1:'+str(port)
        env.update(API_EXTERNAL_URL=url,GOTRUE_SITE_URL=url,GOTRUE_DISABLE_SIGNUP='false',GOTRUE_EXTERNAL_EMAIL_ENABLED='false',GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED='true')
        assert env['GOTRUE_SMTP_HOST']=='127.0.0.1' and env['GOTRUE_SMTP_PORT']=='9'
        config=s.root/'worker-anonymous-auth.env'
        config.write_text(''.join(k+'='+v+'\n' for k,v in env.items()),encoding='utf-8')
        name='zeffy5c-anonymous-'+uuid.uuid4().hex[:12]
        try:
            docker(['run','--detach','--name',name,'-p','127.0.0.1:'+str(port)+':9999','--env-file',str(config),'supabase/gotrue:v2.197.0'])
            for _ in range(50):
                try:
                    if request(url+'/health')[0]==200:break
                except OSError:pass
                time.sleep(.2)
            code,session=request(url+'/signup',body={})
            assert code==200,(code,session.get('msg'),session.get('error_code'))
            token=session['access_token'];head,payload,sig=token.split('.')
            signed=base64.urlsafe_b64encode(hmac.new(env['GOTRUE_JWT_SECRET'].encode(),(head+'.'+payload).encode(),hashlib.sha256).digest()).decode().rstrip('=')
            assert hmac.compare_digest(sig,signed)
            claims=json.loads(base64.urlsafe_b64decode(payload+'=='))
            assert claims['is_anonymous'] and claims['role']=='authenticated'
            checks=calls+[('crm_emit_automation_event',dict(p_tenant_id=core.TENANT,p_event_type='synthetic',p_subject_type='client',p_subject_id=client,p_idempotency_key=ident()))]
            statuses=[]
            for target,args in checks:
                code,data=rpc(target,args,token);assert code==403,(target,code,data);statuses.append(code)
            return dict(issuer='actual isolated GoTrue anonymous signup',is_anonymous=True,role=claims['role'],signature_verified=True,http_statuses=statuses,sends=0)
        finally:
            logs=subprocess.run(['docker','logs',name],capture_output=True,text=True,creationflags=core.b.FLAGS)
            (s.root/'worker-anonymous-auth.log').write_text(logs.stdout+logs.stderr,encoding='utf-8')
            subprocess.run(['docker','rm','-f',name],capture_output=True,creationflags=core.b.FLAGS)
            config.unlink(missing_ok=True)
    run('worker supplement: genuine GoTrue anonymous user denied emitter and four actual workers',genuine_anonymous)
    def denied():
        codes=[]
        for token in [None,*state['tokens']]:
            for name,args in calls:
                code,data=rpc(name,args,token);assert code in [401,403],(name,code,data);codes.append(code)
        assert s.value('select count(*) from public.crm_campaign_trigger_jobs')==0
        assert s.value('select count(*) from public.ai_operations_video_jobs')==0
        assert s.value(f'select status from public.crm_campaign_enrollments where id={lit(enroll)}')=='active'
        return dict(http_statuses=codes,actual_bodies=True,provider_operations=0)
    run('worker supplement: anonymous and two signed users denied all four actual CRM workers',denied)
    def queue():
        name,args=calls[0];code,data=rpc(name,args,state['service']);assert code==200 and isinstance(data,int),(code,data)
        again,error=rpc(name,args,state['service']);assert again==400 and 'approved' in error.get('message',''),(again,error)
        assert s.value(f'select count(*) from public.ai_operations_video_jobs where social_publication_id={lit(pub)}')==1
        assert s.value(f'select status from public.ai_operations_social_publications where id={lit(pub)}')=='upload_queued'
        return dict(http_statuses=[code,again],queued=1,published=0,complete_schema=False)
    run('worker supplement: trusted Social Media queue body creates one local job and rejects replay',queue)
    def enqueue():
        name,args=calls[1];observed=[]
        for _ in range(2):
            code,data=rpc(name,args,state['service']);assert code==200 and data==1,(code,data);observed.append(code)
        assert s.value(f'select count(*) from public.crm_campaign_trigger_jobs where event_id={lit(event)}')==1
        assert s.value(f'select processed_at is not null from public.crm_automation_events where id={lit(event)}')
        return dict(http_statuses=observed,job_rows=1,actual_body=True,flag_dependency='synthetic true',sends=0)
    run('worker supplement: trusted trigger enqueue body retains unique job and processed event',enqueue)
    def concurrency():
        name,args=calls[3];code,data=rpc(name,args,state['service']);assert code==200 and data['reason']=='duplicate_active_enrollment',(code,data)
        args={**args,'p_subject_id':ident()};code,data=rpc(name,args,state['service']);assert code==200 and data['allowed'],(code,data)
        return dict(http_statuses=[200,200],duplicate_rejected=True,unoccupied_allowed=True)
    run('worker supplement: trusted campaign concurrency body preserves allowed and conflict paths',concurrency)
    def correlation():
        name,args=calls[2];code,data=rpc(name,args,state['service']);assert code==200 and data['correlated'] and data['enrollmentId']==enroll,(code,data)
        assert s.value(f'select status from public.crm_campaign_enrollments where id={lit(enroll)}')=='responded'
        assert s.value(f'select skip_reason from public.crm_campaign_step_logs where enrollment_id={lit(enroll)}')=='client_responded'
        again,error=rpc(name,args,state['service']);assert again==200 and error['reason']=='enrollment_not_open',(again,error)
        return dict(http_statuses=[code,again],correlated=True,scheduled_step_skipped=True,outbound_sends=0)
    run('worker supplement: trusted email correlation body marks response and skips unsent steps',correlation)
    def signed_operator():
        token=state['tokens'][0];uid=json.loads(base64.urlsafe_b64decode(token.split('.')[1]+'=='))['sub'];observed=[]
        try:
            for role in ['crm_operator','crm_admin']:
                s.execute(f"update public.crm_user_capabilities set crm_role={lit(role)} where profile_id={lit(uid)};update public.crm_campaign_enrollments set status='active' where id={lit(enroll)};")
                for name,status in [('crm_pause_enrollment','paused'),('crm_resume_enrollment','active'),('crm_mark_enrollment_responded','responded')]:
                    args=dict(p_enrollment_id=enroll,p_reason='synthetic signed operator',p_idempotency_key=ident());code,data=rpc(name,args,token)
                    assert code==200 and data['ok'] and data['status']==status,(code,data)
                    again,replay=rpc(name,args,token);assert again==200 and replay==data,(again,replay)
                    observed.extend([code,again])
                code,data=rpc('crm_restart_enrollment',dict(p_enrollment_id=enroll,p_reason='synthetic',p_idempotency_key=ident()),token);assert code==200 and data['ok'],(code,data)
                code,data=rpc('crm_cancel_enrollment',dict(p_enrollment_id=data['new_enrollment_id'],p_reason='synthetic',p_idempotency_key=ident()),token);assert code==200 and data['ok'],(code,data)
                foreign=core.TENANT2;s.execute(f"insert into public.crm_campaign_enrollments(id,tenant_id,status) values({lit(project)},{lit(foreign)},'active') on conflict(id) do update set status='active';")
                code,error=rpc('crm_pause_enrollment',dict(p_enrollment_id=project,p_reason='synthetic foreign refusal',p_idempotency_key=ident()),token);assert code==403,(code,error)
                assert s.value(f'select status from public.crm_campaign_enrollments where id={lit(project)}')=='active'
                code,error=rpc('crm_pause_enrollment',dict(p_enrollment_id=ident(),p_reason='synthetic absent refusal',p_idempotency_key=ident()),token)
                assert code==403 and error.get('message')=='enrollment_not_found',(code,error)
                observed.extend([200,200,403,code])
        finally:s.execute(f"update public.crm_user_capabilities set crm_role='crm_readonly' where profile_id={lit(uid)};")
        return dict(http_statuses=observed,identity='actual GoTrue-issued user JWT',roles=['crm_operator','crm_admin'],sends=0)
    run('worker supplement: genuine signed operator and admin execute five transitions with replay and foreign denial',signed_operator)
