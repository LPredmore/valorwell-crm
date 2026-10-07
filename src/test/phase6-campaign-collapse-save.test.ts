import { describe, expect, it, vi } from 'vitest';
import type { CampaignStepFormData } from '@/lib/crm/campaign-types';
import {
  applyCanonicalCampaignEmailContent,
  resolveCampaignEmailStepForSave,
} from '@/components/crm/campaigns/campaignStepEmailPersistence';

const oldContent = {
  schemaVersion: 1,
  mode: 'campaign' as const,
  editorDocument: {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old copy' }] }],
  },
  renderedHtml: '<p>Old copy</p>',
  renderedText: 'Old copy',
  preheader: 'Old preheader',
  themeKey: 'valorwell',
  renderHash: 'fnv1a32:old',
};

const latestContent = {
  ...oldContent,
  editorDocument: {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest edited copy' }] }],
  },
  renderedHtml: '<p>Latest edited copy</p>',
  renderedText: 'Latest edited copy',
  preheader: 'Latest preheader',
  renderHash: 'fnv1a32:latest',
};

function step(key: string): CampaignStepFormData {
  return {
    client_key: key,
    step_order: 1,
    delay_days: 0,
    delay_hours: 0,
    channel: 'email',
    email_subject: 'Subject',
    email_body_html: oldContent.renderedHtml,
    email_body_text: oldContent.renderedText,
    email_preheader: oldContent.preheader,
    email_content: oldContent,
    email_template_id: null,
    email_template_version_id: null,
    sms_body_text: '',
    is_active: true,
    signature_id: null,
  };
}

describe('collapsed Campaign Email Studio save fallback', () => {
  it('saves the latest validated snapshot after the editor has unmounted on collapse', async () => {
    const saved = await resolveCampaignEmailStepForSave(step('step-1'), 0, null, latestContent);
    expect(saved.email_content).toEqual(latestContent);
    expect(saved.email_body_html).toBe('<p>Latest edited copy</p>');
    expect(saved.email_body_text).toBe('Latest edited copy');
    expect(saved.email_preheader).toBe('Latest preheader');
    expect(saved.email_content).not.toEqual(oldContent);
  });

  it('prefers the mounted editor export over an older cached snapshot', async () => {
    const mounted = vi.fn().mockResolvedValue(latestContent);
    const saved = await resolveCampaignEmailStepForSave(step('step-1'), 0, mounted, oldContent);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(saved.email_content).toEqual(latestContent);
  });

  it('saves multiple collapsed email steps from their independent canonical snapshots', async () => {
    const second = {
      ...latestContent,
      renderedHtml: '<p>Second latest copy</p>',
      renderedText: 'Second latest copy',
      renderHash: 'fnv1a32:second',
    };
    const saved = await Promise.all([
      resolveCampaignEmailStepForSave(step('step-1'), 0, null, latestContent),
      resolveCampaignEmailStepForSave({ ...step('step-2'), step_order: 2 }, 1, null, second),
    ]);
    expect(saved.map((item) => item.email_body_html)).toEqual([
      '<p>Latest edited copy</p>',
      '<p>Second latest copy</p>',
    ]);
  });

  it('fails closed instead of falling back to stale database content when edited content is invalid', async () => {
    await expect(resolveCampaignEmailStepForSave(step('step-1'), 0, null, null))
      .rejects.toThrow('Step 1 contains invalid Email Studio content.');
  });

  it('normalizes canonical content into every persisted email field', () => {
    expect(applyCanonicalCampaignEmailContent(step('step-1'), latestContent)).toMatchObject({
      email_body_html: latestContent.renderedHtml,
      email_body_text: latestContent.renderedText,
      email_preheader: latestContent.preheader,
      email_content: latestContent,
    });
  });
});
