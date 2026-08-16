create or replace function public.ai_ops_build_relationship_followup_batches(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now(),p_batch_size integer default 6) returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_row record;v_entities jsonb:='[]'::jsonb;v_payload jsonb;v_signals text[];v_key text;v_batch int:=0;v_seen int:=0;v_queued int:=0;v_batch_size int:=least(greatest(coalesce(p_batch_size,6),3),8);
begin if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
for v_row in select * from (
 select 'reply'::text entity_type,q.id::text entity_id,q.received_at source_at,q.follow_up_due_at due_at,q.status,q.body excerpt,q.organization_id,q.contact_id,q.opportunity_id,q.owner_profile_id
 from public.relationship_reply_queue_v q where q.tenant_id=p_tenant_id and q.resolved_at is null
 union all
 select 'opportunity',o.id::text,o.updated_at,o.next_action_due_at,o.status,o.next_action,o.organization_id,o.primary_contact_id,o.id,o.owner_profile_id
 from public.relationship_opportunities o where o.tenant_id=p_tenant_id and o.closed_at is null and o.next_action_due_at is not null and o.next_action_due_at<=p_cutoff_at
 union all
 select 'contact',c.id::text,c.updated_at,c.next_action_due_at,c.outreach_status,c.next_action,null::uuid,c.id,null::uuid,c.owner_profile_id
 from public.relationship_contacts c where c.tenant_id=p_tenant_id and not c.do_not_contact and c.next_action_due_at is not null and c.next_action_due_at<=p_cutoff_at
 union all
 select 'organization',o.id::text,o.updated_at,o.next_action_due_at,o.outreach_status,o.next_action,o.id,null::uuid,null::uuid,o.owner_profile_id
 from public.relationship_organizations o where o.tenant_id=p_tenant_id and not o.do_not_contact and o.next_action_due_at is not null and o.next_action_due_at<=p_cutoff_at
) x order by due_at nulls last,source_at loop
 v_seen:=v_seen+1;v_signals:='{}'::text[];
 if v_row.entity_type='reply' then v_signals:=array_append(v_signals,'inboundRelationshipReplyNeedsReview');end if;
 if v_row.due_at is not null and v_row.due_at<p_cutoff_at then v_signals:=array_append(v_signals,'followUpOverdue');end if;
 if v_row.due_at is not null and v_row.due_at<p_cutoff_at-interval '3 days' then v_signals:=array_append(v_signals,'followUpOverdueMoreThanThreeDays');end if;
 if v_row.owner_profile_id is null then v_signals:=array_append(v_signals,'noOwnerAssigned');end if;
 v_key:='rf'||left(md5(v_row.entity_type||v_row.entity_id||p_run_id::text),12);
 v_payload:=jsonb_build_object('entityKey',v_key,'recordType',v_row.entity_type,'status',v_row.status,'ageHours',case when v_row.source_at is null then null else floor(extract(epoch from(p_cutoff_at-v_row.source_at))/3600)::int end,'hoursPastDue',case when v_row.due_at is null then null else greatest(0,floor(extract(epoch from(p_cutoff_at-v_row.due_at))/3600)::int) end,'messageOrNextAction',left(coalesce(v_row.excerpt,''),1000),'hasOrganization',v_row.organization_id is not null,'hasContact',v_row.contact_id is not null,'hasOpportunity',v_row.opportunity_id is not null,'hasOwner',v_row.owner_profile_id is not null,'derivedSignals',to_jsonb(v_signals),'sourceTimestamp',coalesce(v_row.source_at,v_row.due_at));
 insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at) values(p_tenant_id,'relationship_'||v_row.entity_type,v_row.entity_id,'relationship_followup:'||p_run_id::text,v_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '14 days');
 v_entities:=v_entities||v_payload;v_queued:=v_queued+1;
 if jsonb_array_length(v_entities)>=v_batch_size then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'relationship_followup','relationship_followup:'||p_run_id::text||':'||v_batch,'relationship_followup_review',jsonb_build_object('entities',v_entities),'1','1',50,'gemini-2.5-flash','{}'::uuid[]);v_entities:='[]'::jsonb;end if;end loop;
if jsonb_array_length(v_entities)>0 then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'relationship_followup','relationship_followup:'||p_run_id::text||':'||v_batch,'relationship_followup_review',jsonb_build_object('entities',v_entities),'1','1',50,'gemini-2.5-flash','{}'::uuid[]);end if;
return jsonb_build_object('sourceItemsTotal',v_seen,'itemsQueued',v_queued,'batchesQueued',v_batch,'cutoffAt',p_cutoff_at);end;$function$;

