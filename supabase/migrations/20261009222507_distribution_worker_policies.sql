create policy distribution_config_service on public.ai_operations_distribution_config for all to service_role using (true) with check (true);
create policy distribution_media_service on public.ai_operations_distribution_media_leases for all to service_role using (true) with check (true);
create index distribution_overrides_release_idx on public.ai_operations_distribution_overrides(tenant_id,release_id);
