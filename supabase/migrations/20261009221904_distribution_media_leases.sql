create table public.ai_operations_distribution_media_leases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  delivery_id uuid not null,
  token_hash text not null,
  drive_file_id text not null,
  size_bytes bigint not null check(size_bytes>0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,delivery_id) references public.ai_operations_social_distribution_deliveries(tenant_id,id)
);
alter table public.ai_operations_distribution_media_leases enable row level security;
revoke all on public.ai_operations_distribution_media_leases from anon,authenticated;
grant all on public.ai_operations_distribution_media_leases to service_role;
create index distribution_media_delivery_idx on public.ai_operations_distribution_media_leases(tenant_id,delivery_id);
create index distribution_media_expiry_idx on public.ai_operations_distribution_media_leases(expires_at);