create or replace function public.ai_ops_build_donor_intelligence_batches(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now(),p_batch_size integer default 6) returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_row record;v_entities jsonb:='[]'::jsonb;v_payload jsonb;v_signals text[];v_key text;v_batch int:=0;v_seen int:=0;v_batch_size int:=least(greatest(coalesce(p_batch_size,6),3),8);
begin if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
for v_row in
 select 'relationship_organization'::text as entity_type,o.id::text as entity_id,o.organization_kind,o.veteran_affiliated,o.relationship_stage,o.outreach_status,o.last_contact_at,o.next_action_due_at,o.do_not_contact,
  array(select r.role_code from public.relationship_organization_roles r where r.tenant_id=p_tenant_id and r.organization_id=o.id order by r.role_code) roles,
  (select count(*)::int from public.relationship_contacts c join public.relationship_contact_organizations co on co.contact_id=c.id and co.tenant_id=c.tenant_id where c.tenant_id=p_tenant_id and co.organization_id=o.id) contact_count,
  (select count(*)::int from public.relationship_opportunities x where x.tenant_id=p_tenant_id and x.organization_id=o.id and x.closed_at is null) open_opportunities,
  (select max(s.follower_count) from public.relationship_social_profiles s where s.tenant_id=p_tenant_id and s.organization_id=o.id and s.approved) max_followers,
  exists(select 1 from public.relationship_organization_roles r where r.tenant_id=p_tenant_id and r.organization_id=o.id and r.role_code='bty_nominee') as is_bty,
  null::numeric as lifetime_amount,null::int as donation_count,null::timestamptz as last_donation_at,null::text as recurring_status,null::boolean as communication_opt_in,null::boolean as linked_relationship_contact
 from public.relationship_organizations o where o.tenant_id=p_tenant_id and exists(select 1 from public.relationship_organization_roles r where r.tenant_id=p_tenant_id and r.organization_id=o.id and r.role_code='funder')
 union all
 select 'donor',d.id::text,'individual_donor',null::boolean,null::text,null::text,d.last_donation_at,null::timestamptz,not coalesce(d.communication_opt_in,true),
  array['donor']::text[],case when d.relationship_contact_id is null then 0 else 1 end,0,null::bigint,false,
  d.lifetime_amount,d.donation_count,d.last_donation_at,d.recurring_status,d.communication_opt_in,d.relationship_contact_id is not null
 from public.crm_donors d where d.tenant_id=p_tenant_id
 order by 1,2
loop
 v_seen:=v_seen+1;v_signals:='{}'::text[];
 if coalesce(v_row.is_bty,false) then v_signals:=array_append(v_signals,'alsoBtyNominee');end if;
 if coalesce(v_row.veteran_affiliated,false) then v_signals:=array_append(v_signals,'veteranAffiliated');end if;
 if v_row.last_contact_at is null then v_signals:=array_append(v_signals,'noRecordedRelationshipContact');end if;
 if v_row.next_action_due_at is not null and v_row.next_action_due_at<p_cutoff_at then v_signals:=array_append(v_signals,'donorNextActionOverdue');end if;
 if coalesce(v_row.contact_count,0)=0 then v_signals:=array_append(v_signals,'noKnownContactPerson');end if;
 if v_row.entity_type='donor' then
  if v_row.recurring_status is not null and lower(v_row.recurring_status) in ('cancelled','canceled','lapsed','failed') then v_signals:=array_append(v_signals,'lapsedRecurringDonor');end if;
  if v_row.last_donation_at is not null and v_row.last_donation_at<p_cutoff_at-interval '365 days' then v_signals:=array_append(v_signals,'noDonationInLastYear');end if;
  if coalesce(v_row.donation_count,0)=1 then v_signals:=array_append(v_signals,'singleGiftDonor');end if;
  if v_row.communication_opt_in is false then v_signals:=array_append(v_signals,'donorCommunicationOptOut');end if;
  if coalesce(v_row.linked_relationship_contact,false) then v_signals:=array_append(v_signals,'linkedToRelationshipContact');end if;
 end if;
 v_key:='di'||left(md5(v_row.entity_type||v_row.entity_id||p_run_id::text),12);
 v_payload:=jsonb_build_object('entityKey',v_key,'recordType',v_row.entity_type,'organizationKind',v_row.organization_kind,'roles',to_jsonb(v_row.roles),'veteranAffiliated',v_row.veteran_affiliated,'relationshipStage',v_row.relationship_stage,'outreachStatus',v_row.outreach_status,'daysSinceLastContact',case when v_row.last_contact_at is null then null else floor(extract(epoch from(p_cutoff_at-v_row.last_contact_at))/86400)::int end,'contactCount',v_row.contact_count,'openOpportunities',v_row.open_opportunities,'maxKnownSocialFollowers',v_row.max_followers,'doNotContact',v_row.do_not_contact,'lifetimeAmount',v_row.lifetime_amount,'donationCount',v_row.donation_count,'daysSinceLastDonation',case when v_row.last_donation_at is null then null else floor(extract(epoch from(p_cutoff_at-v_row.last_donation_at))/86400)::int end,'recurringStatus',v_row.recurring_status,'derivedSignals',to_jsonb(v_signals),'sourceTimestamp',coalesce(v_row.last_contact_at,p_cutoff_at));
 insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at) values(p_tenant_id,v_row.entity_type,v_row.entity_id,'donor_intelligence:'||p_run_id::text,v_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '30 days');
 v_entities:=v_entities||v_payload;
 if jsonb_array_length(v_entities)>=v_batch_size then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'donor_intelligence','donor_intelligence:'||p_run_id::text||':'||v_batch,'donor_opportunity_review',jsonb_build_object('entities',v_entities),'1','1',70,'gemini-2.5-flash','{}'::uuid[]);v_entities:='[]'::jsonb;end if;end loop;
