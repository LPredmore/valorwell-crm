revoke all on function private.process_relationship_unsubscribe(text) from public, anon, authenticated;
grant execute on function private.process_relationship_unsubscribe(text) to service_role;
comment on function public.process_relationship_unsubscribe(text) is 'Anonymous non-clinical relationship-outreach unsubscribe endpoint. Uses an opaque hashed token, returns fixed outcome shapes, and never exposes token existence or clinical data.';
