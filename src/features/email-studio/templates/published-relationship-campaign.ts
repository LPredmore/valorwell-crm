import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type {
  CrmEmailTemplateRow,
  CrmEmailTemplateVersionRow,
} from '@/integrations/supabase/email-studio-database.types';
import type { EmailContentDocument, EmailEditorDocument } from '../contracts';
import { EMAIL_STUDIO_THEME_KEYS, type EmailStudioThemeKey } from '../studio/config';
import type { PublishedRelationshipCampaignTemplate } from './types';

type RawTemplateRow = CrmEmailTemplateRow & { is_active: boolean };

type RelationshipTemplateDatabase = {
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
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const client = supabase as unknown as SupabaseClient<RelationshipTemplateDatabase>;

export async function listPublishedRelationshipCampaignTemplates(): Promise<PublishedRelationshipCampaignTemplate[]> {
  const { data: templateData, error: templateError } = await client
    .from('crm_email_templates')
    .select('*')
    .eq('content_scope', 'relationship')
    .eq('content_mode', 'campaign')
    .eq('status', 'published')
    .eq('is_active', true)
    .not('current_published_version_id', 'is', null)
    .order('name', { ascending: true });
  if (templateError) throw new Error(templateError.message);
  const templates = (templateData || []) as unknown as RawTemplateRow[];
  const versionIds = templates
    .map((template) => template.current_published_version_id)
    .filter((value): value is string => Boolean(value));
  if (versionIds.length === 0) return [];

  const { data: versionData, error: versionError } = await client
    .from('crm_email_template_versions')
    .select('*')
    .in('id', versionIds);
  if (versionError) throw new Error(versionError.message);
  const versions = (versionData || []) as unknown as CrmEmailTemplateVersionRow[];
  const versionById = new Map(versions.map((version) => [version.id, version]));

  return templates.flatMap((template) => {
    const versionId = template.current_published_version_id;
    const version = versionId ? versionById.get(versionId) : undefined;
    if (!version || version.content_scope !== 'relationship' || version.content_mode !== 'campaign') return [];
    if (!isEditorDocument(version.editor_document)) return [];
    const content: EmailContentDocument = {
      schemaVersion: version.editor_schema_version,
      mode: 'campaign',
      editorDocument: version.editor_document,
      renderedHtml: version.rendered_html,
      renderedText: version.rendered_text,
      preheader: version.preheader,
      themeKey: normalizeThemeKey(version.theme_key),
      renderHash: version.render_hash,
    };
    return [{
      templateId: template.id,
      versionId: version.id,
      name: template.name,
      description: template.description,
      subject: version.subject,
      versionNumber: version.version_number,
      content,
      publishedAt: version.published_at,
    }];
  });
}

function normalizeThemeKey(value: string): EmailStudioThemeKey {
  return EMAIL_STUDIO_THEME_KEYS.includes(value as EmailStudioThemeKey)
    ? value as EmailStudioThemeKey
    : 'plain-outreach';
}

function isEditorDocument(value: unknown): value is EmailEditorDocument {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as { type?: unknown; content?: unknown };
  return record.type === 'doc' && Array.isArray(record.content);
}
