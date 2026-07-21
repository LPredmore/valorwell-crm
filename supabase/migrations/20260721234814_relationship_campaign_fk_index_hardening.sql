alter table private.relationship_campaign_idempotency
  add constraint relationship_campaign_idempotency_tenant_campaign_fkey
  foreign key (tenant_id, campaign_id)
  references public.relationship_campaigns(tenant_id, id)
  on delete cascade;

create index relationship_campaign_idempotency_actor_idx
  on private.relationship_campaign_idempotency (actor_profile_id)
  where actor_profile_id is not null;
