-- Retire Shorts thumbnail API uploads while preserving generated artwork
-- on clips/projects and existing social publication records.
-- This is idempotent and does not alter video visibility or scheduling.
update public.ai_operations_social_settings s
set metadata=coalesce(s.metadata,'{}'::jsonb)-'shorts_thumbnail_api'
where s.metadata ? 'shorts_thumbnail_api'
  and exists (select 1 from public.ai_operations_social_accounts a
    where a.id=s.account_id and a.platform='youtube');

-- Keep the image file reference in the publication and normalize old
-- API-response statuses (which were not evidence of visible Shorts artwork).
-- Historical events/jobs still preserve attempts for audit.
update public.ai_operations_social_publications p
set platform_payload=jsonb_set(
  coalesce(p.platform_payload,'{}'::jsonb),
  '{thumbnail}',
  jsonb_build_object('apiStatus','stored_in_crm','delivery','none',
    'fileId',p.thumbnail_file_id,
    'note','Generated cover retained in CRM and Drive; no Shorts thumbnail upload to YouTube'),
  true
)
where p.content_format='short'
  and p.thumbnail_file_id is not null
  and (coalesce(p.platform_payload->'thumbnail'->>'apiStatus','')<>'stored_in_crm'
    or coalesce(p.platform_payload->'thumbnail'->>'fileId','')<>p.thumbnail_file_id);
