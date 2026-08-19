-- Exact reassessment for prior AI-only Client Journey findings.
-- Source-linked exception escalation findings remain governed by their exact source exception.

CREATE OR REPLACE FUNCTION public.ai_ops_ingest_client_journey_results(p_tenant_id uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item record;
  v_result jsonb;
  v_client uuid;
  v_snapshot_payload jsonb;
  v_expected_exception_keys text[];
  v_related_exception_keys text[];
  v_assessment_keys text[];
  v_assessment_row jsonb;
  v_expected_ai_finding_keys text[];
  v_related_ai_finding_keys text[];
  v_ai_assessment_keys text[];
  v_ai_assessment_row jsonb;
  v_exception_id uuid;
  v_exception_key text;
  v_assessment text;
  v_rationale text;
  v_ai_finding_id uuid;
  v_ai_finding_key text;
  v_ai_assessment text;
  v_disposition text;
  v_fingerprint text;
  v_finding_id uuid;
  v_upsert_result jsonb;
  v_evidence jsonb;
  v_clients_reviewed integer := 0;
  v_unmatched integer := 0;
  v_exception_assessments integer := 0;
  v_prior_ai_assessments integer := 0;
  v_prior_ai_confirmed integer := 0;
  v_prior_ai_resolved integer := 0;
  v_stable_existing_clients integer := 0;
  v_escalating_existing_clients integer := 0;
  v_appears_resolved_clients integer := 0;
  v_existing_ai_clients integer := 0;
  v_new_concern_clients integer := 0;
  v_no_concern_clients_count integer := 0;
  v_findings_upserted integer := 0;
  v_stale_resolved integer := 0;
  v_reviewed_clients uuid[] := '{}'::uuid[];
  v_escalated_exception_ids uuid[] := '{}'::uuid[];
  v_stale record;
  v_source_active boolean;
  v_client_reviewed boolean;
  v_exception_escalated boolean;
  v_event_type text;
  v_reason text;
begin
  if not private.valorwell_is_service_role() then
    raise exception 'AI Operations worker functions require the service role.' using errcode = '42501';
  end if;

  for v_item in
    select w.id, w.structured_result
    from private.ai_ops_work_items w
    where w.tenant_id = p_tenant_id and w.run_id = p_run_id
      and w.module = 'client_journey' and w.status = 'completed'
  loop
    for v_result in select value from jsonb_array_elements(coalesce(v_item.structured_result->'results', '[]'::jsonb)) loop
      v_client := null;
      v_snapshot_payload := null;
      select s.entity_id::uuid, s.payload
        into v_client, v_snapshot_payload
      from private.ai_ops_snapshots s
      where s.tenant_id = p_tenant_id
        and s.snapshot_type = 'client_journey:' || p_run_id::text
        and s.snapshot_hash = v_result->>'entityKey'
      limit 1;

      if v_client is null then
        v_unmatched := v_unmatched + 1;
        continue;
      end if;

      select coalesce(array_agg(x->>'exceptionKey' order by x->>'exceptionKey'), '{}'::text[])
        into v_expected_exception_keys
      from jsonb_array_elements(coalesce(v_snapshot_payload->'activeExceptions', '[]'::jsonb)) x;

      select coalesce(array_agg(value order by value), '{}'::text[])
        into v_related_exception_keys
      from jsonb_array_elements_text(coalesce(v_result->'relatedExceptionKeys', '[]'::jsonb));

      select coalesce(array_agg(x->>'exceptionKey' order by x->>'exceptionKey'), '{}'::text[])
        into v_assessment_keys
      from jsonb_array_elements(coalesce(v_result->'exceptionAssessments', '[]'::jsonb)) x;

      select coalesce(array_agg(x->>'findingKey' order by x->>'findingKey'), '{}'::text[])
        into v_expected_ai_finding_keys
      from jsonb_array_elements(coalesce(v_snapshot_payload->'activeAiFindings', '[]'::jsonb)) x;

      select coalesce(array_agg(value order by value), '{}'::text[])
        into v_related_ai_finding_keys
      from jsonb_array_elements_text(coalesce(v_result->'relatedAiFindingKeys', '[]'::jsonb));

      select coalesce(array_agg(x->>'findingKey' order by x->>'findingKey'), '{}'::text[])
        into v_ai_assessment_keys
      from jsonb_array_elements(coalesce(v_result->'priorAiFindingAssessments', '[]'::jsonb)) x;

      if cardinality(v_related_exception_keys) <> cardinality(array(select distinct unnest(v_related_exception_keys))) then
        raise exception 'Client Journey AI result contains duplicate related exception keys for entity %.', v_result->>'entityKey';
      end if;
      if cardinality(v_assessment_keys) <> cardinality(array(select distinct unnest(v_assessment_keys)))
         or cardinality(v_assessment_keys) <> cardinality(v_expected_exception_keys)
         or exists (select 1 from unnest(v_assessment_keys) k where not (k = any(v_expected_exception_keys)))
         or exists (select 1 from unnest(v_expected_exception_keys) k where not (k = any(v_assessment_keys))) then
        raise exception 'Client Journey AI result exception assessments do not exactly cover supplied active exceptions for entity %.', v_result->>'entityKey';
      end if;
      if exists (select 1 from unnest(v_related_exception_keys) k where not (k = any(v_expected_exception_keys))) then
        raise exception 'Client Journey AI result references an exception key that was not supplied for entity %.', v_result->>'entityKey';
      end if;

      if cardinality(v_related_ai_finding_keys) <> cardinality(array(select distinct unnest(v_related_ai_finding_keys))) then
        raise exception 'Client Journey AI result contains duplicate related AI finding keys for entity %.', v_result->>'entityKey';
      end if;
      if cardinality(v_ai_assessment_keys) <> cardinality(array(select distinct unnest(v_ai_assessment_keys)))
         or cardinality(v_ai_assessment_keys) <> cardinality(v_expected_ai_finding_keys)
         or exists (select 1 from unnest(v_ai_assessment_keys) k where not (k = any(v_expected_ai_finding_keys)))
         or exists (select 1 from unnest(v_expected_ai_finding_keys) k where not (k = any(v_ai_assessment_keys))) then
        raise exception 'Client Journey AI result prior-AI assessments do not exactly cover supplied active AI findings for entity %.', v_result->>'entityKey';
      end if;
      if exists (select 1 from unnest(v_related_ai_finding_keys) k where not (k = any(v_expected_ai_finding_keys))) then
        raise exception 'Client Journey AI result references a prior AI finding key that was not supplied for entity %.', v_result->>'entityKey';
      end if;

      v_disposition := coalesce(v_result->>'concernDisposition','none');
      if v_disposition in ('stable_existing','escalating_existing','appears_resolved_existing')
         and cardinality(v_related_exception_keys) = 0 then
        raise exception 'Client Journey AI result marked an existing source concern without an exact related exception key for entity %.', v_result->>'entityKey';
      end if;
      if v_disposition = 'existing_ai_concern'
         and cardinality(v_related_ai_finding_keys) = 0 then
        raise exception 'Client Journey AI result marked an existing AI concern without an exact related AI finding key for entity %.', v_result->>'entityKey';
      end if;
      if v_disposition in ('none','new_concern')
         and (cardinality(v_related_exception_keys) > 0 or cardinality(v_related_ai_finding_keys) > 0) then
        raise exception 'Client Journey AI result returned existing-concern keys for disposition % on entity %.', v_disposition, v_result->>'entityKey';
      end if;
      if v_disposition in ('stable_existing','escalating_existing','appears_resolved_existing')
         and cardinality(v_related_ai_finding_keys) > 0 then
        raise exception 'Client Journey AI source-exception disposition also referenced prior AI findings for entity %.', v_result->>'entityKey';
      end if;
      if v_disposition = 'existing_ai_concern' and cardinality(v_related_exception_keys) > 0 then
        raise exception 'Client Journey AI prior-finding disposition also referenced source exceptions for entity %.', v_result->>'entityKey';
      end if;
      if coalesce((v_result->>'noConcern')::boolean,false) and v_disposition <> 'none' then
        raise exception 'Client Journey AI result combined noConcern=true with concernDisposition=% for entity %.', v_disposition, v_result->>'entityKey';
      end if;
      if v_disposition = 'escalating_existing'
         and not exists (
           select 1 from jsonb_array_elements(coalesce(v_result->'exceptionAssessments','[]'::jsonb)) a
           where a->>'assessment' = 'escalating'
             and a->>'exceptionKey' = any(v_related_exception_keys)
         ) then
        raise exception 'Client Journey AI result marked escalating_existing without an escalating related exception assessment for entity %.', v_result->>'entityKey';
      end if;
      if v_disposition in ('none','stable_existing','appears_resolved_existing')
         and exists (
           select 1 from jsonb_array_elements(coalesce(v_result->'exceptionAssessments','[]'::jsonb)) a
           where a->>'assessment' = 'escalating'
         ) then
        raise exception 'Client Journey AI result contains an escalating exception assessment inconsistent with concernDisposition=% for entity %.', v_disposition, v_result->>'entityKey';
      end if;
      if v_disposition = 'existing_ai_concern'
         and not exists (
           select 1 from jsonb_array_elements(coalesce(v_result->'priorAiFindingAssessments','[]'::jsonb)) a
           where a->>'assessment' = 'still_present'
             and a->>'findingKey' = any(v_related_ai_finding_keys)
         ) then
        raise exception 'Client Journey AI result marked existing_ai_concern without a still-present related prior AI finding for entity %.', v_result->>'entityKey';
      end if;
      if coalesce((v_result->>'noConcern')::boolean,false)
         and exists (
           select 1 from jsonb_array_elements(coalesce(v_result->'priorAiFindingAssessments','[]'::jsonb)) a
           where a->>'assessment' = 'still_present'
         ) then
        raise exception 'Client Journey AI result combined noConcern=true with a still-present prior AI finding for entity %.', v_result->>'entityKey';
      end if;

      v_clients_reviewed := v_clients_reviewed + 1;
      if not (v_client = any(v_reviewed_clients)) then
        v_reviewed_clients := array_append(v_reviewed_clients, v_client);
      end if;

      if coalesce((v_result->>'noConcern')::boolean,false) then
        v_no_concern_clients_count := v_no_concern_clients_count + 1;
      elsif v_disposition = 'stable_existing' then
        v_stable_existing_clients := v_stable_existing_clients + 1;
      elsif v_disposition = 'escalating_existing' then
        v_escalating_existing_clients := v_escalating_existing_clients + 1;
      elsif v_disposition = 'appears_resolved_existing' then
        v_appears_resolved_clients := v_appears_resolved_clients + 1;
      elsif v_disposition = 'existing_ai_concern' then
        v_existing_ai_clients := v_existing_ai_clients + 1;
      elsif v_disposition = 'new_concern' then
        v_new_concern_clients := v_new_concern_clients + 1;
      end if;

      for v_assessment_row in
        select value from jsonb_array_elements(coalesce(v_result->'exceptionAssessments','[]'::jsonb))
      loop
        v_exception_key := v_assessment_row->>'exceptionKey';
        v_assessment := v_assessment_row->>'assessment';
        v_rationale := left(coalesce(v_assessment_row->>'rationale',''),1000);
        v_exception_id := null;

        select e.id into v_exception_id
        from public.client_journey_exceptions e
        where e.tenant_id = p_tenant_id
          and e.client_id = v_client
          and private.ai_ops_client_journey_exception_key(e.id) = v_exception_key
        limit 1;

        if v_exception_id is null then
          raise exception 'Client Journey AI result exception key could not be mapped to its exact source record for entity %.', v_result->>'entityKey';
        end if;

        v_exception_assessments := v_exception_assessments + 1;

        if v_assessment = 'escalating' then
          if not (v_exception_id = any(v_escalated_exception_ids)) then
            v_escalated_exception_ids := array_append(v_escalated_exception_ids, v_exception_id);
          end if;

          v_fingerprint := 'client_journey:exception_escalation:' || v_exception_id::text;
          v_evidence := jsonb_build_array(jsonb_build_object(
            'sourceType','client_journey_exception',
            'exceptionKey',v_exception_key,
            'assessment','escalating',
            'rationale',v_rationale
          ));

          v_upsert_result := public.ai_ops_upsert_finding(
            p_tenant_id, p_run_id, 'client_journey', v_fingerprint,
            left(coalesce(v_result->>'title','Client journey exception escalated'),300),
            coalesce(nullif(v_result->>'severity',''),'medium')::public.ai_ops_severity_enum,
            left(coalesce(v_result->>'summary',''),2000),
            left(coalesce(v_result->>'recommendedAction',''),1000),
            'client', v_client::text,
            nullif(v_result->>'confidence','')::numeric,
            v_exception_id,
            v_evidence
          );
          v_finding_id := nullif(v_upsert_result->>'findingId','')::uuid;
          if v_finding_id is null then
            raise exception 'Client Journey AI exception escalation upsert did not return a finding id.';
          end if;

          update public.ai_operations_findings
             set related_existing_exception_id = v_exception_id,
                 updated_at = now()
           where id = v_finding_id and tenant_id = p_tenant_id;

          delete from private.ai_ops_client_journey_finding_exception_links
          where finding_id = v_finding_id and exception_id <> v_exception_id;

          insert into private.ai_ops_client_journey_finding_exception_links (
            finding_id, tenant_id, client_id, exception_id, exception_key,
            assessment, rationale, first_seen_run_id, last_seen_run_id, last_seen_at
          ) values (
            v_finding_id, p_tenant_id, v_client, v_exception_id, v_exception_key,
            'escalating', v_rationale, p_run_id, p_run_id, now()
          )
          on conflict (finding_id, exception_id) do update
            set exception_key = excluded.exception_key,
                assessment = excluded.assessment,
                rationale = excluded.rationale,
                last_seen_run_id = excluded.last_seen_run_id,
                last_seen_at = now();

          v_findings_upserted := v_findings_upserted + 1;
        end if;
      end loop;

      for v_ai_assessment_row in
        select value from jsonb_array_elements(coalesce(v_result->'priorAiFindingAssessments','[]'::jsonb))
      loop
        v_ai_finding_key := v_ai_assessment_row->>'findingKey';
        v_ai_assessment := v_ai_assessment_row->>'assessment';
        v_rationale := left(coalesce(v_ai_assessment_row->>'rationale',''),1000);
        v_ai_finding_id := null;

        select f.id into v_ai_finding_id
        from public.ai_operations_findings f
        where f.tenant_id = p_tenant_id
          and f.module = 'client_journey'
          and f.entity_type = 'client'
          and f.entity_id = v_client::text
          and f.related_existing_exception_id is null
          and f.status in ('open','snoozed')
          and 'a' || left(md5(f.id::text),12) = v_ai_finding_key
        limit 1;

        if v_ai_finding_id is null then
          raise exception 'Client Journey AI prior finding key could not be mapped to its exact active finding for entity %.', v_result->>'entityKey';
        end if;

        v_prior_ai_assessments := v_prior_ai_assessments + 1;
        if v_ai_assessment = 'still_present' then
          update public.ai_operations_findings
             set last_seen_at = now(),
                 last_run_id = p_run_id,
                 occurrence_count = coalesce(occurrence_count,0) + 1,
                 last_occurrence_date = (now() at time zone 'America/Chicago')::date,
                 updated_at = now()
           where id = v_ai_finding_id;
          v_prior_ai_confirmed := v_prior_ai_confirmed + 1;
        elsif v_ai_assessment = 'appears_resolved' then
          update public.ai_operations_findings
             set status='resolved',
                 resolved_at=now(),
                 snoozed_until=null,
                 last_run_id=p_run_id,
                 updated_at=now()
           where id=v_ai_finding_id;
          insert into public.ai_operations_finding_events(
            finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason
          ) values (
            v_ai_finding_id,p_tenant_id,'reassessment_resolved','system',
            jsonb_build_object('status','open_or_snoozed'),
            jsonb_build_object('status','resolved','runId',p_run_id),
            'A complete current Client Journey review explicitly assessed this exact prior AI finding as no longer supported. ' || v_rationale
          );
          v_prior_ai_resolved := v_prior_ai_resolved + 1;
        end if;
      end loop;

      if not coalesce((v_result->>'noConcern')::boolean,false)
         and v_disposition = 'new_concern' then
        v_fingerprint := 'client_journey:new:' || v_client::text || ':' || coalesce(nullif(v_result->>'concernType',''),'unspecified');

        v_upsert_result := public.ai_ops_upsert_finding(
          p_tenant_id, p_run_id, 'client_journey', v_fingerprint,
          left(coalesce(v_result->>'title','Client journey concern'),300),
          coalesce(nullif(v_result->>'severity',''),'medium')::public.ai_ops_severity_enum,
          left(coalesce(v_result->>'summary',''),2000),
          left(coalesce(v_result->>'recommendedAction',''),1000),
          'client', v_client::text,
          nullif(v_result->>'confidence','')::numeric,
          null,
          jsonb_build_array(jsonb_build_object(
            'sourceType','client_journey_ai_review',
            'concernType',coalesce(v_result->>'concernType','unspecified'),
            'supportingSignals',coalesce(v_result->'supportingSignals','[]'::jsonb)
          ))
        );
        v_finding_id := nullif(v_upsert_result->>'findingId','')::uuid;
        if v_finding_id is null then
          raise exception 'Client Journey AI new concern upsert did not return a finding id.';
        end if;
        update public.ai_operations_findings
           set related_existing_exception_id = null,
               updated_at = now()
         where id = v_finding_id and tenant_id = p_tenant_id;
        delete from private.ai_ops_client_journey_finding_exception_links where finding_id = v_finding_id;
        v_findings_upserted := v_findings_upserted + 1;
      end if;
    end loop;
  end loop;

  for v_stale in
    select f.id, f.status, f.fingerprint, f.entity_id, f.related_existing_exception_id
    from public.ai_operations_findings f
    where f.tenant_id = p_tenant_id
      and f.module = 'client_journey'
      and f.status in ('open','snoozed')
      and f.fingerprint like 'client_journey:exception_escalation:%'
  loop
    select exists (
      select 1 from public.client_journey_exceptions e
      where e.id = v_stale.related_existing_exception_id
        and e.tenant_id = p_tenant_id
        and e.resolution_state in ('open','in_progress')
    ) into v_source_active;

    select exists (
      select 1 from unnest(v_reviewed_clients) c where c::text = v_stale.entity_id
    ) into v_client_reviewed;

    v_exception_escalated := v_stale.related_existing_exception_id is not null
      and v_stale.related_existing_exception_id = any(v_escalated_exception_ids);

    if not v_source_active then
      v_event_type := 'deterministically_resolved';
      v_reason := 'The exact source Client Journey exception is no longer active.';
    elsif v_client_reviewed and not v_exception_escalated then
      v_event_type := 'reassessment_resolved';
      v_reason := 'A complete current Client Journey review explicitly assessed the exact active exception as no longer escalating.';
    else
      continue;
    end if;

    update public.ai_operations_findings
       set status='resolved', resolved_at=now(), snoozed_until=null,
           last_run_id=p_run_id, updated_at=now()
     where id=v_stale.id;
    insert into public.ai_operations_finding_events(
      finding_id,tenant_id,event_type,actor_kind,previous_value,new_value,reason
    ) values (
      v_stale.id,p_tenant_id,v_event_type,'system',
      jsonb_build_object('status',v_stale.status),
      jsonb_build_object('status','resolved','runId',p_run_id),
      v_reason
    );
    v_stale_resolved := v_stale_resolved + 1;
  end loop;

  update public.ai_operations_module_runs m
     set coverage = coalesce(m.coverage,'{}'::jsonb) || jsonb_build_object(
           'geminiReviewed',v_clients_reviewed,
           'exceptionAssessments',v_exception_assessments,
           'priorAiFindingAssessments',v_prior_ai_assessments,
           'priorAiFindingsConfirmed',v_prior_ai_confirmed,
           'priorAiFindingsResolved',v_prior_ai_resolved,
           'aiEscalatedExceptions',cardinality(v_escalated_exception_ids),
           'stableExistingClients',v_stable_existing_clients,
           'escalatingExistingClients',v_escalating_existing_clients,
           'appearsResolvedExistingClients',v_appears_resolved_clients,
           'existingAiConcernClients',v_existing_ai_clients,
           'newAiConcernClients',v_new_concern_clients,
           'explicitNoConcernClients',v_no_concern_clients_count,
           'clientJourneyFindingsUpserted',v_findings_upserted,
           'staleClientJourneyFindingsResolved',v_stale_resolved + v_prior_ai_resolved
         ),
         updated_at = now()
   where m.run_id = p_run_id and m.tenant_id = p_tenant_id and m.module = 'client_journey';

  return jsonb_build_object(
    'clientsReviewed',v_clients_reviewed,
    'exceptionAssessments',v_exception_assessments,
    'priorAiFindingAssessments',v_prior_ai_assessments,
    'priorAiFindingsConfirmed',v_prior_ai_confirmed,
    'priorAiFindingsResolved',v_prior_ai_resolved,
    'aiEscalatedExceptions',cardinality(v_escalated_exception_ids),
    'stableExistingClients',v_stable_existing_clients,
    'escalatingExistingClients',v_escalating_existing_clients,
    'appearsResolvedExistingClients',v_appears_resolved_clients,
    'existingAiConcernClients',v_existing_ai_clients,
    'newAiConcernClients',v_new_concern_clients,
    'explicitNoConcernClients',v_no_concern_clients_count,
    'findingsUpserted',v_findings_upserted,
    'staleFindingsResolved',v_stale_resolved + v_prior_ai_resolved,
    'unmatchedResults',v_unmatched
  );
end;
$function$;
