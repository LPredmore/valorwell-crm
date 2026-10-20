-- Add read-only acquisition provenance and allowlisted resume-review evidence to
-- existing staff-authorized, tenant-scoped RPC responses. Keep authorization intact.
CREATE OR REPLACE FUNCTION public.staff_list_provider_applicants(p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant uuid := private.valorwell_current_staff_tenant_id();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.valorwell_require_staff_contract(v_tenant, true);

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item.payload order by item.sort_due nulls last, item.sort_created desc)
      from (
        select
          applicant.next_action_due_at as sort_due,
          applicant.created_at as sort_created,
          jsonb_build_object(
            'id', applicant.id,
            'firstName', applicant.first_name,
            'lastName', applicant.last_name,
            'email', applicant.email,
            'phone', applicant.phone,
            'primaryState', applicant.primary_state,
            'targetStates', to_jsonb(applicant.target_states),
            'licenseType', applicant.license_type,
            'referralSource', applicant.referral_source,
            'status', applicant.status::text,
            'ownerProfileId', applicant.owner_profile_id,
            'ownerName', coalesce(
              nullif(concat_ws(' ', owner_staff.prov_name_f, owner_staff.prov_name_l), ''),
              owner_profile.email
            ),
            'firstContactDueAt', applicant.first_contact_due_at,
            'firstContactedAt', applicant.first_contacted_at,
            'nextAction', applicant.next_action,
            'nextActionDueAt', applicant.next_action_due_at,
            'lastActivityAt', applicant.last_activity_at,
            'source', applicant.source,
            'applicantOrigin', applicant.applicant_origin,
            'convertedStaffId', applicant.converted_staff_id,
            'closedAt', applicant.closed_at,
            'closeReason', applicant.close_reason,
            'version', applicant.version,
            'createdAt', applicant.created_at,
            'followups', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', followup.id,
                  'sequence', followup.followup_sequence,
                  'type', followup.followup_type,
                  'scheduledFor', followup.scheduled_for,
                  'status', followup.status::text,
                  'completedAt', followup.completed_at,
                  'completionNote', followup.completion_note
                )
                order by followup.followup_sequence
              )
              from public.provider_applicant_followups followup
              where followup.applicant_id = applicant.id
            ), '[]'::jsonb),
            'communications', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', job.id,
                  'kind', job.communication_kind,
                  'channel', job.channel,
                  'status', job.status,
                  'scheduledFor', job.scheduled_for,
                  'attemptCount', job.attempt_count,
                  'sentAt', job.sent_at,
                  'errorCode', job.error_code,
                  'errorDetail', job.error_detail
                )
                order by job.created_at
              )
              from public.crm_provider_applicant_communication_jobs job
              where job.applicant_id = applicant.id
            ), '[]'::jsonb)
          ) as payload
        from public.provider_applicants applicant
        left join public.profiles owner_profile
          on owner_profile.id = applicant.owner_profile_id
        left join public.staff owner_staff
          on owner_staff.profile_id = applicant.owner_profile_id
         and owner_staff.tenant_id = applicant.tenant_id
        where applicant.tenant_id = v_tenant
          and (p_status is null or p_status = 'all' or applicant.status::text = p_status)
          and (
            v_search is null
            or concat_ws(' ', applicant.first_name, applicant.last_name) ilike '%' || v_search || '%'
            or applicant.email ilike '%' || v_search || '%'
            or coalesce(applicant.phone, '') ilike '%' || v_search || '%'
          )
        order by applicant.next_action_due_at nulls last, applicant.created_at desc
        limit v_page_size
        offset (v_page - 1) * v_page_size
      ) item
    ), '[]'::jsonb),
    'page', v_page,
    'pageSize', v_page_size,
    'total', (
      select count(*)
      from public.provider_applicants applicant
      where applicant.tenant_id = v_tenant
        and (p_status is null or p_status = 'all' or applicant.status::text = p_status)
        and (
          v_search is null
          or concat_ws(' ', applicant.first_name, applicant.last_name) ilike '%' || v_search || '%'
          or applicant.email ilike '%' || v_search || '%'
          or coalesce(applicant.phone, '') ilike '%' || v_search || '%'
        )
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.staff_get_provider_applicant(p_tenant_id uuid, p_applicant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid; v_applicant jsonb;
begin
  if auth.uid() is null then raise exception 'ROLE_DENIED' using errcode='42501'; end if;
  v_tenant:=private.valorwell_current_staff_tenant_id();
  perform private.valorwell_require_staff_contract(v_tenant,true);
  if v_tenant is null or p_tenant_id is distinct from v_tenant then
    raise exception 'CROSS_TENANT_DENIED' using errcode='42501';
  end if;
  if p_applicant_id is null then raise exception 'APPLICANT_ID_REQUIRED' using errcode='22023'; end if;
  select jsonb_build_object(
    'id',a.id,'firstName',a.first_name,'lastName',a.last_name,'email',a.email,'phone',a.phone,
    'primaryState',a.primary_state,'targetStates',to_jsonb(a.target_states),'licenseType',a.license_type,
    'referralSource',a.referral_source,'status',a.status::text,'ownerProfileId',a.owner_profile_id,
    'ownerName',coalesce(owner_staff.name,owner_profile.email),'firstContactDueAt',a.first_contact_due_at,
    'firstContactedAt',a.first_contacted_at,'nextAction',a.next_action,'nextActionDueAt',a.next_action_due_at,
    'lastActivityAt',a.last_activity_at,'source',a.source,
    'applicantOrigin',a.applicant_origin,
    'resumeReview',jsonb_build_object(
      'filename',a.application_data->>'resume_filename',
      'summary',a.application_data->>'resume_summary',
      'verificationNeeded',coalesce(a.application_data->'verification_needed','[]'::jsonb),
      'credentialVerificationStatus',a.application_data->>'credential_verification_status',
      'indeedConversationEmail',a.application_data->>'indeed_conversation_email',
      'storageStatus',a.application_data->>'resume_storage_status'
    ),
    'convertedStaffId',a.converted_staff_id,
    'closedAt',a.closed_at,'closeReason',a.close_reason,'version',a.version,'createdAt',a.created_at,
    'followups',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'sequence',f.followup_sequence,
      'type',f.followup_type,'scheduledFor',f.scheduled_for,'status',f.status::text,
      'completedAt',f.completed_at,'completionNote',f.completion_note) order by f.followup_sequence,f.id)
      from public.provider_applicant_followups f where f.applicant_id=a.id and f.tenant_id=v_tenant),'[]'::jsonb),
    'communications',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'kind',j.communication_kind,
      'channel',j.channel,'status',j.status,'scheduledFor',j.scheduled_for,'attemptCount',j.attempt_count,
      'sentAt',j.sent_at,'errorCode',j.error_code,'errorDetail',j.error_detail) order by j.created_at,j.id)
      from public.crm_provider_applicant_communication_jobs j where j.applicant_id=a.id and j.tenant_id=v_tenant),'[]'::jsonb)
  ) into v_applicant
  from public.provider_applicants a
  left join public.profiles owner_profile on owner_profile.id=a.owner_profile_id
    and exists(select 1 from public.staff os where os.profile_id=owner_profile.id and os.tenant_id=v_tenant)
  left join lateral (
    select nullif(concat_ws(' ',s.prov_name_f,s.prov_name_l),'') as name
    from public.staff s where s.profile_id=a.owner_profile_id and s.tenant_id=v_tenant order by s.id limit 1
  ) owner_staff on true
  where a.id=p_applicant_id and a.tenant_id=v_tenant;
  -- Foreign and absent IDs return the same authorized null, never another row.
  return jsonb_build_object('contractVersion','staff-provider-applicant.v1','tenantId',v_tenant,'applicant',v_applicant);
end; $function$;
