alter type public.ai_ops_module_enum add value if not exists 'user_flow_smoke';

insert into private.ai_ops_flags(tenant_id, flag_name, enabled)
values ('00000000-0000-0000-0000-000000000001','user_flow_smoke_enabled', true)
on conflict (tenant_id, flag_name) do nothing;