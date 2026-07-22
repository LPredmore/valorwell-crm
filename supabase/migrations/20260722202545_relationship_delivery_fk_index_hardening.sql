-- Pass 12: supporting leading indexes for every remaining delivery/reply foreign key.

CREATE INDEX IF NOT EXISTS relationship_communications_created_by_idx
  ON public.relationship_communications(created_by_profile_id);
CREATE INDEX IF NOT EXISTS relationship_communications_updated_by_idx
  ON public.relationship_communications(updated_by_profile_id);
CREATE INDEX IF NOT EXISTS relationship_replies_created_by_idx
  ON public.relationship_replies(created_by_profile_id);
CREATE INDEX IF NOT EXISTS relationship_replies_owner_profile_idx
  ON public.relationship_replies(owner_profile_id);
CREATE INDEX IF NOT EXISTS relationship_replies_tenant_communication_idx
  ON public.relationship_replies(tenant_id,communication_id);
CREATE INDEX IF NOT EXISTS relationship_replies_updated_by_idx
  ON public.relationship_replies(updated_by_profile_id);
