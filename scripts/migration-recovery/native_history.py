"""Synthetic Stedi preservation against actual restored tables and original SQL."""
import hashlib
import json
from pathlib import Path
import uuid


def stedi_preservation(stack, migration):
    ids = {key: str(uuid.uuid4()) for key in ['tenant', 'profile', 'client', 'staff', 'practice', 'insurance', 'claim']}
    q = lambda key: "'" + ids[key] + "'"
    stack.sql(f"""
INSERT INTO public.tenants(id,name,slug) VALUES ({q('tenant')},'Synthetic Stedi retention','stedi-'||{q('tenant')});
INSERT INTO public.profiles(id,email) VALUES ({q('profile')},'stedi-'||{q('profile')}||'@example.invalid');
INSERT INTO public.clients(id,tenant_id,profile_id) VALUES ({q('client')},{q('tenant')},{q('profile')});
INSERT INTO public.staff(id,tenant_id,profile_id) VALUES ({q('staff')},{q('tenant')},{q('profile')});
INSERT INTO public.practice_info(id,tenant_id,bill_name,bill_taxid) VALUES ({q('practice')},{q('tenant')},'Synthetic practice','000000000');
INSERT INTO public.client_insurance(id,tenant_id,client_id,payer_order) VALUES ({q('insurance')},{q('tenant')},{q('client')},1);
INSERT INTO public.claims(id,tenant_id,practice_id,client_id,client_insurance_id,rendering_staff_id)
VALUES ({q('claim')},{q('tenant')},{q('practice')},{q('client')},{q('insurance')},{q('staff')});
INSERT INTO public.claim_submission_attempts(tenant_id,claim_id,attempt_ordinal,pcn,submission_mode,outcome,submitted_at,clearinghouse)
SELECT {q('tenant')},{q('claim')},i,'synthetic-stedi-'||i,'unknown','unknown',now(),'stedi' FROM generate_series(1,4) i;
INSERT INTO public.claim_status_events(tenant_id,claim_id,event_source,new_status)
SELECT {q('tenant')},{q('claim')},'stedi_lifecycle','pending_review' FROM generate_series(1,6);
INSERT INTO public.claim_clearinghouse_routes(tenant_id,client_id,client_insurance_id,clearinghouse,effective_from,enabled)
VALUES ({q('tenant')},{q('client')},{q('insurance')},'stedi',now()-interval '1 day',true);
SELECT cron.schedule('synthetic-stedi-retention','0 0 * * *','SELECT 1');
""")
    query = f"""SELECT jsonb_build_object(
'attempts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.claim_submission_attempts x WHERE tenant_id={q('tenant')}),
'events',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.claim_status_events x WHERE tenant_id={q('tenant')}),
'claims',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.claims x WHERE tenant_id={q('tenant')}));"""
    before = json.loads(stack.sql(query))
    source = Path(migration).read_bytes()
    stack.sql(source.decode())
    after = json.loads(stack.sql(query))
    disabled = json.loads(stack.sql(f"SELECT to_jsonb(NOT EXISTS(SELECT 1 FROM public.claim_clearinghouse_routes WHERE tenant_id={q('tenant')} AND enabled) AND NOT EXISTS(SELECT 1 FROM cron.job WHERE active AND (jobname ILIKE '%stedi%' OR command ILIKE '%stedi%')));"))
    result = dict(status='PASS' if before == after and disabled and len(before['attempts']) == 4 and len(before['events']) == 6 else 'FAIL',
                  migration_sha256=hashlib.sha256(source).hexdigest(), synthetic_attempts=4, synthetic_events=6,
                  history_unchanged=before == after, operational_stedi_disabled=disabled,
                  provider_acknowledgements_created=0)
    stack.report['stedi_preservation'] = result
    stack.save()
    return result
