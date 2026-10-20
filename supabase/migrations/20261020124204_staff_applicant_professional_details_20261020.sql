-- Expose clinician license/contact screening evidence via the existing tenant-checked staff endpoint.
-- Review items are applicant-supplied claims, never source-of-truth credential verification.
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
      'summary',a.application_data->>'resume_summary',
      'reportedLicenseType',a.application_data->>'reported_license_type',
      'reportedLicensedStates',coalesce(a.application_data->'reported_licensed_states','[]'::jsonb),
      'licenseStatesToVerify',coalesce(a.application_data->'license_states_to_verify','[]'::jsonb),
      'licenseStateEvidence',a.application_data->>'license_state_evidence',
      'clinicalHighlights',coalesce(a.application_data->'clinical_highlights','[]'::jsonb),
      'verificationNeeded',coalesce(a.application_data->'verification_needed','[]'::jsonb),
      'credentialVerificationStatus',a.application_data->>'credential_verification_status',
      'indeedConversationEmail',a.application_data->>'indeed_conversation_email'
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