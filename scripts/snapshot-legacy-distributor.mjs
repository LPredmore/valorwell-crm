import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
const query=`select coalesce(json_agg(s),'[]'::json) from (select video_id,destination,delivery_status,post_id,attempt_count,last_attempt_at from "data_table_user_g9aqqVnUkpIvZUmb" where record_type='delivery') s;`;
const rows=JSON.parse(execFileSync('docker',['exec','n8n-postgres','psql','-U','n8n','-d','n8n','-At','-c',query],{encoding:'utf8'}));
const literal=JSON.stringify(rows).replaceAll("'","''");
const sql=`begin;
create temporary table legacy_release_snapshot on commit drop as select * from jsonb_to_recordset('${literal}'::jsonb) as x(video_id text,destination text,delivery_status text,post_id text,attempt_count integer,last_attempt_at text);
insert into public.ai_operations_youtube_release_registry(tenant_id,channel_id,youtube_video_id,video_url,detection_method,baseline_excluded)
select distinct c.tenant_id,c.channel_id,l.video_id,'https://www.youtube.com/watch?v='||l.video_id,'legacy_import',true from legacy_release_snapshot l cross join public.ai_operations_distribution_config c
where c.tenant_id='00000000-0000-0000-0000-000000000001' and l.video_id ~ '^[A-Za-z0-9_-]{11}$'
on conflict(tenant_id,youtube_video_id) do update set baseline_excluded=true;
insert into public.ai_operations_social_distribution_deliveries(tenant_id,release_id,youtube_video_id,destination_id,platform,content_type,status,attempt_count,external_post_id,external_post_url,published_at,last_error)
select r.tenant_id,r.id,r.youtube_video_id,a.id,a.platform,'link',
case when l.delivery_status='POSTED' and nullif(l.post_id,'') is not null then 'PUBLISHED' when l.delivery_status='BLOCKED_AUTH' then 'BLOCKED_AUTH' when l.delivery_status='FAILED_PERMANENT' then 'FAILED' when l.delivery_status in ('SENDING','UNKNOWN_REVIEW','POSTED') then 'NEEDS_REVIEW' else 'SKIPPED_BASELINE' end,
coalesce(l.attempt_count,0),nullif(l.post_id,''),case when nullif(l.post_id,'') is not null then case when a.platform='facebook' then 'https://www.facebook.com/'||l.post_id else 'https://www.linkedin.com/feed/update/'||l.post_id||'/' end end,
case when l.delivery_status='POSTED' then nullif(l.last_attempt_at,'')::timestamptz end,'imported_legacy_'||lower(l.delivery_status)
from legacy_release_snapshot l join public.ai_operations_youtube_release_registry r on r.tenant_id='00000000-0000-0000-0000-000000000001' and r.youtube_video_id=l.video_id
join public.ai_operations_distribution_destinations a on a.tenant_id=r.tenant_id and a.external_account_id=case l.destination when 'facebook_page' then '119382491255956' when 'linkedin_person' then 'urn:li:person:CfHqw9H6zg' when 'linkedin_organization' then 'urn:li:organization:98694960' end
on conflict(tenant_id,youtube_video_id,destination_id) do update set status=excluded.status,attempt_count=excluded.attempt_count,external_post_id=excluded.external_post_id,external_post_url=excluded.external_post_url,published_at=excluded.published_at,last_error=excluded.last_error where ai_operations_social_distribution_deliveries.attempt_count=0;
insert into public.ai_operations_social_distribution_attempts(tenant_id,delivery_id,attempt_number,lease_token,worker_id,started_at,completed_at,outcome,external_post_id)
select d.tenant_id,d.id,d.attempt_count,gen_random_uuid(),'legacy-ytReleaseDist001',coalesce(nullif(l.last_attempt_at,'')::timestamptz,d.created_at),coalesce(nullif(l.last_attempt_at,'')::timestamptz,d.created_at),d.status,d.external_post_id
from public.ai_operations_social_distribution_deliveries d join legacy_release_snapshot l on l.video_id=d.youtube_video_id
join public.ai_operations_distribution_destinations a on a.id=d.destination_id and a.external_account_id=case l.destination when 'facebook_page' then '119382491255956' when 'linkedin_person' then 'urn:li:person:CfHqw9H6zg' when 'linkedin_organization' then 'urn:li:organization:98694960' end
where d.tenant_id='00000000-0000-0000-0000-000000000001' and d.attempt_count>0
on conflict(delivery_id,attempt_number) do update set started_at=excluded.started_at,completed_at=excluded.completed_at where ai_operations_social_distribution_attempts.worker_id='legacy-ytReleaseDist001';
commit;
select status,count(*) from public.ai_operations_social_distribution_deliveries group by status;
`;
mkdirSync(new URL('../docs/distributor-evidence/',import.meta.url),{recursive:true});
writeFileSync(new URL('../docs/distributor-evidence/legacy-deliveries.json',import.meta.url),JSON.stringify(rows,null,2));
writeFileSync(new URL('../docs/distributor-evidence/import-legacy.sql',import.meta.url),sql);
console.log('Exported '+rows.length+' sanitized legacy delivery records and idempotent import SQL. Existing n8n state was not changed.');