if jsonb_array_length(v_entities)>0 then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'donor_intelligence','donor_intelligence:'||p_run_id::text||':'||v_batch,'donor_opportunity_review',jsonb_build_object('entities',v_entities),'1','1',70,'gemini-2.5-flash','{}'::uuid[]);end if;
return jsonb_build_object('sourceItemsTotal',v_seen,'itemsQueued',v_seen,'batchesQueued',v_batch,'cutoffAt',p_cutoff_at);end;$function$;

create or replace function public.ai_ops_build_social_lead_batches(p_tenant_id uuid,p_run_id uuid,p_cutoff_at timestamptz default now(),p_batch_size integer default 6) returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_row record;v_entities jsonb:='[]'::jsonb;v_payload jsonb;v_key text;v_batch int:=0;v_seen int:=0;v_batch_size int:=least(greatest(coalesce(p_batch_size,6),3),8);v_match_id uuid;v_signals text[];
begin if not private.valorwell_is_service_role() then raise exception 'AI Operations worker functions require the service role.' using errcode='42501';end if;
for v_row in select c.id,c.initiative,c.video_title,c.comment_text,c.classification,c.published_at,c.author_display_name from public.ai_operations_youtube_comments c where c.tenant_id=p_tenant_id and c.published_at>=p_cutoff_at-interval '7 days' and coalesce(c.classification,'') not in ('spam','crisis') order by c.published_at desc limit 100 loop
 v_seen:=v_seen+1;v_signals:=array['publicEngagement']::text[];v_match_id:=null;
 if coalesce(v_row.author_display_name,'')<>'' then
  select rc.id into v_match_id from public.relationship_contacts rc
  where rc.tenant_id=p_tenant_id
    and lower(trim(coalesce(rc.preferred_name,rc.first_name)||' '||rc.last_name))=lower(trim(v_row.author_display_name))
  limit 1;
  if v_match_id is not null then v_signals:=array_append(v_signals,'matchesExistingRelationshipContact');end if;
 end if;
 v_key:='sl'||left(md5(v_row.id::text||p_run_id::text),12);
 v_payload:=jsonb_build_object('entityKey',v_key,'platform','youtube','initiative',v_row.initiative,'videoTitle',left(coalesce(v_row.video_title,''),300),'comment',left(coalesce(v_row.comment_text,''),1200),'existingClassification',v_row.classification,'authorHasDisplayName',coalesce(v_row.author_display_name,'')<>'','existingRelationshipContactId',v_match_id,'hasExistingCrmRecord',v_match_id is not null,'derivedSignals',to_jsonb(v_signals),'sourceTimestamp',v_row.published_at);
 insert into private.ai_ops_snapshots(tenant_id,entity_type,entity_id,snapshot_type,snapshot_hash,evaluation_hash,cutoff_at,payload,expires_at) values(p_tenant_id,'youtube_comment',v_row.id::text,'social_leads:'||p_run_id::text,v_key,md5((v_payload-'entityKey')::text),p_cutoff_at,v_payload,now()+interval '30 days');
 v_entities:=v_entities||v_payload;
 if jsonb_array_length(v_entities)>=v_batch_size then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'social_leads','social_leads:'||p_run_id::text||':'||v_batch,'social_lead_review',jsonb_build_object('entities',v_entities),'1','1',75,'gemini-2.5-flash','{}'::uuid[]);v_entities:='[]'::jsonb;end if;end loop;
if jsonb_array_length(v_entities)>0 then v_batch:=v_batch+1;perform public.ai_ops_enqueue_work(p_tenant_id,p_run_id,'social_leads','social_leads:'||p_run_id::text||':'||v_batch,'social_lead_review',jsonb_build_object('entities',v_entities),'1','1',75,'gemini-2.5-flash','{}'::uuid[]);end if;
return jsonb_build_object('sourceItemsTotal',v_seen,'itemsQueued',v_seen,'batchesQueued',v_batch,'sourceCoverage',jsonb_build_object('youtube',true,'otherSocialPlatforms','unavailable'),'cutoffAt',p_cutoff_at);end;$function$;

update private.ai_ops_work_items set requested_model='gemini-2.5-flash'
where module in ('relationship_followup','donor_intelligence','social_leads')
  and status in ('queued','retry_wait')
  and coalesce(requested_model,'') <> 'gemini-2.5-flash';