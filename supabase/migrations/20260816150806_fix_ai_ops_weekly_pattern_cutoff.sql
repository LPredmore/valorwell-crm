CREATE OR REPLACE FUNCTION public.ai_ops_ingest_weekly_patterns(p_tenant_id uuid, p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_date date;v_source_cutoff_at timestamptz;v_result jsonb;v_count int:=0;v_pattern jsonb;v_sev public.ai_ops_severity_enum;v_key text;
begin
 if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
 select business_date,source_cutoff_at into v_date,v_source_cutoff_at from public.ai_operations_runs where id=p_run_id and tenant_id=p_tenant_id;
 select structured_result into v_result from private.ai_ops_work_items where tenant_id=p_tenant_id and run_id=p_run_id and module='weekly_patterns' and work_type='weekly_pattern_review' and status='completed' order by completed_at desc limit 1;
 if v_result is null then return jsonb_build_object('status','pending','reviewsIngested',0);end if;
 insert into public.ai_operations_weekly_reviews(tenant_id,run_id,week_ending,structured_result) values(p_tenant_id,p_run_id,v_date,v_result) on conflict(tenant_id,week_ending) do update set run_id=excluded.run_id,structured_result=excluded.structured_result,updated_at=now();
 for v_pattern in select value from jsonb_array_elements(coalesce(v_result->'patterns','[]'::jsonb)) loop
   v_sev:=coalesce(nullif(v_pattern->>'severity',''),'medium')::public.ai_ops_severity_enum;
   if v_sev in('critical','high') then v_key:=md5(coalesce(v_pattern->>'title','')||v_date::text);perform public.ai_ops_upsert_finding(p_tenant_id,p_run_id,'weekly_patterns','weekly_pattern:'||v_key,left(coalesce(v_pattern->>'title','Weekly operational pattern'),300),v_sev,left(coalesce(v_pattern->>'summary',''),2000),left(coalesce(v_pattern->>'recommendedAction',''),1000),'weekly_pattern',v_key,nullif(v_pattern->>'confidence','')::numeric,null,jsonb_build_array(jsonb_build_object('sourceType','ai_operations_history','sourceRecordId',v_date::text,'sourceTimestamp',v_source_cutoff_at,'excerpt',left(coalesce(v_pattern->>'summary',''),500),'evidenceHash',md5(v_pattern::text))));end if;v_count:=v_count+1;
 end loop;
 return jsonb_build_object('reviewsIngested',1,'patternsIngested',v_count);
end;$function$;
