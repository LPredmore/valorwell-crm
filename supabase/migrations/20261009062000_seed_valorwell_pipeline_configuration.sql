-- ValorWell's initial pipelines are DATA created through the exact same
-- configurable crm_pipelines, crm_pipeline_stages and crm_pipeline_fields
-- tables that tenant admins use. This seed never alters existing source status
-- enums, clinical records or business-development opportunities.
do $seed$
declare v_tenant uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_actor uuid;
  v_spec jsonb;
  v_stage jsonb;
  v_field jsonb;
  v_pipeline uuid;
  v_id uuid;
  v_cards text[];
  v_sorts text[];
begin
  select profile_id into v_actor from public.crm_user_capabilities
   where tenant_id=v_tenant and crm_role::text='crm_admin' order by granted_at limit 1;
  if v_actor is null then raise exception 'CRM_ADMIN_REQUIRED_FOR_PIPELINE_INITIALIZATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||':crm_pipeline_initial_seed',0));
  for v_spec in select value from jsonb_array_elements('[{"name":"Prospective Clinicians","subject_type":"person","source_mode":"connected","source_key":"provider_applicants","stages":[{"name":"Identified","position":0,"source_stage_key":"new","is_terminal":false},{"name":"Contacted","position":1,"source_stage_key":"contacted","is_terminal":false},{"name":"Interested","position":2,"source_stage_key":"website_new","is_terminal":false},{"name":"Screening","position":3,"source_stage_key":"screening","is_terminal":false},{"name":"Application","position":4,"source_stage_key":"application","is_terminal":false},{"name":"Approved","position":5,"source_stage_key":"ready","is_terminal":false}],"fields":[{"label":"License type","field_key":"license_type","field_type":"text","show_on_card":true,"allow_sort":true,"position":0,"options":[]},{"label":"State","field_key":"primary_state","field_type":"text","show_on_card":true,"allow_sort":true,"position":1,"options":[]},{"label":"Recruitment source","field_key":"source","field_type":"text","show_on_card":false,"allow_sort":true,"position":2,"options":[]}]},{"name":"Hired Clinicians","subject_type":"person","source_mode":"connected","source_key":"staff","stages":[{"name":"Invited","position":0,"source_stage_key":"Invited","is_terminal":false},{"name":"New","position":1,"source_stage_key":"New","is_terminal":false},{"name":"Active","position":2,"source_stage_key":"Active","is_terminal":false},{"name":"Inactive","position":3,"source_stage_key":"Inactive","is_terminal":false}],"fields":[{"label":"Specialty","field_key":"prov_field","field_type":"text","show_on_card":true,"allow_sort":true,"position":0,"options":[]},{"label":"State","field_key":"prov_state","field_type":"text","show_on_card":true,"allow_sort":true,"position":1,"options":[]}]},{"name":"Clients","subject_type":"person","source_mode":"connected","source_key":"clients","stages":[{"name":"Registration","position":0,"source_stage_key":"registration","is_terminal":false},{"name":"Intake","position":1,"source_stage_key":"intake","is_terminal":false},{"name":"Matching","position":2,"source_stage_key":"matching","is_terminal":false},{"name":"Matched","position":3,"source_stage_key":"matched","is_terminal":false},{"name":"Scheduled","position":4,"source_stage_key":"scheduled","is_terminal":false},{"name":"Early Care","position":5,"source_stage_key":"early_care","is_terminal":false},{"name":"Established Care","position":6,"source_stage_key":"established_care","is_terminal":false},{"name":"Closed","position":7,"source_stage_key":"closed","is_terminal":true}],"fields":[{"label":"Client status","field_key":"pat_status","field_type":"text","show_on_card":true,"allow_sort":true,"position":0,"options":[]}]},{"name":"Donors","subject_type":"person","source_mode":"manual","source_key":null,"stages":[{"name":"Identified","position":0,"source_stage_key":null,"is_terminal":false},{"name":"Research","position":1,"source_stage_key":null,"is_terminal":false},{"name":"Contacted","position":2,"source_stage_key":null,"is_terminal":false},{"name":"Interested","position":3,"source_stage_key":null,"is_terminal":false},{"name":"Asked","position":4,"source_stage_key":null,"is_terminal":false},{"name":"Pledged","position":5,"source_stage_key":null,"is_terminal":false},{"name":"Donated","position":6,"source_stage_key":null,"is_terminal":false},{"name":"Stewardship","position":7,"source_stage_key":null,"is_terminal":true}],"fields":[{"label":"Donor type","field_key":"donor_type","field_type":"select","show_on_card":true,"allow_sort":true,"position":0,"options":["Prospective","One-time","Recurring","Lapsed"]},{"label":"Lifetime giving","field_key":"lifetime_amount","field_type":"currency","show_on_card":true,"allow_sort":true,"position":1,"options":[]},{"label":"Last gift","field_key":"last_donation_at","field_type":"date","show_on_card":true,"allow_sort":true,"position":2,"options":[]},{"label":"Organization","field_key":"organization","field_type":"text","show_on_card":false,"allow_sort":true,"position":3,"options":[]}]},{"name":"Beyond The Yellow","subject_type":"organization","source_mode":"connected","source_key":"relationship_opportunities","stages":[{"name":"Identified","position":0,"source_stage_key":"identified","is_terminal":false},{"name":"Researching","position":1,"source_stage_key":"researching","is_terminal":false},{"name":"Qualified","position":2,"source_stage_key":"qualified","is_terminal":false},{"name":"Ready for Campaign","position":3,"source_stage_key":"ready_for_campaign","is_terminal":false},{"name":"Contacted","position":4,"source_stage_key":"contacted","is_terminal":false},{"name":"Responded","position":5,"source_stage_key":"responded","is_terminal":false},{"name":"Interested","position":6,"source_stage_key":"interested","is_terminal":false},{"name":"Recording Planned","position":7,"source_stage_key":"recording_planned","is_terminal":false},{"name":"Booked","position":8,"source_stage_key":"booked","is_terminal":false},{"name":"Declined","position":9,"source_stage_key":"declined","is_terminal":true},{"name":"Nurture","position":10,"source_stage_key":"nurture","is_terminal":false},{"name":"Disqualified","position":11,"source_stage_key":"disqualified","is_terminal":true},{"name":"Completed","position":12,"source_stage_key":"completed","is_terminal":true}],"fields":[{"label":"Cause area","field_key":"cause_area","field_type":"text","show_on_card":true,"allow_sort":true,"position":0,"options":[]},{"label":"Veteran priority","field_key":"veteran_priority","field_type":"boolean","show_on_card":false,"allow_sort":true,"position":1,"options":[]}]},{"name":"Institutional Recruiting","subject_type":"organization","source_mode":"manual","source_key":null,"stages":[{"name":"Identified","position":0,"source_stage_key":null,"is_terminal":false},{"name":"Contacted","position":1,"source_stage_key":null,"is_terminal":false},{"name":"Established","position":2,"source_stage_key":null,"is_terminal":false},{"name":"Declined","position":3,"source_stage_key":null,"is_terminal":true}],"fields":[{"label":"State","field_key":"state_code","field_type":"text","show_on_card":true,"allow_sort":true,"position":0,"options":[]},{"label":"Organization type","field_key":"organization_type","field_type":"text","show_on_card":true,"allow_sort":true,"position":1,"options":[]},{"label":"Specific office","field_key":"specific_office","field_type":"text","show_on_card":false,"allow_sort":true,"position":2,"options":[]},{"label":"Website","field_key":"website","field_type":"url","show_on_card":false,"allow_sort":false,"position":3,"options":[]}]},{"name":"VA Medical Centers","subject_type":"organization","source_mode":"manual","source_key":null,"stages":[{"name":"Identified","position":0,"source_stage_key":null,"is_terminal":false},{"name":"Contacted","position":1,"source_stage_key":null,"is_terminal":false},{"name":"Responded","position":2,"source_stage_key":null,"is_terminal":false},{"name":"Referral Process Established","position":3,"source_stage_key":null,"is_terminal":false},{"name":"Referrals Received","position":4,"source_stage_key":null,"is_terminal":true},{"name":"Declined","position":5,"source_stage_key":null,"is_terminal":true}],"fields":[{"label":"VISN","field_key":"visn","field_type":"number","show_on_card":true,"allow_sort":true,"position":0,"options":[]},{"label":"Station","field_key":"station_number","field_type":"text","show_on_card":true,"allow_sort":true,"position":1,"options":[]},{"label":"State","field_key":"state","field_type":"text","show_on_card":true,"allow_sort":true,"position":2,"options":[]},{"label":"Referral contact role","field_key":"contact_role","field_type":"text","show_on_card":false,"allow_sort":true,"position":3,"options":[]}]}]'::jsonb) loop
    select id into v_pipeline from public.crm_pipelines
       where tenant_id=v_tenant and name=v_spec->>'name' and archived_at is null;
    if v_pipeline is null then
      insert into public.crm_pipelines(tenant_id,name,subject_type,source_mode,source_key,created_by,
          card_field_keys,sort_field_keys)
        values(v_tenant,v_spec->>'name',v_spec->>'subject_type',v_spec->>'source_mode',
          v_spec->>'source_key',v_actor,array[]::text[],array['updated_at']::text[])
        returning id into v_pipeline;
    else
      if (select subject_type from public.crm_pipelines where id=v_pipeline) is distinct from v_spec->>'subject_type'
          or (select source_mode from public.crm_pipelines where id=v_pipeline) is distinct from v_spec->>'source_mode'
        then raise exception 'INITIAL_PIPELINE_CONFLICT: %',v_spec->>'name'; end if;
    end if;
    for v_stage in select value from jsonb_array_elements(v_spec->'stages') loop
      if not exists(select 1 from public.crm_pipeline_stages
        where pipeline_id=v_pipeline and name=v_stage->>'name') then
        insert into public.crm_pipeline_stages(tenant_id,pipeline_id,name,position,source_stage_key,is_terminal)
          values(v_tenant,v_pipeline,v_stage->>'name',(v_stage->>'position')::integer,
            v_stage->>'source_stage_key',(v_stage->>'is_terminal')::boolean);
      end if;
    end loop;
    for v_field in select value from jsonb_array_elements(v_spec->'fields') loop
      if not exists(select 1 from public.crm_pipeline_fields
          where pipeline_id=v_pipeline and field_key=v_field->>'field_key') then
        insert into public.crm_pipeline_fields(tenant_id,pipeline_id,field_key,label,field_type,options,
            show_on_card,allow_sort,position)
          values(v_tenant,v_pipeline,v_field->>'field_key',v_field->>'label',v_field->>'field_type',
            v_field->'options',(v_field->>'show_on_card')::boolean,(v_field->>'allow_sort')::boolean,
            (v_field->>'position')::integer);
      end if;
    end loop;
    select coalesce(array_agg(field_key order by position) filter(where show_on_card),array[]::text[]),
      array['updated_at']::text[] || coalesce(array_agg(field_key order by position)
      filter(where allow_sort),array[]::text[])
       into v_cards,v_sorts
     from public.crm_pipeline_fields where tenant_id=v_tenant and pipeline_id=v_pipeline;
    -- Only initialize display preferences if they have never been customized.
    update public.crm_pipelines set
      card_field_keys=case when card_field_keys=array[]::text[] then v_cards else card_field_keys end,
      sort_field_keys=case when sort_field_keys=array['updated_at']::text[] then v_sorts else sort_field_keys end
      where id=v_pipeline;
    v_pipeline:=null;
  end loop;
end;
$seed$;
