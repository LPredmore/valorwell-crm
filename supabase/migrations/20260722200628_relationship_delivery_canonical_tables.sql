-- Pass 12: canonical non-clinical relationship communications, events, replies, and provider state.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'relationship_campaign_work_items_tenant_id_id_key'
      AND conrelid = 'private.relationship_campaign_work_items'::regclass
  ) THEN
    ALTER TABLE private.relationship_campaign_work_items
      ADD CONSTRAINT relationship_campaign_work_items_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.relationship_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_item_id uuid,
  campaign_id uuid,
  campaign_step_id uuid,
  enrollment_id uuid,
  organization_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  direction text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  status text NOT NULL,
  sender_email text NOT NULL,
  recipient_email text NOT NULL,
  subject text,
  rendered_body text,
  provider text,
  provider_message_id text,
  provider_thread_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_communications_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT relationship_communications_direction_check CHECK (direction = ANY(ARRAY['outbound','inbound']::text[])),
  CONSTRAINT relationship_communications_channel_check CHECK (channel='email'),
  CONSTRAINT relationship_communications_status_check CHECK (status = ANY(ARRAY['scheduled','sent','delivered','failed','bounced','received']::text[])),
  CONSTRAINT relationship_communications_sender_email_check CHECK (lower(btrim(sender_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT relationship_communications_recipient_email_check CHECK (lower(btrim(recipient_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT relationship_communications_metadata_check CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT relationship_communications_direction_status_check CHECK (
    (direction='outbound' AND status = ANY(ARRAY['scheduled','sent','delivered','failed','bounced']::text[]))
    OR (direction='inbound' AND status='received')
  ),
  CONSTRAINT relationship_communications_timestamp_check CHECK (
    (status <> 'sent' OR sent_at IS NOT NULL)
    AND (status <> 'delivered' OR delivered_at IS NOT NULL)
    AND (status <> 'failed' OR failed_at IS NOT NULL)
    AND (status <> 'bounced' OR failed_at IS NOT NULL)
  ),
  CONSTRAINT relationship_communications_tenant_work_fkey FOREIGN KEY (tenant_id,work_item_id) REFERENCES private.relationship_campaign_work_items(tenant_id,id),
  CONSTRAINT relationship_communications_tenant_campaign_fkey FOREIGN KEY (tenant_id,campaign_id) REFERENCES public.relationship_campaigns(tenant_id,id),
  CONSTRAINT relationship_communications_tenant_step_fkey FOREIGN KEY (tenant_id,campaign_step_id) REFERENCES public.relationship_campaign_steps(tenant_id,id),
  CONSTRAINT relationship_communications_tenant_enrollment_fkey FOREIGN KEY (tenant_id,enrollment_id) REFERENCES public.relationship_campaign_enrollments(tenant_id,id),
  CONSTRAINT relationship_communications_tenant_organization_fkey FOREIGN KEY (tenant_id,organization_id) REFERENCES public.relationship_organizations(tenant_id,id),
  CONSTRAINT relationship_communications_tenant_contact_fkey FOREIGN KEY (tenant_id,contact_id) REFERENCES public.relationship_contacts(tenant_id,id),
  CONSTRAINT relationship_communications_tenant_opportunity_fkey FOREIGN KEY (tenant_id,opportunity_id) REFERENCES public.relationship_opportunities(tenant_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS relationship_communications_provider_message_uidx
  ON public.relationship_communications(provider,provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS relationship_communications_outbound_work_uidx
  ON public.relationship_communications(work_item_id)
  WHERE direction='outbound' AND work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_subject_idx ON public.relationship_communications(tenant_id,contact_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_org_idx ON public.relationship_communications(tenant_id,organization_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_enrollment_idx ON public.relationship_communications(tenant_id,enrollment_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_status_idx ON public.relationship_communications(tenant_id,status,occurred_at DESC);
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_campaign_idx ON public.relationship_communications(tenant_id,campaign_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_step_idx ON public.relationship_communications(tenant_id,campaign_step_id);
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_opportunity_idx ON public.relationship_communications(tenant_id,opportunity_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS relationship_communications_tenant_work_idx ON public.relationship_communications(tenant_id,work_item_id);

CREATE TABLE IF NOT EXISTS public.relationship_communication_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  communication_id uuid NOT NULL,
  provider text NOT NULL,
  provider_event_id text,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_communication_events_metadata_check CHECK (jsonb_typeof(payload)='object'),
  CONSTRAINT relationship_communication_events_tenant_communication_fkey FOREIGN KEY (tenant_id,communication_id)
    REFERENCES public.relationship_communications(tenant_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS relationship_communication_events_provider_event_uidx
  ON public.relationship_communication_events(provider,provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS relationship_communication_events_tenant_communication_idx
  ON public.relationship_communication_events(tenant_id,communication_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.relationship_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  communication_id uuid NOT NULL,
  enrollment_id uuid,
  organization_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new',
  follow_up_due_at timestamptz,
  resolved_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_replies_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT relationship_replies_communication_key UNIQUE (communication_id),
  CONSTRAINT relationship_replies_status_check CHECK (status = ANY(ARRAY['new','needs_action','in_progress','resolved']::text[])),
  CONSTRAINT relationship_replies_version_check CHECK (version > 0),
  CONSTRAINT relationship_replies_metadata_check CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT relationship_replies_resolution_check CHECK ((status='resolved' AND resolved_at IS NOT NULL) OR (status<>'resolved' AND resolved_at IS NULL)),
  CONSTRAINT relationship_replies_tenant_communication_fkey FOREIGN KEY (tenant_id,communication_id) REFERENCES public.relationship_communications(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT relationship_replies_tenant_enrollment_fkey FOREIGN KEY (tenant_id,enrollment_id) REFERENCES public.relationship_campaign_enrollments(tenant_id,id),
  CONSTRAINT relationship_replies_tenant_organization_fkey FOREIGN KEY (tenant_id,organization_id) REFERENCES public.relationship_organizations(tenant_id,id),
  CONSTRAINT relationship_replies_tenant_contact_fkey FOREIGN KEY (tenant_id,contact_id) REFERENCES public.relationship_contacts(tenant_id,id),
  CONSTRAINT relationship_replies_tenant_opportunity_fkey FOREIGN KEY (tenant_id,opportunity_id) REFERENCES public.relationship_opportunities(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS relationship_replies_tenant_queue_idx ON public.relationship_replies(tenant_id,status,follow_up_due_at,created_at DESC);
CREATE INDEX IF NOT EXISTS relationship_replies_tenant_owner_idx ON public.relationship_replies(tenant_id,owner_profile_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS relationship_replies_tenant_enrollment_idx ON public.relationship_replies(tenant_id,enrollment_id);
CREATE INDEX IF NOT EXISTS relationship_replies_tenant_organization_idx ON public.relationship_replies(tenant_id,organization_id);
CREATE INDEX IF NOT EXISTS relationship_replies_tenant_contact_idx ON public.relationship_replies(tenant_id,contact_id);
CREATE INDEX IF NOT EXISTS relationship_replies_tenant_opportunity_idx ON public.relationship_replies(tenant_id,opportunity_id);

CREATE TABLE IF NOT EXISTS private.relationship_delivery_provider_configs (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'disabled',
  sender_email text,
  inbound_address text,
  postal_address text,
  webhook_endpoint text,
  outbound_verified_at timestamptz,
  inbound_verified_at timestamptz,
  webhook_verified_at timestamptz,
  worker_verified_at timestamptz,
  last_verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,provider),
  CONSTRAINT relationship_delivery_provider_configs_provider_check CHECK (provider='resend'),
  CONSTRAINT relationship_delivery_provider_configs_status_check CHECK (status=ANY(ARRAY['disabled','test','ready','suspended']::text[])),
  CONSTRAINT relationship_delivery_provider_configs_email_check CHECK (sender_email IS NULL OR lower(btrim(sender_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT relationship_delivery_provider_configs_inbound_check CHECK (inbound_address IS NULL OR lower(btrim(inbound_address)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  CONSTRAINT relationship_delivery_provider_configs_metadata_check CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT relationship_delivery_provider_configs_ready_check CHECK (
    status <> 'ready' OR (
      sender_email IS NOT NULL AND inbound_address IS NOT NULL AND nullif(btrim(postal_address),'') IS NOT NULL
      AND webhook_endpoint IS NOT NULL AND outbound_verified_at IS NOT NULL AND inbound_verified_at IS NOT NULL
      AND webhook_verified_at IS NOT NULL AND worker_verified_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS private.relationship_delivery_idempotency (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  operation text NOT NULL,
  campaign_id uuid,
  work_item_id uuid,
  communication_id uuid,
  reply_id uuid,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,idempotency_key),
  CONSTRAINT relationship_delivery_idempotency_campaign_fkey FOREIGN KEY (tenant_id,campaign_id) REFERENCES public.relationship_campaigns(tenant_id,id),
  CONSTRAINT relationship_delivery_idempotency_work_fkey FOREIGN KEY (tenant_id,work_item_id) REFERENCES private.relationship_campaign_work_items(tenant_id,id),
  CONSTRAINT relationship_delivery_idempotency_communication_fkey FOREIGN KEY (tenant_id,communication_id) REFERENCES public.relationship_communications(tenant_id,id),
  CONSTRAINT relationship_delivery_idempotency_reply_fkey FOREIGN KEY (tenant_id,reply_id) REFERENCES public.relationship_replies(tenant_id,id),
  CONSTRAINT relationship_delivery_idempotency_response_check CHECK (jsonb_typeof(response) IN ('object','array'))
);
CREATE INDEX IF NOT EXISTS relationship_delivery_idempotency_campaign_idx ON private.relationship_delivery_idempotency(tenant_id,campaign_id);
CREATE INDEX IF NOT EXISTS relationship_delivery_idempotency_work_idx ON private.relationship_delivery_idempotency(tenant_id,work_item_id);
CREATE INDEX IF NOT EXISTS relationship_delivery_idempotency_communication_idx ON private.relationship_delivery_idempotency(tenant_id,communication_id);
CREATE INDEX IF NOT EXISTS relationship_delivery_idempotency_reply_idx ON private.relationship_delivery_idempotency(tenant_id,reply_id);

ALTER TABLE public.relationship_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_communication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.relationship_delivery_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.relationship_delivery_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS relationship_communications_crm_select ON public.relationship_communications;
CREATE POLICY relationship_communications_crm_select ON public.relationship_communications FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.crm_user_capabilities c WHERE c.profile_id=(SELECT auth.uid()) AND c.tenant_id=relationship_communications.tenant_id AND c.crm_role <> 'crm_none'::public.crm_capability_role)
);
DROP POLICY IF EXISTS relationship_communication_events_crm_select ON public.relationship_communication_events;
CREATE POLICY relationship_communication_events_crm_select ON public.relationship_communication_events FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.crm_user_capabilities c WHERE c.profile_id=(SELECT auth.uid()) AND c.tenant_id=relationship_communication_events.tenant_id AND c.crm_role <> 'crm_none'::public.crm_capability_role)
);
DROP POLICY IF EXISTS relationship_replies_crm_select ON public.relationship_replies;
CREATE POLICY relationship_replies_crm_select ON public.relationship_replies FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.crm_user_capabilities c WHERE c.profile_id=(SELECT auth.uid()) AND c.tenant_id=relationship_replies.tenant_id AND c.crm_role <> 'crm_none'::public.crm_capability_role)
);

REVOKE ALL ON public.relationship_communications,public.relationship_communication_events,public.relationship_replies FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.relationship_communications,public.relationship_communication_events,public.relationship_replies TO authenticated;
GRANT ALL ON public.relationship_communications,public.relationship_communication_events,public.relationship_replies TO service_role;
REVOKE ALL ON private.relationship_delivery_provider_configs,private.relationship_delivery_idempotency FROM PUBLIC,anon,authenticated;
GRANT ALL ON private.relationship_delivery_provider_configs,private.relationship_delivery_idempotency TO service_role;

ALTER TABLE public.relationship_campaigns DROP CONSTRAINT IF EXISTS relationship_campaigns_execution_disabled_check;
ALTER TABLE public.relationship_campaigns DROP CONSTRAINT IF EXISTS relationship_campaigns_execution_state_check;
ALTER TABLE public.relationship_campaigns ADD CONSTRAINT relationship_campaigns_execution_state_check CHECK (NOT execution_enabled OR status='active');
ALTER TABLE public.relationship_campaign_enrollments DROP CONSTRAINT IF EXISTS relationship_campaign_enrollments_delivery_disabled_check;
ALTER TABLE public.relationship_campaign_enrollments DROP CONSTRAINT IF EXISTS relationship_campaign_enrollments_delivery_state_check;
ALTER TABLE public.relationship_campaign_enrollments ADD CONSTRAINT relationship_campaign_enrollments_delivery_state_check CHECK (
  NOT delivery_enabled OR (safety_status='ready' AND status=ANY(ARRAY['pending','active']::text[]))
);

ALTER TABLE public.relationship_enrollment_events DROP CONSTRAINT IF EXISTS relationship_enrollment_events_type_check;
ALTER TABLE public.relationship_enrollment_events ADD CONSTRAINT relationship_enrollment_events_type_check CHECK (event_type = ANY(ARRAY[
  'enrolled','paused','resumed','stopped','work_planned','work_claimed','work_retry_scheduled','step_completed','completed','failed','system',
  'safety_ready','safety_blocked','suppressed','suppression_revoked','unsubscribe_processed','delivery_enabled','delivery_disabled',
  'communication_scheduled','communication_sent','communication_delivered','communication_failed','communication_bounced','reply_received'
]::text[]));

CREATE OR REPLACE FUNCTION private.guard_relationship_campaign_execution_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  IF new.execution_enabled AND (tg_op='INSERT' OR NOT old.execution_enabled)
     AND coalesce(current_setting('app.relationship_delivery_activation',true),'')<>'allowed' THEN
    RAISE EXCEPTION 'Relationship campaign execution can only be enabled through the controlled activation RPC.' USING errcode='42501';
  END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_relationship_enrollment_delivery_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  IF new.delivery_enabled AND (tg_op='INSERT' OR NOT old.delivery_enabled)
     AND coalesce(current_setting('app.relationship_delivery_activation',true),'')<>'allowed' THEN
    RAISE EXCEPTION 'Relationship enrollment delivery can only be enabled through the controlled activation RPC.' USING errcode='42501';
  END IF;
  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS guard_relationship_campaign_execution ON public.relationship_campaigns;
CREATE TRIGGER guard_relationship_campaign_execution BEFORE INSERT OR UPDATE OF execution_enabled ON public.relationship_campaigns FOR EACH ROW EXECUTE FUNCTION private.guard_relationship_campaign_execution_activation();
DROP TRIGGER IF EXISTS guard_relationship_enrollment_delivery ON public.relationship_campaign_enrollments;
CREATE TRIGGER guard_relationship_enrollment_delivery BEFORE INSERT OR UPDATE OF delivery_enabled ON public.relationship_campaign_enrollments FOR EACH ROW EXECUTE FUNCTION private.guard_relationship_enrollment_delivery_activation();

CREATE OR REPLACE FUNCTION public.set_relationship_campaign_enrollment_audit_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  new.recipient_email:=lower(btrim(new.recipient_email));
  new.recipient_name:=nullif(regexp_replace(btrim(new.recipient_name),'\s+',' ','g'),'');
  new.stopped_reason:=nullif(btrim(new.stopped_reason),'');
  IF tg_op='INSERT' THEN
    new.enrolled_by_profile_id:=coalesce(new.enrolled_by_profile_id,v_actor);
    new.created_by_profile_id:=coalesce(new.created_by_profile_id,v_actor);
    new.updated_by_profile_id:=coalesce(new.updated_by_profile_id,v_actor,new.created_by_profile_id);
    new.version:=1;
  ELSE
    IF new.tenant_id IS DISTINCT FROM old.tenant_id OR new.campaign_id IS DISTINCT FROM old.campaign_id
       OR new.contact_id IS DISTINCT FROM old.contact_id OR new.organization_id IS DISTINCT FROM old.organization_id
       OR new.opportunity_id IS DISTINCT FROM old.opportunity_id OR new.recipient_email IS DISTINCT FROM old.recipient_email
       OR new.recipient_name IS DISTINCT FROM old.recipient_name OR new.source_language_mode IS DISTINCT FROM old.source_language_mode
       OR new.personalization_context IS DISTINCT FROM old.personalization_context OR new.eligibility_snapshot IS DISTINCT FROM old.eligibility_snapshot THEN
      RAISE EXCEPTION 'Enrollment identity, recipient, and preliminary eligibility are immutable.' USING errcode='22023';
    END IF;
    new.id:=old.id;
    new.created_at:=old.created_at;
    new.created_by_profile_id:=old.created_by_profile_id;
    new.enrolled_by_profile_id:=old.enrolled_by_profile_id;
    new.updated_by_profile_id:=coalesce(v_actor,new.updated_by_profile_id,old.updated_by_profile_id);
    new.updated_at:=now();
    new.version:=old.version+1;
  END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION private.set_relationship_delivery_audit_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  new.updated_at:=now();
  IF tg_table_name='relationship_replies' AND tg_op='UPDATE' THEN new.version:=old.version+1; END IF;
  RETURN new;
END;
$function$;
DROP TRIGGER IF EXISTS set_relationship_communications_audit ON public.relationship_communications;
CREATE TRIGGER set_relationship_communications_audit BEFORE UPDATE ON public.relationship_communications FOR EACH ROW EXECUTE FUNCTION private.set_relationship_delivery_audit_fields();
DROP TRIGGER IF EXISTS set_relationship_replies_audit ON public.relationship_replies;
CREATE TRIGGER set_relationship_replies_audit BEFORE UPDATE ON public.relationship_replies FOR EACH ROW EXECUTE FUNCTION private.set_relationship_delivery_audit_fields();
DROP TRIGGER IF EXISTS set_relationship_provider_config_audit ON private.relationship_delivery_provider_configs;
CREATE TRIGGER set_relationship_provider_config_audit BEFORE UPDATE ON private.relationship_delivery_provider_configs FOR EACH ROW EXECUTE FUNCTION private.set_relationship_delivery_audit_fields();

REVOKE ALL ON FUNCTION private.guard_relationship_campaign_execution_activation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.guard_relationship_enrollment_delivery_activation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.set_relationship_delivery_audit_fields() FROM PUBLIC,anon,authenticated;
