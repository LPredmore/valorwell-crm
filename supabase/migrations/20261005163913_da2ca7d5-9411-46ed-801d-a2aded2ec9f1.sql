-- 1. Restore 'relationship' and 'provider_applicant' audience branches in the resolver
create or replace function private.crm_newsletter_candidates(
  p_tenant_id uuid,
  p_domains text[]
)
returns table (
  audience_domain text,
  record_id uuid,
  person_id uuid,
  candidate_email text,
  candidate_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    -- clients: excluded when their own contact policy forbids contact
    select
      'client'::text as audience_domain,
      c.id as record_id,
      lower(btrim(c.email)) as candidate_email,
      coalesce(nullif(btrim(c.pat_name_preferred), ''), nullif(btrim(c.pat_name_f), '')) as candidate_name
    from public.clients c
    where c.tenant_id = p_tenant_id
      and 'client' = any (p_domains)
      and c.email is not null and btrim(c.email) <> ''
      and coalesce(c.contact_policy::text, '') <> 'do_not_contact'
      and coalesce(c.pat_status::text, '') <> 'deleted'

    union all

    -- staff: excluded when the underlying login is deactivated
    select
      'staff'::text,
      s.id,
      lower(btrim(pr.email)),
      coalesce(nullif(btrim(s.prov_name_for_clients), ''), nullif(btrim(s.prov_name_f), ''))
    from public.staff s
    join public.profiles pr on pr.id = s.profile_id
    where s.tenant_id = p_tenant_id
      and 'staff' = any (p_domains)
      and pr.email is not null and btrim(pr.email) <> ''
      and coalesce(pr.is_active, true) is true
      and coalesce(s.prov_status::text, '') not in ('inactive', 'terminated')

    union all

    -- beyond the yellow contacts: excluded on do-not-contact or an active suppression
    select
      'bty'::text,
      rc.id,
      lower(btrim(rc.email)),
      coalesce(nullif(btrim(rc.preferred_name), ''), nullif(btrim(rc.first_name), ''))
    from public.relationship_contacts rc
    where rc.tenant_id = p_tenant_id
      and 'bty' = any (p_domains)
      and rc.email is not null and btrim(rc.email) <> ''
      and coalesce(rc.do_not_contact, false) is false
      and not exists (
        select 1
        from public.relationship_suppressions rs
        where rs.tenant_id = rc.tenant_id
          and rs.revoked_at is null
          and (rs.expires_at is null or rs.expires_at > now())
          and (
            rs.contact_id = rc.id
            or (rs.email is not null and lower(btrim(rs.email)) = lower(btrim(rc.email)))
          )
      )

    union all

    -- relationship contacts: same contact pool and safeguards as the bty branch
    select
      'relationship'::text,
      rc.id,
      lower(btrim(rc.email)),
      coalesce(nullif(btrim(rc.preferred_name), ''), nullif(btrim(rc.first_name), ''))
    from public.relationship_contacts rc
    where rc.tenant_id = p_tenant_id
      and 'relationship' = any (p_domains)
      and rc.email is not null and btrim(rc.email) <> ''
      and coalesce(rc.do_not_contact, false) is false
      and not exists (
        select 1
        from public.relationship_suppressions rs
        where rs.tenant_id = rc.tenant_id
          and rs.revoked_at is null
          and (rs.expires_at is null or rs.expires_at > now())
          and (
            rs.contact_id = rc.id
            or (rs.email is not null and lower(btrim(rs.email)) = lower(btrim(rc.email)))
          )
      )

    union all

    -- provider applicants: excluded once declined
    select
      'provider_applicant'::text,
      pa.id,
      lower(btrim(pa.email)),
      nullif(btrim(concat_ws(' ', pa.first_name, pa.last_name)), '')
    from public.provider_applicants pa
    where pa.tenant_id = p_tenant_id
      and 'provider_applicant' = any (p_domains)
      and pa.email is not null and btrim(pa.email) <> ''
      and coalesce(pa.status::text, '') <> 'declined'

    union all

    -- donors: excluded when they have opted out of communication
    select
      'donor'::text,
      d.id,
      lower(btrim(d.primary_email)),
      nullif(btrim(d.display_name), '')
    from public.crm_donors d
    where d.tenant_id = p_tenant_id
      and 'donor' = any (p_domains)
      and d.primary_email is not null and btrim(d.primary_email) <> ''
      and coalesce(d.communication_opt_in, true) is true
  )
  select
    b.audience_domain,
    b.record_id,
    rec.person_id,
    b.candidate_email,
    b.candidate_name
  from base b
  left join public.crm_person_records rec
    on rec.tenant_id = p_tenant_id
   and rec.record_domain = b.audience_domain
   and rec.record_id = b.record_id
  where b.candidate_email is not null
    and b.candidate_email like '%@%';
