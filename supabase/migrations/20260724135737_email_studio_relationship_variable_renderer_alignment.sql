-- Email Studio Pass 7 follow-up: align the runtime renderer with the canonical
-- relationship variable registry while failing closed when evidence context is absent.

create or replace function private.render_relationship_text(
  p_template text,
  p_context jsonb,
  p_unsubscribe_url text,
  p_postal_address text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result text := coalesce(p_template, '');
  v_display_name text := coalesce(nullif(p_context ->> 'contactDisplayName', ''), 'there');
  v_first_name text := coalesce(nullif(p_context ->> 'contactFirstName', ''), nullif(p_context ->> 'contactDisplayName', ''), 'there');
begin
  v_result := replace(v_result, '{{recipient_name}}', v_display_name);
  v_result := replace(v_result, '{{contact_display_name}}', v_display_name);
  v_result := replace(v_result, '{{first_name}}', v_first_name);
  v_result := replace(v_result, '{{contact_first_name}}', v_first_name);
  v_result := replace(v_result, '{{organization_name}}', coalesce(nullif(p_context ->> 'organizationName', ''), ''));
  v_result := replace(v_result, '{{organization_type}}', coalesce(nullif(p_context ->> 'organizationType', ''), '{{organization_type}}'));
  v_result := replace(v_result, '{{real_action_summary}}', coalesce(nullif(p_context ->> 'realActionSummary', ''), '{{real_action_summary}}'));
  v_result := replace(v_result, '{{cause_area}}', coalesce(nullif(p_context ->> 'causeArea', ''), '{{cause_area}}'));
  v_result := replace(v_result, '{{opportunity_context}}', coalesce(nullif(p_context ->> 'opportunityContext', ''), '{{opportunity_context}}'));
  v_result := replace(v_result, '{{approved_source_sentence}}', coalesce(nullif(p_context ->> 'approvedSourceSentence', ''), '{{approved_source_sentence}}'));
  v_result := replace(v_result, '{{sender_name}}', coalesce(nullif(p_context ->> 'senderName', ''), ''));
  v_result := replace(v_result, '{{unsubscribe_url}}', coalesce(p_unsubscribe_url, ''));
  v_result := replace(v_result, '{{postal_address}}', coalesce(p_postal_address, ''));
  if v_result ~ '\{\{[^{}]+\}\}' then
    raise exception 'Relationship campaign template contains unresolved variables.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

create or replace function private.render_relationship_html(
  p_template text,
  p_context jsonb,
  p_unsubscribe_url text,
  p_postal_address text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result text := coalesce(p_template, '');
  v_display_name text := coalesce(nullif(p_context ->> 'contactDisplayName', ''), 'there');
  v_first_name text := coalesce(nullif(p_context ->> 'contactFirstName', ''), nullif(p_context ->> 'contactDisplayName', ''), 'there');
begin
  v_result := replace(v_result, '{{recipient_name}}', private.escape_relationship_html(v_display_name));
  v_result := replace(v_result, '{{contact_display_name}}', private.escape_relationship_html(v_display_name));
  v_result := replace(v_result, '{{first_name}}', private.escape_relationship_html(v_first_name));
  v_result := replace(v_result, '{{contact_first_name}}', private.escape_relationship_html(v_first_name));
  v_result := replace(v_result, '{{organization_name}}', private.escape_relationship_html(coalesce(nullif(p_context ->> 'organizationName', ''), '')));
  v_result := replace(v_result, '{{organization_type}}', case when nullif(p_context ->> 'organizationType', '') is null then '{{organization_type}}' else private.escape_relationship_html(p_context ->> 'organizationType') end);
  v_result := replace(v_result, '{{real_action_summary}}', case when nullif(p_context ->> 'realActionSummary', '') is null then '{{real_action_summary}}' else private.escape_relationship_html(p_context ->> 'realActionSummary') end);
  v_result := replace(v_result, '{{cause_area}}', case when nullif(p_context ->> 'causeArea', '') is null then '{{cause_area}}' else private.escape_relationship_html(p_context ->> 'causeArea') end);
  v_result := replace(v_result, '{{opportunity_context}}', case when nullif(p_context ->> 'opportunityContext', '') is null then '{{opportunity_context}}' else private.escape_relationship_html(p_context ->> 'opportunityContext') end);
  v_result := replace(v_result, '{{approved_source_sentence}}', case when nullif(p_context ->> 'approvedSourceSentence', '') is null then '{{approved_source_sentence}}' else private.escape_relationship_html(p_context ->> 'approvedSourceSentence') end);
  v_result := replace(v_result, '{{sender_name}}', private.escape_relationship_html(coalesce(nullif(p_context ->> 'senderName', ''), '')));
  v_result := replace(v_result, '{{unsubscribe_url}}', private.escape_relationship_html(coalesce(p_unsubscribe_url, '')));
  v_result := replace(v_result, '{{postal_address}}', replace(private.escape_relationship_html(coalesce(p_postal_address, '')), E'\n', '<br>'));
  if v_result ~ '\{\{[^{}]+\}\}' then
    raise exception 'Relationship campaign HTML contains unresolved variables.' using errcode = '22023';
  end if;
  return v_result;
end;
$$;

revoke all on function private.render_relationship_text(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function private.render_relationship_text(text, jsonb, text, text) to service_role;
revoke all on function private.render_relationship_html(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function private.render_relationship_html(text, jsonb, text, text) to service_role;

comment on function private.render_relationship_text(text, jsonb, text, text) is
  'Renders canonical and legacy relationship variables and fails closed when evidence-backed context is unavailable.';
comment on function private.render_relationship_html(text, jsonb, text, text) is
  'Renders HTML-safe canonical and legacy relationship variables and fails closed when evidence-backed context is unavailable.';
