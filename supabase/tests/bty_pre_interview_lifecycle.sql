-- Rolled-back regression for the BTY pre-interview lifecycle. Run in a transaction only.
begin;
do $$
declare t uuid:='00000000-0000-0000-0000-000000000001'; o public.relationship_opportunities%rowtype; r jsonb; n int;
begin
  update private.relationship_feature_flags set enabled=true where flag_name in ('relationship_calendar_observation_enabled','relationship_activity_mutation_enabled');
  select * into o from public.relationship_opportunities where tenant_id=t and status='pre_interview_scheduled' and metadata ? 'bty_intro' limit 1;
  -- Graph: no automatic or shortcut completion.
  if private.relationship_opportunity_status_transition_allowed('interested','pre_interview_completed') then raise exception 'shortcut allowed'; end if;
  if not private.relationship_opportunity_status_transition_allowed('pre_interview_scheduled','pre_interview_completed') then raise exception 'manual completion blocked'; end if;
  if private.relationship_opportunity_status_transition_allowed('pre_interview_scheduled','completed') then raise exception 'intro counted as recording'; end if;
  -- Replaying the same event version is idempotent and never duplicates the meeting.
  r:=public.ingest_relationship_calendar_event(t,null,'info@valorwell.org',o.metadata->'bty_intro'->>'event_id',null,'confirmed',
    (o.metadata->'bty_intro'->>'starts_at')::timestamptz,(o.metadata->'bty_intro'->>'ends_at')::timestamptz,'{}',null,'Intro',now(),'{"bty_classification":"bty_preinterview"}');
  select count(*) into n from public.relationship_meetings where external_event_id=o.metadata->'bty_intro'->>'event_id';
  if n<>1 or r->>'activityType'<>'preinterview_booked' then raise exception 'replay failed % %',n,r; end if;
  -- Passing end time never completes it.
  if (select status from public.relationship_opportunities where id=o.id)<>'pre_interview_scheduled' then raise exception 'auto completion'; end if;
  -- Cancellation returns to interested; never completed.
  r:=public.ingest_relationship_calendar_event(t,null,'info@valorwell.org',o.metadata->'bty_intro'->>'event_id',null,'cancelled',
    null,null,'{}',null,'Intro',now()+interval '1 minute','{"bty_classification":"bty_preinterview"}');
  if (select status from public.relationship_opportunities where id=o.id)<>'interested' then raise exception 'cancel failed %',r; end if;
  -- Unknown pre-interview opens a review issue, not a fabricated match.
  r:=public.ingest_relationship_calendar_event(t,null,'info@valorwell.org','test-unknown-intro',null,'confirmed',now()+interval '3 days',now()+interval '3 days 1 hour',array['nobody@example.invalid'],null,'Intro call',now(),'{"bty_classification":"bty_preinterview"}');
  if (r->>'matched')::boolean or not exists(select 1 from public.relationship_reconciliation_issues where external_event_id='test-unknown-intro') then raise exception 'unmatched not surfaced %',r; end if;
  -- An unclassified non-StreamYard event is still ignored.
  r:=public.ingest_relationship_calendar_event(t,null,'info@valorwell.org','test-staff',null,'confirmed',now(),now(),'{}',null,'Staff sync',now(),'{}');
  if r->>'reason'<>'streamyard_room_not_present' then raise exception 'unrelated event observed'; end if;
  raise notice 'PASS: bty pre-interview lifecycle';
end $$;
rollback;