$$;

-- 2. Accept all six audiences when saving a canonical newsletter
CREATE OR REPLACE FUNCTION public.crm_upsert_newsletter_canonical(p_newsletter_id uuid, p_name text, p_subject text, p_content jsonb, p_audience_domains text[], p_reason text, p_template_version_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_tenant uuid := (v_context->>'tenant_id')::uuid;
  v_profile uuid := (v_context->>'actor_id')::uuid;
  v_domains text[] := coalesce(p_audience_domains, array['client']::text[]);
  v_existing public.crm_newsletters;
  v_id uuid;
  v_created boolean := false;
  v_schema integer;
  v_doc jsonb;
  v_html text;
  v_text text;
  v_preheader text;
  v_theme text;
  v_hash text;
begin
  if coalesce(btrim(p_reason),'')='' then raise exception 'A reason is required to create or change a newsletter'; end if;
  if coalesce(btrim(p_name),'')='' then raise exception 'A newsletter needs a name'; end if;
  if coalesce(btrim(p_subject),'')='' then raise exception 'A newsletter needs a subject'; end if;
  if array_length(v_domains,1) is null then raise exception 'Select at least one audience for this newsletter'; end if;
  if exists (select 1 from unnest(v_domains) d where d not in ('client','staff','donor','relationship','bty','provider_applicant')) then
    raise exception 'Unsupported newsletter audience selected. Supported audiences are client, staff, donor, relationship, bty, and provider_applicant.';
  end if;
  if p_content is null or coalesce(p_content->>'mode','') <> 'newsletter' then
    raise exception 'Canonical marketing newsletter content in newsletter mode is required';
  end if;

  v_schema := nullif(p_content->>'schemaVersion','')::integer;
  v_doc := p_content->'editorDocument';
  v_html := nullif(p_content->>'renderedHtml','');
  v_text := nullif(p_content->>'renderedText','');
  v_preheader := nullif(btrim(coalesce(p_content->>'preheader','')),'') ;
  v_theme := nullif(btrim(coalesce(p_content->>'themeKey','')),'') ;
  v_hash := nullif(btrim(coalesce(p_content->>'renderHash','')),'') ;

  if v_schema is null or v_schema < 1 or v_doc is null
     or jsonb_typeof(v_doc) <> 'object' or v_doc->>'type' <> 'doc'
     or jsonb_typeof(v_doc->'content') <> 'array'
     or v_html is null or v_text is null or v_theme is null or v_hash is null
     or v_hash !~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$' then
    raise exception 'Canonical Email Studio content is incomplete or invalid';
  end if;

  if p_template_version_id is not null and not exists (
    select 1 from public.crm_email_template_versions tv
    where tv.id=p_template_version_id and tv.tenant_id=v_tenant
      and tv.content_scope='marketing_newsletter' and tv.content_mode='newsletter'
  ) then
    raise exception 'Template version is not a published marketing newsletter version for this tenant';
  end if;

  if p_newsletter_id is null then
    insert into public.crm_newsletters (
      tenant_id,name,subject,preheader,body_html,body_text,template_version_id,audience_domains,status,
      created_by_profile_id,metadata,editor_document,editor_schema_version,theme_key,render_hash
    ) values (
      v_tenant,btrim(p_name),btrim(p_subject),v_preheader,v_html,v_text,p_template_version_id,v_domains,'draft',
      v_profile,jsonb_build_object('contentSource','email_studio','contentScope','marketing_newsletter'),
      v_doc,v_schema,v_theme,v_hash
    ) returning id into v_id;
    v_created := true;
  else
    select * into v_existing from public.crm_newsletters where id=p_newsletter_id and tenant_id=v_tenant;
    if v_existing.id is null then raise exception 'Newsletter not found for this tenant'; end if;
    if v_existing.status <> 'draft' then raise exception 'Only a draft newsletter can be edited. Revise a scheduled newsletter by cloning it to a new draft.'; end if;
    update public.crm_newsletters
    set name=btrim(p_name), subject=btrim(p_subject), preheader=v_preheader,
        body_html=v_html, body_text=v_text, template_version_id=p_template_version_id,
        audience_domains=v_domains, editor_document=v_doc, editor_schema_version=v_schema,
        theme_key=v_theme, render_hash=v_hash,
        metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('contentSource','email_studio','contentScope','marketing_newsletter'),
        updated_at=now()
    where id=v_existing.id returning id into v_id;
  end if;

  perform public.crm_emit_automation_event(
    v_tenant,
    case when v_created then 'newsletter.created' else 'newsletter.updated' end,
    'newsletter',
    v_id,
    'newsletter:' || (case when v_created then 'created' else 'updated' end) || ':' || v_id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object('newsletterId',v_id,'audienceDomains',to_jsonb(v_domains),'reason',btrim(p_reason),'actorProfileId',v_profile,'contentSource','email_studio','renderHash',v_hash),
    'database'
  );

  return jsonb_build_object('newsletterId',v_id,'created',v_created,'canonical',true,'renderHash',v_hash);
end;
$function$;

-- 3. Wake the send worker the moment a newsletter becomes scheduled
create or replace function private.crm_wake_newsletter_send_worker()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  if new.status = 'scheduled' and (old.status is distinct from 'scheduled') then
    begin
      select decrypted_secret into v_secret
        from vault.decrypted_secrets where name = 'cron_secret' limit 1;
    exception when others then
      v_secret := null;
    end;
    perform net.http_post(
      url := 'https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/newsletter-send-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', coalesce(v_secret, '')
      ),
      body := jsonb_build_object('newsletterId', new.id::text),
      timeout_milliseconds := 20000
    );
  end if;
  return new;
exception when others then
  -- never let a wake-up failure block scheduling
  return new;
end;
$$;

drop trigger if exists crm_newsletters_wake_send_worker on public.crm_newsletters;
create trigger crm_newsletters_wake_send_worker
after insert or update of status on public.crm_newsletters
for each row execute function private.crm_wake_newsletter_send_worker();

-- 4. Read-only worker status for the Newsletters page
create or replace function public.crm_newsletter_worker_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context jsonb := private.relationship_campaign_context(true);
  v_last_start timestamptz;
  v_last_status text;
  v_due integer;
begin
  select max(start_time), (array_agg(status order by start_time desc))[1]
    into v_last_start, v_last_status
  from cron.job_run_details
  where jobname = 'newsletter-send-worker';

  select count(*) into v_due
  from public.crm_newsletters
  where tenant_id = (v_context->>'tenant_id')::uuid
    and status = 'scheduled'
    and scheduled_at <= now();

  return jsonb_build_object(
    'lastRunAt', v_last_start,
    'lastRunStatus', v_last_status,
    'dueNow', v_due
  );
end;
$$;

revoke all on function public.crm_newsletter_worker_status() from public;
grant execute on function public.crm_newsletter_worker_status() to authenticated;