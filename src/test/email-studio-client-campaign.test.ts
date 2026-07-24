import { describe, expect, it } from 'vitest';
import { campaignStepsPayload } from '@/hooks/crm/useCampaignSteps';
import type { CampaignStepFormData } from '@/lib/crm/campaign-types';

const canonicalContent = {
  schemaVersion: 1,
  mode: 'campaign' as const,
  editorDocument: {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello {{first_name}}' }] }],
  },
  renderedHtml: '<p>Hello {{first_name}}</p>',
  renderedText: 'Hello {{first_name}}',
  preheader: 'A care-team update',
  themeKey: 'valorwell',
  renderHash: 'fnv1a32:1234abcd',
};

function baseStep(): CampaignStepFormData {
  return {
    client_key: 'step-1',
    id: '11111111-1111-4111-8111-111111111111',
    step_order: 1,
    delay_days: 0,
    delay_hours: 0,
    channel: 'email',
    email_subject: 'Hello {{first_name}}',
    email_body_html: '<p>Legacy</p>',
    email_body_text: '',
    email_preheader: '',
    email_content: null,
    email_template_id: null,
    email_template_version_id: null,
    sms_body_text: '',
    is_active: true,
    signature_id: null,
  };
}

describe('Email Studio client campaign integration', () => {
  it('serializes a canonical client Campaign snapshot and version attribution', () => {
    const step = {
      ...baseStep(),
      email_content: canonicalContent,
      email_template_id: '22222222-2222-4222-8222-222222222222',
      email_template_version_id: '33333333-3333-4333-8333-333333333333',
    };

    expect(campaignStepsPayload([step])).toEqual([expect.objectContaining({
      email_content_mode: 'campaign',
      email_editor_document: canonicalContent.editorDocument,
      email_body_html: canonicalContent.renderedHtml,
      email_body_text: canonicalContent.renderedText,
      email_preheader: canonicalContent.preheader,
      email_theme_key: canonicalContent.themeKey,
      email_editor_schema_version: canonicalContent.schemaVersion,
      email_render_hash: canonicalContent.renderHash,
      email_template_id: '22222222-2222-4222-8222-222222222222',
      email_template_version_id: '33333333-3333-4333-8333-333333333333',
    })]);
  });

  it('preserves the legacy payload shape until an operator exports canonical content', () => {
    expect(campaignStepsPayload([baseStep()])).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      step_order: 1,
      delay_days: 0,
      delay_hours: 0,
      channel: 'email',
      email_subject: 'Hello {{first_name}}',
      email_body_html: '<p>Legacy</p>',
      sms_body_text: null,
      is_active: true,
      signature_id: null,
    }]);
  });

  it('keeps SMS payloads free of Email Studio fields', () => {
    const step = { ...baseStep(), channel: 'sms' as const, sms_body_text: 'Hello {{first_name}}' };
    expect(campaignStepsPayload([step])[0]).toEqual(expect.objectContaining({
      channel: 'sms',
      email_subject: null,
      email_body_html: null,
      sms_body_text: 'Hello {{first_name}}',
      signature_id: null,
    }));
    expect(campaignStepsPayload([step])[0]).not.toHaveProperty('email_editor_document');
  });
});
