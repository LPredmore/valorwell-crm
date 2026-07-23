-- Email Studio Pass 3: additive database foundation for canonical email content.
-- Existing content, campaign execution, and Resend delivery behavior remain unchanged.

ALTER TABLE public.crm_email_templates
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS content_scope text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS content_mode text NOT NULL DEFAULT 'campaign',
  ADD COLUMN IF NOT EXISTS editor_document jsonb,
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS preheader text,
  ADD COLUMN IF NOT EXISTS theme_key text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS editor_schema_version integer,
  ADD COLUMN IF NOT EXISTS render_hash text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS current_published_version_id uuid,
  ADD COLUMN IF NOT EXISTS updated_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.crm_email_templates
  ADD CONSTRAINT crm_email_templates_tenant_id_id_key UNIQUE (tenant_id, id),
  ADD CONSTRAINT crm_email_templates_scope_check
    CHECK (content_scope = ANY (ARRAY['client','relationship']::text[])),
  ADD CONSTRAINT crm_email_templates_mode_check
    CHECK (content_mode = ANY (ARRAY['direct','campaign','newsletter']::text[])),
  ADD CONSTRAINT crm_email_templates_status_check
    CHECK (status = ANY (ARRAY['draft','published','archived']::text[])),
  ADD CONSTRAINT crm_email_templates_archive_state_check
    CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  ADD CONSTRAINT crm_email_templates_theme_key_check
    CHECK (length(btrim(theme_key)) > 0),
  ADD CONSTRAINT crm_email_templates_schema_version_check
    CHECK (editor_schema_version IS NULL OR editor_schema_version > 0),
  ADD CONSTRAINT crm_email_templates_render_hash_check
    CHECK (render_hash IS NULL OR render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'),
  ADD CONSTRAINT crm_email_templates_editor_document_check
    CHECK (
      editor_document IS NULL OR (
        jsonb_typeof(editor_document) = 'object'
        AND editor_document ->> 'type' = 'doc'
        AND jsonb_typeof(editor_document -> 'content') = 'array'
      )
    ),
  ADD CONSTRAINT crm_email_templates_canonical_content_check
    CHECK (
      editor_document IS NULL OR (
        nullif(btrim(body_html), '') IS NOT NULL
        AND nullif(btrim(body_text), '') IS NOT NULL
        AND editor_schema_version IS NOT NULL
        AND render_hash IS NOT NULL
      )
    );

CREATE TABLE public.crm_email_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_id uuid NOT NULL,
  version_number integer NOT NULL,
  content_scope text NOT NULL,
  content_mode text NOT NULL,
  subject text NOT NULL,
  editor_document jsonb NOT NULL,
  rendered_html text NOT NULL,
  rendered_text text NOT NULL,
  preheader text,
  theme_key text NOT NULL,
  editor_schema_version integer NOT NULL,
  render_hash text NOT NULL,
  change_summary text,
  published_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_email_template_versions_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT crm_email_template_versions_tenant_template_id_id_key UNIQUE (tenant_id, template_id, id),
  CONSTRAINT crm_email_template_versions_template_version_key UNIQUE (template_id, version_number),
  CONSTRAINT crm_email_template_versions_tenant_template_fkey
    FOREIGN KEY (tenant_id, template_id)
    REFERENCES public.crm_email_templates(tenant_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_email_template_versions_version_number_check CHECK (version_number > 0),
  CONSTRAINT crm_email_template_versions_scope_check
    CHECK (content_scope = ANY (ARRAY['client','relationship']::text[])),
  CONSTRAINT crm_email_template_versions_mode_check
    CHECK (content_mode = ANY (ARRAY['direct','campaign','newsletter']::text[])),
  CONSTRAINT crm_email_template_versions_subject_check CHECK (length(btrim(subject)) > 0),
  CONSTRAINT crm_email_template_versions_html_check CHECK (length(btrim(rendered_html)) > 0),
  CONSTRAINT crm_email_template_versions_text_check CHECK (length(btrim(rendered_text)) > 0),
  CONSTRAINT crm_email_template_versions_theme_key_check CHECK (length(btrim(theme_key)) > 0),
  CONSTRAINT crm_email_template_versions_schema_version_check CHECK (editor_schema_version > 0),
  CONSTRAINT crm_email_template_versions_render_hash_check
    CHECK (render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'),
  CONSTRAINT crm_email_template_versions_editor_document_check
    CHECK (
      jsonb_typeof(editor_document) = 'object'
      AND editor_document ->> 'type' = 'doc'
      AND jsonb_typeof(editor_document -> 'content') = 'array'
    )
);

CREATE INDEX crm_email_template_versions_tenant_template_idx
  ON public.crm_email_template_versions(tenant_id, template_id, version_number DESC);
CREATE INDEX crm_email_template_versions_tenant_published_idx
  ON public.crm_email_template_versions(tenant_id, published_at DESC);
CREATE INDEX crm_email_templates_tenant_status_updated_idx
  ON public.crm_email_templates(tenant_id, status, updated_at DESC);

ALTER TABLE public.crm_email_templates
  ADD CONSTRAINT crm_email_templates_current_version_fkey
  FOREIGN KEY (tenant_id, id, current_published_version_id)
  REFERENCES public.crm_email_template_versions(tenant_id, template_id, id)
  ON DELETE RESTRICT;

ALTER TABLE public.crm_campaign_steps
  ADD COLUMN IF NOT EXISTS email_content_mode text,
  ADD COLUMN IF NOT EXISTS email_editor_document jsonb,
  ADD COLUMN IF NOT EXISTS email_body_text text,
  ADD COLUMN IF NOT EXISTS email_preheader text,
  ADD COLUMN IF NOT EXISTS email_theme_key text,
  ADD COLUMN IF NOT EXISTS email_editor_schema_version integer,
  ADD COLUMN IF NOT EXISTS email_render_hash text,
  ADD COLUMN IF NOT EXISTS email_template_version_id uuid;

ALTER TABLE public.crm_campaign_steps
  ADD CONSTRAINT crm_campaign_steps_email_content_mode_check
    CHECK (email_content_mode IS NULL OR email_content_mode = ANY (ARRAY['campaign','newsletter']::text[])),
  ADD CONSTRAINT crm_campaign_steps_email_editor_document_check
    CHECK (
      email_editor_document IS NULL OR (
        jsonb_typeof(email_editor_document) = 'object'
        AND email_editor_document ->> 'type' = 'doc'
        AND jsonb_typeof(email_editor_document -> 'content') = 'array'
      )
    ),
  ADD CONSTRAINT crm_campaign_steps_email_schema_version_check
    CHECK (email_editor_schema_version IS NULL OR email_editor_schema_version > 0),
  ADD CONSTRAINT crm_campaign_steps_email_render_hash_check
    CHECK (email_render_hash IS NULL OR email_render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'),
  ADD CONSTRAINT crm_campaign_steps_email_canonical_content_check
    CHECK (
      email_editor_document IS NULL OR (
        channel = 'email'
        AND email_content_mode IS NOT NULL
        AND nullif(btrim(email_body_html), '') IS NOT NULL
        AND nullif(btrim(email_body_text), '') IS NOT NULL
        AND nullif(btrim(email_theme_key), '') IS NOT NULL
        AND email_editor_schema_version IS NOT NULL
        AND email_render_hash IS NOT NULL
      )
    ),
  ADD CONSTRAINT crm_campaign_steps_email_template_version_fkey
    FOREIGN KEY (tenant_id, email_template_version_id)
    REFERENCES public.crm_email_template_versions(tenant_id, id)
    ON DELETE SET NULL;

CREATE INDEX crm_campaign_steps_email_template_version_idx
  ON public.crm_campaign_steps(email_template_version_id)
  WHERE email_template_version_id IS NOT NULL;

ALTER TABLE public.relationship_campaign_steps
  ADD COLUMN IF NOT EXISTS content_mode text,
  ADD COLUMN IF NOT EXISTS editor_document jsonb,
  ADD COLUMN IF NOT EXISTS body_html_template text,
  ADD COLUMN IF NOT EXISTS body_text_template text,
  ADD COLUMN IF NOT EXISTS preheader_template text,
  ADD COLUMN IF NOT EXISTS theme_key text,
  ADD COLUMN IF NOT EXISTS editor_schema_version integer,
  ADD COLUMN IF NOT EXISTS render_hash text,
  ADD COLUMN IF NOT EXISTS template_version_id uuid;

ALTER TABLE public.relationship_campaign_steps
  ADD CONSTRAINT relationship_campaign_steps_content_mode_check
    CHECK (content_mode IS NULL OR content_mode = ANY (ARRAY['campaign','newsletter']::text[])),
  ADD CONSTRAINT relationship_campaign_steps_editor_document_check
    CHECK (
      editor_document IS NULL OR (
        jsonb_typeof(editor_document) = 'object'
        AND editor_document ->> 'type' = 'doc'
        AND jsonb_typeof(editor_document -> 'content') = 'array'
      )
    ),
  ADD CONSTRAINT relationship_campaign_steps_editor_schema_version_check
    CHECK (editor_schema_version IS NULL OR editor_schema_version > 0),
  ADD CONSTRAINT relationship_campaign_steps_render_hash_check
    CHECK (render_hash IS NULL OR render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'),
  ADD CONSTRAINT relationship_campaign_steps_canonical_content_check
    CHECK (
      editor_document IS NULL OR (
        content_mode IS NOT NULL
        AND nullif(btrim(body_html_template), '') IS NOT NULL
        AND nullif(btrim(body_text_template), '') IS NOT NULL
        AND nullif(btrim(theme_key), '') IS NOT NULL
        AND editor_schema_version IS NOT NULL
        AND render_hash IS NOT NULL
      )
    ),
  ADD CONSTRAINT relationship_campaign_steps_template_version_fkey
    FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES public.crm_email_template_versions(tenant_id, id)
    ON DELETE SET NULL;

CREATE INDEX relationship_campaign_steps_template_version_idx
  ON public.relationship_campaign_steps(template_version_id)
  WHERE template_version_id IS NOT NULL;

ALTER TABLE public.crm_bulk_send_logs
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS editor_document jsonb,
  ADD COLUMN IF NOT EXISTS preheader text,
  ADD COLUMN IF NOT EXISTS content_mode text,
  ADD COLUMN IF NOT EXISTS theme_key text,
  ADD COLUMN IF NOT EXISTS editor_schema_version integer,
  ADD COLUMN IF NOT EXISTS render_hash text,
  ADD COLUMN IF NOT EXISTS template_version_id uuid;

ALTER TABLE public.crm_bulk_send_logs
  ADD CONSTRAINT crm_bulk_send_logs_tenant_template_fkey
    FOREIGN KEY (tenant_id, template_id)
    REFERENCES public.crm_email_templates(tenant_id, id)
    ON DELETE SET NULL,
  ADD CONSTRAINT crm_bulk_send_logs_content_mode_check
    CHECK (content_mode IS NULL OR content_mode = ANY (ARRAY['campaign','newsletter']::text[])),
  ADD CONSTRAINT crm_bulk_send_logs_editor_document_check
    CHECK (
      editor_document IS NULL OR (
        jsonb_typeof(editor_document) = 'object'
        AND editor_document ->> 'type' = 'doc'
        AND jsonb_typeof(editor_document -> 'content') = 'array'
      )
    ),
  ADD CONSTRAINT crm_bulk_send_logs_editor_schema_version_check
    CHECK (editor_schema_version IS NULL OR editor_schema_version > 0),
  ADD CONSTRAINT crm_bulk_send_logs_render_hash_check
    CHECK (render_hash IS NULL OR render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'),
  ADD CONSTRAINT crm_bulk_send_logs_canonical_content_check
    CHECK (
      editor_document IS NULL OR (
        content_mode IS NOT NULL
        AND nullif(btrim(body_html), '') IS NOT NULL
        AND nullif(btrim(body_text), '') IS NOT NULL
        AND nullif(btrim(theme_key), '') IS NOT NULL
        AND editor_schema_version IS NOT NULL
        AND render_hash IS NOT NULL
      )
    ),
  ADD CONSTRAINT crm_bulk_send_logs_template_version_fkey
    FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES public.crm_email_template_versions(tenant_id, id)
    ON DELETE SET NULL;

CREATE INDEX crm_bulk_send_logs_template_version_idx
  ON public.crm_bulk_send_logs(template_version_id)
  WHERE template_version_id IS NOT NULL;

ALTER TABLE public.crm_email_messages
  ADD COLUMN IF NOT EXISTS preheader text,
  ADD COLUMN IF NOT EXISTS render_hash text,
  ADD COLUMN IF NOT EXISTS template_version_id uuid;

ALTER TABLE public.crm_email_messages
  ADD CONSTRAINT crm_email_messages_render_hash_check
    CHECK (render_hash IS NULL OR render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'),
  ADD CONSTRAINT crm_email_messages_template_version_fkey
    FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES public.crm_email_template_versions(tenant_id, id)
    ON DELETE SET NULL;

CREATE INDEX crm_email_messages_tenant_template_version_idx
  ON public.crm_email_messages(tenant_id, template_version_id, occurred_at DESC)
  WHERE template_version_id IS NOT NULL;

ALTER TABLE public.relationship_communications
  ADD COLUMN IF NOT EXISTS rendered_html text,
  ADD COLUMN IF NOT EXISTS rendered_text text,
  ADD COLUMN IF NOT EXISTS rendered_preheader text,
  ADD COLUMN IF NOT EXISTS render_hash text,
  ADD COLUMN IF NOT EXISTS template_version_id uuid;

ALTER TABLE public.relationship_communications
  ADD CONSTRAINT relationship_communications_render_hash_check
    CHECK (render_hash IS NULL OR render_hash ~ '^(sha256:[0-9a-f]{64}|fnv1a32:[0-9a-f]{8})$'),
  ADD CONSTRAINT relationship_communications_canonical_content_check
    CHECK (
      (rendered_html IS NULL AND rendered_text IS NULL AND render_hash IS NULL)
      OR (
        nullif(btrim(rendered_html), '') IS NOT NULL
        AND nullif(btrim(rendered_text), '') IS NOT NULL
        AND render_hash IS NOT NULL
      )
    ),
  ADD CONSTRAINT relationship_communications_template_version_fkey
    FOREIGN KEY (tenant_id, template_version_id)
    REFERENCES public.crm_email_template_versions(tenant_id, id)
    ON DELETE SET NULL;

CREATE INDEX relationship_communications_tenant_template_version_idx
  ON public.relationship_communications(tenant_id, template_version_id, occurred_at DESC)
  WHERE template_version_id IS NOT NULL;

ALTER TABLE public.crm_email_signatures
  ADD COLUMN IF NOT EXISTS body_text text;

CREATE OR REPLACE FUNCTION private.enforce_crm_email_template_version_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  parent_scope text;
BEGIN
  SELECT template.content_scope
  INTO parent_scope
  FROM public.crm_email_templates AS template
  WHERE template.tenant_id = NEW.tenant_id
    AND template.id = NEW.template_id;

  IF parent_scope IS NULL THEN
    RAISE EXCEPTION 'Email template % does not exist in tenant %.', NEW.template_id, NEW.tenant_id;
  END IF;

  IF NEW.content_scope <> parent_scope THEN
    RAISE EXCEPTION 'Template version scope % does not match template scope %.', NEW.content_scope, parent_scope;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_crm_email_template_version_scope
BEFORE INSERT ON public.crm_email_template_versions
FOR EACH ROW EXECUTE FUNCTION private.enforce_crm_email_template_version_scope();

CREATE OR REPLACE FUNCTION private.enforce_email_template_version_reference_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
DECLARE
  version_id uuid;
  actual_scope text;
  expected_scope text := TG_ARGV[1];
BEGIN
  version_id := nullif(to_jsonb(NEW) ->> TG_ARGV[0], '')::uuid;
  IF version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT version.content_scope
  INTO actual_scope
  FROM public.crm_email_template_versions AS version
  WHERE version.tenant_id = NEW.tenant_id
    AND version.id = version_id;

  IF actual_scope IS NULL THEN
    RAISE EXCEPTION 'Email template version % does not exist in tenant %.', version_id, NEW.tenant_id;
  END IF;

  IF actual_scope <> expected_scope THEN
    RAISE EXCEPTION 'Email template version % has scope %, expected %.', version_id, actual_scope, expected_scope;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_crm_campaign_step_template_scope
BEFORE INSERT OR UPDATE OF tenant_id, email_template_version_id ON public.crm_campaign_steps
FOR EACH ROW EXECUTE FUNCTION private.enforce_email_template_version_reference_scope('email_template_version_id', 'client');

CREATE TRIGGER enforce_relationship_campaign_step_template_scope
BEFORE INSERT OR UPDATE OF tenant_id, template_version_id ON public.relationship_campaign_steps
FOR EACH ROW EXECUTE FUNCTION private.enforce_email_template_version_reference_scope('template_version_id', 'relationship');

CREATE TRIGGER enforce_crm_bulk_send_template_scope
BEFORE INSERT OR UPDATE OF tenant_id, template_version_id ON public.crm_bulk_send_logs
FOR EACH ROW EXECUTE FUNCTION private.enforce_email_template_version_reference_scope('template_version_id', 'client');

CREATE TRIGGER enforce_crm_email_message_template_scope
BEFORE INSERT OR UPDATE OF tenant_id, template_version_id ON public.crm_email_messages
FOR EACH ROW EXECUTE FUNCTION private.enforce_email_template_version_reference_scope('template_version_id', 'client');

CREATE TRIGGER enforce_relationship_communication_template_scope
BEFORE INSERT OR UPDATE OF tenant_id, template_version_id ON public.relationship_communications
FOR EACH ROW EXECUTE FUNCTION private.enforce_email_template_version_reference_scope('template_version_id', 'relationship');

CREATE OR REPLACE FUNCTION private.prevent_crm_email_template_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Published email template versions are immutable. Create a new version instead.';
END;
$$;

CREATE TRIGGER prevent_crm_email_template_version_update
BEFORE UPDATE ON public.crm_email_template_versions
FOR EACH ROW EXECUTE FUNCTION private.prevent_crm_email_template_version_mutation();

CREATE TRIGGER prevent_crm_email_template_version_delete
BEFORE DELETE ON public.crm_email_template_versions
FOR EACH ROW EXECUTE FUNCTION private.prevent_crm_email_template_version_mutation();

CREATE OR REPLACE FUNCTION private.prevent_published_crm_email_template_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'draft'
     OR EXISTS (
       SELECT 1
       FROM public.crm_email_template_versions AS version
       WHERE version.tenant_id = OLD.tenant_id
         AND version.template_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Published or versioned email templates must be archived, not deleted.';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER prevent_published_crm_email_template_delete
BEFORE DELETE ON public.crm_email_templates
FOR EACH ROW EXECUTE FUNCTION private.prevent_published_crm_email_template_delete();

REVOKE ALL ON FUNCTION private.enforce_crm_email_template_version_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_email_template_version_reference_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_crm_email_template_version_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.prevent_published_crm_email_template_delete() FROM PUBLIC;

ALTER TABLE public.crm_email_template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage templates" ON public.crm_email_templates;
DROP POLICY IF EXISTS "Tenant members can view templates" ON public.crm_email_templates;
DROP POLICY IF EXISTS crm_email_templates_select ON public.crm_email_templates;
DROP POLICY IF EXISTS crm_email_templates_insert ON public.crm_email_templates;
DROP POLICY IF EXISTS crm_email_templates_update ON public.crm_email_templates;
DROP POLICY IF EXISTS crm_email_templates_delete ON public.crm_email_templates;

CREATE POLICY crm_email_templates_select
ON public.crm_email_templates
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id = crm_email_templates.tenant_id
      AND capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

CREATE POLICY crm_email_templates_insert
ON public.crm_email_templates
FOR INSERT TO authenticated
WITH CHECK (
  created_by_profile_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id = crm_email_templates.tenant_id
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

CREATE POLICY crm_email_templates_update
ON public.crm_email_templates
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id = crm_email_templates.tenant_id
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id = crm_email_templates.tenant_id
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

CREATE POLICY crm_email_templates_delete
ON public.crm_email_templates
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id = crm_email_templates.tenant_id
      AND capability.crm_role = 'crm_admin'::public.crm_capability_role
  )
);

CREATE POLICY crm_email_template_versions_select
ON public.crm_email_template_versions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id = crm_email_template_versions.tenant_id
      AND capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

CREATE POLICY crm_email_template_versions_insert
ON public.crm_email_template_versions
FOR INSERT TO authenticated
WITH CHECK (
  published_by_profile_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id = crm_email_template_versions.tenant_id
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

REVOKE ALL ON public.crm_email_templates, public.crm_email_template_versions
FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_email_templates TO authenticated;
GRANT SELECT, INSERT ON public.crm_email_template_versions TO authenticated;
GRANT ALL ON public.crm_email_templates, public.crm_email_template_versions TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'email-assets',
  'email-assets',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS email_assets_crm_select ON storage.objects;
DROP POLICY IF EXISTS email_assets_crm_insert ON storage.objects;
DROP POLICY IF EXISTS email_assets_crm_update ON storage.objects;
DROP POLICY IF EXISTS email_assets_crm_delete ON storage.objects;

CREATE POLICY email_assets_crm_select
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'email-assets'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = (storage.foldername(name))[1]
      AND capability.crm_role <> 'crm_none'::public.crm_capability_role
  )
);

CREATE POLICY email_assets_crm_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'email-assets'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = (storage.foldername(name))[1]
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

CREATE POLICY email_assets_crm_update
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'email-assets'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = (storage.foldername(name))[1]
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
)
WITH CHECK (
  bucket_id = 'email-assets'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = (storage.foldername(name))[1]
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

CREATE POLICY email_assets_crm_delete
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'email-assets'
  AND EXISTS (
    SELECT 1
    FROM public.crm_user_capabilities capability
    WHERE capability.profile_id = (SELECT auth.uid())
      AND capability.tenant_id::text = (storage.foldername(name))[1]
      AND capability.crm_role = ANY (ARRAY[
        'crm_admin'::public.crm_capability_role,
        'crm_operator'::public.crm_capability_role
      ])
  )
);

COMMENT ON TABLE public.crm_email_templates IS
  'Reusable tenant-scoped Email Studio template identities and editable draft snapshots.';
COMMENT ON TABLE public.crm_email_template_versions IS
  'Immutable published Email Studio snapshots containing editor JSON and exact HTML/text render output.';
COMMENT ON COLUMN public.crm_email_signatures.body_text IS
  'Plain-text fallback for the signature used in dual-format email delivery.';
COMMENT ON COLUMN public.crm_campaign_steps.email_editor_document IS
  'Canonical Email Studio JSON for client campaign email steps; null indicates legacy content.';
COMMENT ON COLUMN public.relationship_campaign_steps.editor_document IS
  'Canonical Email Studio JSON for relationship campaign steps; null indicates legacy content.';
COMMENT ON COLUMN public.crm_bulk_send_logs.editor_document IS
  'Canonical Email Studio JSON snapshot for bulk email/newsletter sends; null indicates legacy content.';
COMMENT ON COLUMN public.crm_email_messages.template_version_id IS
  'Immutable template version used to produce this canonical CRM email snapshot.';
COMMENT ON COLUMN public.relationship_communications.template_version_id IS
  'Immutable relationship-scope template version used to produce this communication snapshot.';
