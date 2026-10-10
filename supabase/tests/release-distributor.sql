begin;
do $$
declare t uuid:='00000000-0000-0000-0000-000000000001'; r uuid; d jsonb; d2 jsonb; n integer; pid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid();
begin
  -- Historic Public baseline must be durable across later privacy changes.
  r:=distribution_observe(t,'{"id":"historical1","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public","title":"Historical"}');
  if (select count(*) from ai_operations_social_distribution_deliveries where release_id=r and status='SKIPPED_BASELINE')<>3 then raise exception 'baseline failed'; end if;
  if distribution_claim(t,'disabled') is not null then raise exception 'kill switch failed'; end if;
  update ai_operations_distribution_config set baseline_completed_at=now(),publishing_enabled=true where tenant_id=t;
  update ai_operations_distribution_destinations set enabled=true,credential_verified_at=now();
  insert into ai_operations_distribution_destinations(tenant_id,platform,external_account_id,display_name,enabled,credential_verified_at) values(t,'instagram','test-ig','Test only',true,now());
  insert into ai_operations_video_projects values(pid,t);
  insert into ai_operations_video_clips values(cid,pid,'short','original-mp4','Facebook copy','LinkedIn copy','Instagram copy');
  insert into ai_operations_social_publications(id,tenant_id,platform,external_video_id,clip_id,project_id,source_type) values(gen_random_uuid(),t,'youtube','shortvideo1',cid,pid,'clip');
  r:=distribution_observe(t,'{"id":"shortvideo1","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"private","title":"Short"}');
  if exists(select 1 from ai_operations_social_distribution_deliveries where release_id=r) then raise exception 'private video queued'; end if;
  perform distribution_observe(t,'{"id":"shortvideo1","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public","title":"Short"}');
  perform distribution_observe(t,'{"id":"shortvideo1","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public","title":"Short"}');
  if (select count(*) from ai_operations_social_distribution_deliveries where release_id=r)<>4 then raise exception 'short/dedup failed'; end if;
  if not exists(select 1 from ai_operations_social_distribution_deliveries where release_id=r and platform='facebook' and description_snapshot='Facebook copy') then raise exception 'copy resolution failed'; end if;
  d:=distribution_claim(t,'worker1'); d2:=distribution_claim(t,'worker2');
  if d is null or d2 is null or d->>'id'=d2->>'id' then raise exception 'claim isolation failed'; end if;
  if distribution_begin_request(t,(d->>'id')::uuid,gen_random_uuid()) then raise exception 'lease fencing failed'; end if;
  if not distribution_begin_request(t,(d->>'id')::uuid,(d->>'lease_token')::uuid) then raise exception 'begin failed'; end if;
  if distribution_begin_request(t,(d->>'id')::uuid,(d->>'lease_token')::uuid) then raise exception 'duplicate send allowed'; end if;
  perform distribution_finish(t,(d->>'id')::uuid,(d->>'lease_token')::uuid,'PUBLISHED',201,'test-post','https://www.facebook.com/test-post');
  if not distribution_finish(t,(d->>'id')::uuid,(d->>'lease_token')::uuid,'PUBLISHED',201,'test-post','https://www.facebook.com/test-post') then raise exception 'result idempotence failed'; end if;
  perform distribution_observe(t,'{"id":"shortvideo1","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"private"}');
  perform distribution_observe(t,'{"id":"shortvideo1","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public"}');
  if (select status from ai_operations_social_distribution_deliveries where id=(d->>'id')::uuid)<>'PUBLISHED' then raise exception 'repost regression'; end if;
  -- A worker crash before sending can retry; a crash after sending cannot.
  update ai_operations_social_distribution_deliveries set lease_expires_at=now()-interval '1 minute' where id=(d2->>'id')::uuid;
  perform distribution_recover(t);
  if (select status from ai_operations_social_distribution_deliveries where id=(d2->>'id')::uuid)<>'RETRY_WAIT' then raise exception 'safe recovery failed'; end if;
  d2:=distribution_claim(t,'worker3');
  perform distribution_begin_request(t,(d2->>'id')::uuid,(d2->>'lease_token')::uuid);
  begin
    perform distribution_finish(t,(d2->>'id')::uuid,(d2->>'lease_token')::uuid,'RETRY_WAIT',500);
    raise exception 'ambiguous retry was accepted';
  exception when raise_exception then if SQLERRM='ambiguous retry was accepted' then raise; end if; end;
  update ai_operations_social_distribution_deliveries set lease_expires_at=now()-interval '1 minute' where id=(d2->>'id')::uuid;
  perform distribution_recover(t);
  if (select status from ai_operations_social_distribution_deliveries where id=(d2->>'id')::uuid)<>'NEEDS_REVIEW' then raise exception 'ambiguous recovery failed'; end if;
  -- Unmatched manual upload is retained without invented marketing copy.
  r:=distribution_observe(t,'{"id":"manualvideo","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public"}');
  if (select count(*) from ai_operations_social_distribution_deliveries where release_id=r and status='NEEDS_COPY')<>3 then raise exception 'unmatched copy failed'; end if;
  if not exists(select 1 from ai_operations_social_distribution_deliveries where release_id=r and platform='instagram' and status='NEEDS_REVIEW') then raise exception 'unknown Short classified automatically'; end if;
  insert into ai_operations_social_publications(id,tenant_id,platform,external_video_id,project_id,source_type) values(gen_random_uuid(),t,'youtube','longepisode',pid,'project');
  r:=distribution_observe(t,'{"id":"longepisode","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public"}');
  if exists(select 1 from ai_operations_social_distribution_deliveries where release_id=r and platform='instagram') then raise exception 'long video routed to Instagram'; end if;
  if (select classification from ai_operations_youtube_release_registry where id=r)<>'long' then raise exception 'project matching failed'; end if;
  update ai_operations_video_clips set drive_file_id=null,linkedin_description=null where id=cid;
  insert into ai_operations_social_publications(id,tenant_id,platform,external_video_id,clip_id,project_id,source_type) values(gen_random_uuid(),t,'youtube','missingdata',cid,pid,'clip');
  r:=distribution_observe(t,'{"id":"missingdata","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public"}');
  if not exists(select 1 from ai_operations_social_distribution_deliveries where release_id=r and platform='facebook' and status='PENDING') then raise exception 'independent Facebook blocked'; end if;
  if not exists(select 1 from ai_operations_social_distribution_deliveries where release_id=r and platform='instagram' and status='NEEDS_MEDIA') then raise exception 'missing media not recorded'; end if;
  if not exists(select 1 from ai_operations_social_distribution_deliveries where release_id=r and platform='linkedin' and status='NEEDS_COPY') then raise exception 'missing copy not recorded'; end if;
  if has_function_privilege('anon','public.distribution_claim(uuid,text)','execute') or has_function_privilege('authenticated','public.distribution_claim(uuid,text)','execute') then raise exception 'worker RPC privilege leak'; end if;
  if has_table_privilege('authenticated','ai_operations_distribution_config','select') then raise exception 'worker hash exposed'; end if;
  -- Duration can exclude Shorts, but a short duration alone never proves a Short.
  r:=distribution_observe(t,'{"id":"duration181","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public","duration_seconds":181}');
  if (select classification from ai_operations_youtube_release_registry where id=r)<>'long' then raise exception 'long duration classification failed'; end if;
  r:=distribution_observe(t,'{"id":"duration060","channel_id":"UCVcoBzMSzuABGxJ5Ne5EBtw","visibility":"public","duration_seconds":60}');
  if (select classification from ai_operations_youtube_release_registry where id=r)<>'unknown' then raise exception 'duration alone classified Short'; end if;
  -- An approved test can claim exactly one historical destination without opening the queue.
  select id into r from ai_operations_youtube_release_registry where youtube_video_id='historical1';
  insert into ai_operations_distribution_overrides(tenant_id,release_id,facebook_description,linkedin_description) values(t,r,'Approved test copy','Other destination remains blocked');
  update ai_operations_distribution_config set publishing_enabled=false,test_delivery_id=(select id from ai_operations_social_distribution_deliveries where release_id=r and platform='facebook'),test_approval_reference='isolated-test-fixture' where tenant_id=t;
  update ai_operations_social_distribution_deliveries set status='PENDING' where id=(select test_delivery_id from ai_operations_distribution_config where tenant_id=t);
  perform distribution_prepare(t,r);
  d:=distribution_claim(t,'approved-one-only');
  if d is null or (d->>'id')::uuid is distinct from (select test_delivery_id from ai_operations_distribution_config where tenant_id=t) then raise exception 'single test claim failed'; end if;
  if distribution_claim(t,'no-other-tests') is not null then raise exception 'test gate released unrelated delivery'; end if;
  if not distribution_begin_request(t,(d->>'id')::uuid,(d->>'lease_token')::uuid) then raise exception 'approved test send fence failed'; end if;
  update ai_operations_distribution_config set test_delivery_id=null,test_approval_reference=null where tenant_id=t;
  if has_table_privilege('authenticated','ai_operations_distribution_media_leases','select') then raise exception 'private media lease exposed'; end if;
  raise notice 'PASS: baseline, kill switch, short routing, private/public, duplicate events, copy resolution, account isolation, leases, result idempotence, privacy replay, recovery, manual uploads, project episodes, missing copy/media, RPC permissions';
end $$;
rollback;
