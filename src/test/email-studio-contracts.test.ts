import { describe, expect, it } from 'vitest';
import {
  EMAIL_EDITOR_SCHEMA_VERSION,
  createEmailContentDraftFromEditorExport,
  createEmailRenderHash,
  finalizeEmailContentDocument,
  getEmailVariablesForScope,
  importLegacyHtmlEmail,
  normalizeEmailTemplateVariables,
  renderEmailTemplate,
  resolveEmailVariableKey,
  validateEmailContentDraft,
  validateEmailEditorDocumentVariables,
  validateEmailTemplateVariables,
  type EmailContentDraft,
  type EmailEditorDocument,
} from '@/features/email-studio/contracts';

const clientDocument: EmailEditorDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hi ' },
        { type: 'emailVariable', attrs: { key: 'first_name', label: 'Client first name' } },
      ],
    },
  ],
};

function createDraft(overrides: Partial<EmailContentDraft> = {}): EmailContentDraft {
  return {
    schemaVersion: EMAIL_EDITOR_SCHEMA_VERSION,
    mode: 'direct',
    editorDocument: clientDocument,
    renderedHtml: '<p>Hi {{first_name}}</p>',
    renderedText: 'Hi {{first_name}}',
    preheader: 'A message from ValorWell.',
    themeKey: 'valorwell',
    ...overrides,
  };
}

describe('email studio canonical contracts', () => {
  it('keeps client and relationship variables isolated while sharing system variables', () => {
    const clientKeys = getEmailVariablesForScope('client').map((variable) => variable.key);
    const relationshipKeys = getEmailVariablesForScope('relationship').map((variable) => variable.key);

    expect(clientKeys).toContain('first_name');
    expect(clientKeys).toContain('unsubscribe_url');
    expect(clientKeys).not.toContain('organization_name');
    expect(relationshipKeys).toContain('organization_name');
    expect(relationshipKeys).toContain('unsubscribe_url');
    expect(relationshipKeys).not.toContain('preferred_name');
    expect(resolveEmailVariableKey('preferred_name', 'relationship').status).toBe('disallowed');
    expect(resolveEmailVariableKey('organization_name', 'client').status).toBe('disallowed');
  });

  it('accepts relationship legacy aliases and normalizes them to one canonical vocabulary', () => {
    const source = 'Hi {{recipient_name}} and {{first_name}}. {{unsubscribe_link}} {{valorwell_postal_address}}';
    const normalized = normalizeEmailTemplateVariables(source, 'relationship');
    const validation = validateEmailTemplateVariables(source, 'relationship');

    expect(normalized.normalized).toBe(
      'Hi {{contact_display_name}} and {{contact_first_name}}. {{unsubscribe_url}} {{postal_address}}',
    );
    expect(normalized.replacements).toHaveLength(4);
    expect(validation.valid).toBe(true);
    expect(validation.warnings).toHaveLength(4);
  });

  it('blocks unknown and cross-domain variables', () => {
    const unknown = validateEmailTemplateVariables('Hello {{made_up_field}}', 'relationship');
    const crossDomain = validateEmailTemplateVariables('Hello {{preferred_name}}', 'relationship');

    expect(unknown.valid).toBe(false);
    expect(unknown.errors[0]?.code).toBe('unknown_variable');
    expect(crossDomain.valid).toBe(false);
    expect(crossDomain.errors[0]?.code).toBe('disallowed_variable_scope');
  });

  it('escapes HTML variable values but preserves plain-text values', () => {
    const values = { contact_display_name: '<Alex & "Team">' } as const;
    const html = renderEmailTemplate('Hello {{contact_display_name}}', 'relationship', values, 'html');
    const text = renderEmailTemplate('Hello {{contact_display_name}}', 'relationship', values, 'text');

    expect(html.validation.valid).toBe(true);
    expect(html.output).toBe('Hello &lt;Alex &amp; &quot;Team&quot;&gt;');
    expect(text.output).toBe('Hello <Alex & "Team">');
  });

  it('validates URL variables separately from text variables', () => {
    const invalid = renderEmailTemplate(
      'Manage preferences: {{unsubscribe_url}}',
      'relationship',
      { unsubscribe_url: 'javascript:alert(1)' },
      'html',
    );
    const valid = renderEmailTemplate(
      'Manage preferences: {{unsubscribe_url}}',
      'relationship',
      { unsubscribe_url: 'https://crm.valorwell.org/unsubscribe/example' },
      'html',
    );

    expect(invalid.validation.valid).toBe(false);
    expect(invalid.validation.errors[0]?.code).toBe('invalid_url_variable');
    expect(valid.validation.valid).toBe(true);
  });

  it('validates structured variable nodes against the selected content scope', () => {
    const relationshipVariableInClientDocument: EmailEditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'emailVariable', attrs: { key: 'organization_name' } }],
        },
      ],
    };

    const result = validateEmailEditorDocumentVariables(relationshipVariableInClientDocument, 'client');
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe('disallowed_variable_scope');
  });

  it('creates a stable canonical document and render hash from editor exports', async () => {
    const draft = createEmailContentDraftFromEditorExport({
      mode: 'direct',
      editorDocument: clientDocument,
      html: '<p>Hi {{first_name}}</p>',
      text: 'Hi {{first_name}}',
      preheader: ' A message from ValorWell. ',
      themeKey: ' valorwell ',
    });
    const first = await finalizeEmailContentDocument(draft, 'client');
    const secondHash = await createEmailRenderHash(draft);

    expect(first.validation.valid).toBe(true);
    expect(first.document?.renderHash).toBe(secondHash);
    expect(first.document?.renderHash).toMatch(/^(sha256|fnv1a32):/);
    expect(first.document?.preheader).toBe('A message from ValorWell.');
    expect(first.document?.themeKey).toBe('valorwell');
  });

  it('does not trust arbitrary legacy HTML as canonical editor structure', () => {
    const imported = importLegacyHtmlEmail({
      mode: 'campaign',
      html: '<style>body{display:none}</style><h1>Update</h1><script>alert(1)</script><p>Hello team.</p>',
    });

    expect(imported.requiresManualReview).toBe(true);
    expect(imported.warnings).toHaveLength(2);
    expect(imported.draft.renderedHtml).toContain('<script>');
    expect(imported.draft.renderedText).toBe('Update\nHello team.');
    expect(imported.draft.editorDocument.content[0]?.type).toBe('paragraph');
  });

  it('blocks incomplete canonical drafts before hashing or persistence', () => {
    const result = validateEmailContentDraft(
      createDraft({ renderedHtml: '', renderedText: '', themeKey: '' }),
      'client',
    );

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing_rendered_html', 'missing_rendered_text', 'missing_theme_key']),
    );
  });
});
