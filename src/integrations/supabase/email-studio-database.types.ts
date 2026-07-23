// Generated from the live Billing Hub schema after migrations
// 20260723164221 and 20260723165429. The global Supabase type file remains
// unchanged until a runtime pass consumes these tables and can review the
// full generated-schema diff.

import type { Json } from './types';

export type EmailStudioContentScope = 'client' | 'relationship';
export type EmailStudioContentMode = 'direct' | 'campaign' | 'newsletter';
export type EmailStudioTemplateStatus = 'draft' | 'published' | 'archived';

export type CrmEmailTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  body_text: string | null;
  content_scope: EmailStudioContentScope;
  content_mode: EmailStudioContentMode;
  editor_document: Json | null;
  preheader: string | null;
  theme_key: string;
  editor_schema_version: number | null;
  render_hash: string | null;
  status: EmailStudioTemplateStatus;
  current_published_version_id: string | null;
  created_by_profile_id: string;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type CrmEmailTemplateInsert = {
  id?: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  subject: string;
  body_html: string;
  body_text?: string | null;
  content_scope?: EmailStudioContentScope;
  content_mode?: EmailStudioContentMode;
  editor_document?: Json | null;
  preheader?: string | null;
  theme_key?: string;
  editor_schema_version?: number | null;
  render_hash?: string | null;
  status?: EmailStudioTemplateStatus;
  current_published_version_id?: string | null;
  created_by_profile_id: string;
  updated_by_profile_id?: string | null;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
};

export type CrmEmailTemplateUpdate = Partial<Omit<CrmEmailTemplateInsert, 'tenant_id' | 'created_by_profile_id'>> & {
  tenant_id?: string;
  created_by_profile_id?: string;
};

export type CrmEmailTemplateVersionRow = {
  id: string;
  tenant_id: string;
  template_id: string;
  version_number: number;
  content_scope: EmailStudioContentScope;
  content_mode: EmailStudioContentMode;
  subject: string;
  editor_document: Json;
  rendered_html: string;
  rendered_text: string;
  preheader: string | null;
  theme_key: string;
  editor_schema_version: number;
  render_hash: string;
  change_summary: string | null;
  published_by_profile_id: string;
  published_at: string;
  created_at: string;
};

export type CrmEmailTemplateVersionInsert = {
  id?: string;
  tenant_id: string;
  template_id: string;
  version_number: number;
  content_scope: EmailStudioContentScope;
  content_mode: EmailStudioContentMode;
  subject: string;
  editor_document: Json;
  rendered_html: string;
  rendered_text: string;
  preheader?: string | null;
  theme_key: string;
  editor_schema_version: number;
  render_hash: string;
  change_summary?: string | null;
  published_by_profile_id: string;
  published_at?: string;
  created_at?: string;
};

export type ClientCampaignEmailContentColumns = {
  email_content_mode: Exclude<EmailStudioContentMode, 'direct'> | null;
  email_editor_document: Json | null;
  email_body_text: string | null;
  email_preheader: string | null;
  email_theme_key: string | null;
  email_editor_schema_version: number | null;
  email_render_hash: string | null;
  email_template_version_id: string | null;
};

export type RelationshipCampaignEmailContentColumns = {
  content_mode: Exclude<EmailStudioContentMode, 'direct'> | null;
  editor_document: Json | null;
  body_html_template: string | null;
  body_text_template: string | null;
  preheader_template: string | null;
  theme_key: string | null;
  editor_schema_version: number | null;
  render_hash: string | null;
  template_version_id: string | null;
};

export type CrmBulkEmailContentColumns = {
  body_text: string | null;
  editor_document: Json | null;
  preheader: string | null;
  content_mode: Exclude<EmailStudioContentMode, 'direct'> | null;
  theme_key: string | null;
  editor_schema_version: number | null;
  render_hash: string | null;
  template_version_id: string | null;
};

export type CrmEmailMessageContentColumns = {
  preheader: string | null;
  render_hash: string | null;
  template_version_id: string | null;
};

export type RelationshipCommunicationContentColumns = {
  rendered_html: string | null;
  rendered_text: string | null;
  rendered_preheader: string | null;
  render_hash: string | null;
  template_version_id: string | null;
};

export type CrmEmailSignatureContentColumns = {
  body_text: string | null;
};
