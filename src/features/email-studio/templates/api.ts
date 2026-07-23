import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type {
  CrmEmailTemplateRow,
  CrmEmailTemplateVersionRow,
  EmailStudioContentMode,
  EmailStudioContentScope,
} from '@/integrations/supabase/email-studio-database.types';
import type { EmailEditorDocument } from '../contracts';
import { EMAIL_STUDIO_THEME_KEYS, type EmailStudioThemeKey } from '../studio/config';
import {
  readEmailAssetDimensions,
  sanitizeEmailAssetFilename,
  validateEmailAssetDimensions,
  validateEmailAssetInput,
} from './validation';
import type {
  EmailAssetRecord,
  EmailStudioAccessContext,
  EmailTemplateFilters,
  EmailTemplateRecord,
  EmailTemplateVersionRecord,
  PublishEmailTemplateResult,
  SaveEmailTemplateDraftInput,
} from './types';

type RawTemplateRow = CrmEmailTemplateRow & { is_active: boolean };

type EmailStudioDatabase = {
  public: {
    Tables: {
      crm_email_templates: {
        Row: RawTemplateRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      crm_email_template_versions: {
        Row: CrmEmailTemplateVersionRow;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      crm_email_studio_context: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      crm_email_template_save_draft: {
        Args: {
          p_template_id: string | null;
          p_name: string;
          p_description: string;
          p_subject: string;
          p_content_scope: string;
          p_content_mode: string;
          p_editor_document: Json;
          p_body_html: string;
          p_body_text: string;
          p_preheader: string;
          p_theme_key: string;
          p_editor_schema_version: number;
          p_render_hash: string;
        };
        Returns: Json;
      };
      crm_email_template_reopen_draft: { Args: { p_template_id: string }; Returns: Json };
      crm_email_template_publish: {
        Args: { p_template_id: string; p_change_summary: string };
        Returns: Json;
      };
      crm_email_template_copy: {
        Args: { p_template_id: string; p_name: string };
        Returns: Json;
      };
      crm_email_template_archive: { Args: { p_template_id: string }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const client = supabase as unknown as SupabaseClient<EmailStudioDatabase>;

export async function getEmailStudioAccessContext(): Promise<EmailStudioAccessContext> {
  const { data, error } = await client.rpc('crm_email_studio_context');
  if (error) throw new Error(error.message);
  const value = asRecord(data);
  return {
    profileId: requiredString(value.profile_id, 'Email Studio profile'),
    tenantId: requiredString(value.tenant_id, 'Email Studio tenant'),
    canRead: value.can_read === true,
    canManage: value.can_manage === true,
  };
}

export async function listEmailTemplates(filters?: Partial<EmailTemplateFilters>): Promise<EmailTemplateRecord[]> {
  const { data, error } = await client
    .from('crm_email_templates')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);

  const search = filters?.search?.trim().toLowerCase() || '';
  return (data || [])
    .map(mapTemplate)
    .filter((template) => filters?.status && filters.status !== 'all' ? template.status === filters.status : true)
    .filter((template) => filters?.scope && filters.scope !== 'all' ? template.scope === filters.scope : true)
    .filter((template) => search
      ? [template.name, template.description || '', template.subject].some((value) => value.toLowerCase().includes(search))
      : true);
}

export async function getEmailTemplate(templateId: string): Promise<EmailTemplateRecord> {
  const { data, error } = await client
    .from('crm_email_templates')
    .select('*')
    .eq('id', templateId)
    .single();
  if (error) throw new Error(error.message);
  return mapTemplate(data);
}

export async function listEmailTemplateVersions(templateId: string): Promise<EmailTemplateVersionRecord[]> {
  const { data, error } = await client
    .from('crm_email_template_versions')
    .select('*')
    .eq('template_id', templateId)
    .order('version_number', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapVersion);
}

export async function saveEmailTemplateDraft(input: SaveEmailTemplateDraftInput): Promise<EmailTemplateRecord> {
  const { data, error } = await client.rpc('crm_email_template_save_draft', {
    p_template_id: input.templateId || null,
    p_name: input.name.trim(),
    p_description: input.description.trim(),
    p_subject: input.subject.trim(),
    p_content_scope: input.scope,
    p_content_mode: input.content.mode,
    p_editor_document: input.content.editorDocument as unknown as Json,
    p_body_html: input.content.renderedHtml,
    p_body_text: input.content.renderedText,
    p_preheader: input.content.preheader || '',
    p_theme_key: input.content.themeKey,
    p_editor_schema_version: input.content.schemaVersion,
    p_render_hash: input.content.renderHash,
  });
  if (error) throw new Error(error.message);
  return mapTemplate(asRecord(data) as unknown as RawTemplateRow);
}

export async function reopenEmailTemplateDraft(templateId: string): Promise<EmailTemplateRecord> {
  const { data, error } = await client.rpc('crm_email_template_reopen_draft', { p_template_id: templateId });
  if (error) throw new Error(error.message);
  return mapTemplate(asRecord(data) as unknown as RawTemplateRow);
}

export async function publishEmailTemplate(
  templateId: string,
  changeSummary: string,
): Promise<PublishEmailTemplateResult> {
  const { data, error } = await client.rpc('crm_email_template_publish', {
    p_template_id: templateId,
    p_change_summary: changeSummary.trim(),
  });
  if (error) throw new Error(error.message);
  const value = asRecord(data);
  return {
    templateId: requiredString(value.template_id, 'Published template'),
    versionId: requiredString(value.version_id, 'Published version'),
    versionNumber: requiredNumber(value.version_number, 'Published version number'),
    renderHash: requiredString(value.render_hash, 'Published render hash'),
    publishedAt: requiredString(value.published_at, 'Published timestamp'),
  };
}

export async function copyEmailTemplate(templateId: string, name: string): Promise<EmailTemplateRecord> {
  const { data, error } = await client.rpc('crm_email_template_copy', {
    p_template_id: templateId,
    p_name: name.trim(),
  });
  if (error) throw new Error(error.message);
  return mapTemplate(asRecord(data) as unknown as RawTemplateRow);
}

export async function archiveEmailTemplate(templateId: string): Promise<EmailTemplateRecord> {
  const { data, error } = await client.rpc('crm_email_template_archive', { p_template_id: templateId });
  if (error) throw new Error(error.message);
  return mapTemplate(asRecord(data) as unknown as RawTemplateRow);
}

export async function listEmailAssets(context: EmailStudioAccessContext): Promise<EmailAssetRecord[]> {
  const { data, error } = await supabase.storage
    .from('email-assets')
    .list(context.tenantId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw new Error(error.message);

  return (data || [])
    .filter((file) => file.id)
    .map((file) => {
      const path = `${context.tenantId}/${file.name}`;
      const metadata = asRecord(file.metadata);
      return {
        path,
        name: file.name,
        publicUrl: supabase.storage.from('email-assets').getPublicUrl(path).data.publicUrl,
        mimeType: stringValue(metadata.mimetype) || stringValue(metadata.contentType) || 'application/octet-stream',
        sizeBytes: numberValue(metadata.size),
        width: nullableNumber(metadata.width),
        height: nullableNumber(metadata.height),
        altText: stringValue(metadata.alt_text) || stringValue(metadata.altText),
        createdAt: file.created_at || null,
        updatedAt: file.updated_at || null,
      };
    });
}

export async function uploadEmailAsset(
  context: EmailStudioAccessContext,
  file: File,
  altText: string,
): Promise<EmailAssetRecord> {
  const inputIssues = validateEmailAssetInput(file, altText);
  if (inputIssues.length) throw new Error(inputIssues.join(' '));

  const dimensions = await readEmailAssetDimensions(file);
  const dimensionIssues = validateEmailAssetDimensions(dimensions.width, dimensions.height);
  if (dimensionIssues.length) throw new Error(dimensionIssues.join(' '));

  const safeName = sanitizeEmailAssetFilename(file.name);
  const uniquePrefix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${context.tenantId}/${uniquePrefix}-${safeName}`;
  const { error } = await supabase.storage.from('email-assets').upload(path, file, {
    upsert: false,
    contentType: file.type,
    cacheControl: '3600',
    metadata: {
      alt_text: altText.trim(),
      width: dimensions.width,
      height: dimensions.height,
    },
  });
  if (error) throw new Error(error.message);

  return {
    path,
    name: path.split('/').pop() || safeName,
    publicUrl: supabase.storage.from('email-assets').getPublicUrl(path).data.publicUrl,
    mimeType: file.type,
    sizeBytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
    altText: altText.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteEmailAsset(context: EmailStudioAccessContext, path: string): Promise<void> {
  if (!path.startsWith(`${context.tenantId}/`)) throw new Error('The selected asset is outside the active tenant.');
  const { error } = await supabase.storage.from('email-assets').remove([path]);
  if (error) throw new Error(error.message);
}

function mapTemplate(row: RawTemplateRow): EmailTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    subject: row.subject,
    scope: row.content_scope,
    mode: row.content_mode,
    editorDocument: isEditorDocument(row.editor_document) ? row.editor_document : null,
    renderedHtml: row.body_html,
    renderedText: row.body_text || '',
    preheader: row.preheader,
    themeKey: normalizeThemeKey(row.theme_key),
    schemaVersion: row.editor_schema_version,
    renderHash: row.render_hash,
    status: row.status,
    currentPublishedVersionId: row.current_published_version_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function mapVersion(row: CrmEmailTemplateVersionRow): EmailTemplateVersionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    scope: row.content_scope,
    mode: row.content_mode,
    subject: row.subject,
    editorDocument: row.editor_document as unknown as EmailEditorDocument,
    renderedHtml: row.rendered_html,
    renderedText: row.rendered_text,
    preheader: row.preheader,
    themeKey: normalizeThemeKey(row.theme_key),
    schemaVersion: row.editor_schema_version,
    renderHash: row.render_hash,
    changeSummary: row.change_summary,
    publishedByProfileId: row.published_by_profile_id,
    publishedAt: row.published_at,
  };
}

function normalizeThemeKey(value: string): EmailStudioThemeKey {
  return EMAIL_STUDIO_THEME_KEYS.includes(value as EmailStudioThemeKey)
    ? value as EmailStudioThemeKey
    : 'valorwell';
}

function isEditorDocument(value: Json | null): value is Json & EmailEditorDocument {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as Record<string, Json | undefined>;
  return record.type === 'doc' && Array.isArray(record.content);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} was not returned by the server.`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} was not returned by the server.`);
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export type { EmailStudioContentMode, EmailStudioContentScope };
