import { describe, expect, it } from 'vitest';
import {
  createEmailContentDraftFromEditorExport,
  createEmailRenderHash,
  finalizeEmailContentDocument,
  renderEmailTemplate,
} from '@/features/email-studio/contracts';
import { createEmailStudioDocument } from '@/features/email-studio/studio/documents';
import { validateEmailStudioEditorDocument } from '@/features/email-studio/studio/validation';
import {
  createCanonicalStaffEmailRenderHash,
  prepareStaffBroadcastDelivery,
} from '../../supabase/functions/crm-resend-staff-broadcast/staff-email-content';

describe('staff Email Studio scope', () => {
  it('allows internal Newsletter mode without a promotional compliance footer', () => {
    const document = createEmailStudioDocument({ mode: 'newsletter', scope: 'staff' });
    const validation = validateEmailStudioEditorDocument(document, 'newsletter', 'staff');
    expect(validation.valid).toBe(true);
    expect(validation.issues.some((issue) => issue.code === 'missing_compliance_footer')).toBe(false);
  });

  it('rejects client variables in staff content', () => {
    const result = renderEmailTemplate(
      'Hello {{first_name}}',
      'staff',
      { staff_first_name: 'Morgan' },
      'text',
    );
    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues[0]?.code).toBe('disallowed_variable_scope');
  });

  it('renders staff variables with browser/server hash parity and HTML escaping', async () => {
    const editorDocument = createEmailStudioDocument({ mode: 'newsletter', scope: 'staff' });
    const draft = createEmailContentDraftFromEditorExport({
      mode: 'newsletter',
      editorDocument,
      html: '<p>Hi {{staff_first_name}}</p><p>{{staff_role}}</p>',
      text: 'Hi {{staff_first_name}}\n{{staff_role}}',
      preheader: 'For {{staff_display_name}}',
      themeKey: 'valorwell',
    });
    const browserHash = await createEmailRenderHash(draft);
    const finalized = await finalizeEmailContentDocument(draft, 'staff');
    expect(finalized.document?.renderHash).toBe(browserHash);

    const prepared = await prepareStaffBroadcastDelivery({
      subjectTemplate: 'Update for {{staff_first_name}}',
      content: finalized.document,
      values: {
        staff_first_name: 'M & M',
        staff_last_name: 'Lee',
        staff_display_name: 'M & M Lee',
        staff_role: 'Clinician',
        sender_name: 'ValorWell Operations',
      },
    });
    expect(prepared.subject).toBe('Update for M & M');
    expect(prepared.html).toContain('M &amp; M');
    expect(prepared.text).toContain('M & M');
  });

  it('verifies a stored FNV-1a32 hash even when SHA-256 is available', async () => {
    const content = {
      schemaVersion: 1,
      mode: 'newsletter' as const,
      editorDocument: createEmailStudioDocument({ mode: 'newsletter', scope: 'staff' }),
      renderedHtml: '<p>Hi {{staff_first_name}}</p>',
      renderedText: 'Hi {{staff_first_name}}',
      preheader: 'For {{staff_display_name}}',
      themeKey: 'valorwell',
    };
    const renderHash = await createCanonicalStaffEmailRenderHash(content, 'fnv1a32');
    expect(renderHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);

    const prepared = await prepareStaffBroadcastDelivery({
      subjectTemplate: 'Staff update',
      content: { ...content, renderHash },
      values: {
        staff_first_name: 'Morgan',
        staff_last_name: 'Lee',
        staff_display_name: 'Morgan Lee',
        staff_role: 'Clinician',
        sender_name: 'ValorWell Operations',
      },
    });
    expect(prepared.renderHash).toBe(renderHash);
    expect(prepared.html).toContain('Morgan');
  });

  it('fails closed when a required staff value is missing', async () => {
    const editorDocument = createEmailStudioDocument({ mode: 'newsletter', scope: 'staff' });
    const draft = {
      schemaVersion: 1,
      mode: 'newsletter' as const,
      editorDocument,
      renderedHtml: '<p>{{staff_first_name}}</p>',
      renderedText: '{{staff_first_name}}',
      preheader: null,
      themeKey: 'valorwell',
    };
    const content = { ...draft, renderHash: await createEmailRenderHash(draft) };
    await expect(prepareStaffBroadcastDelivery({
      subjectTemplate: 'Staff update',
      content,
      values: {},
    })).rejects.toThrow('MISSING_EMAIL_VARIABLE:staff_first_name');
  });
});
