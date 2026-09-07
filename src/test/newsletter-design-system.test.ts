import { describe, expect, it } from 'vitest';
import {
  EMAIL_STUDIO_LAYOUT,
  EMAIL_STUDIO_THEMES,
  getEmailStudioBlockPresentation,
} from '@/features/email-studio/studio/config';
import {
  EMAIL_STUDIO_PRESETS,
  createEmailStudioDocument,
  createEmailStudioPresetDocument,
  createValorWellWeeklyNewsletterDocument,
} from '@/features/email-studio/studio/documents';
import { validateEmailStudioEditorDocument } from '@/features/email-studio/studio/validation';

function blocks(document: ReturnType<typeof createValorWellWeeklyNewsletterDocument>) {
  return document.content.filter((node) => node.type === 'emailStudioBlock');
}

describe('N3 ValorWell newsletter design system', () => {
  it('defines the restrained ValorWell brand palette and email-safe layout tokens', () => {
    expect(EMAIL_STUDIO_THEMES.valorwell).toMatchObject({
      accentColor: '#315B45',
      secondaryAccentColor: '#C69A45',
      backgroundColor: '#F5F3ED',
      surfaceColor: '#FFFFFF',
      textColor: '#202823',
      buttonColor: '#C69A45',
      fontFamily: 'Arial, Helvetica, sans-serif',
    });
    expect(EMAIL_STUDIO_LAYOUT).toEqual({
      contentWidth: 600,
      outerPadding: 24,
      sectionGap: 20,
      cardRadius: 12,
      imageRadius: 10,
    });
  });

  it('makes ValorWell Weekly the default canonical marketing newsletter document', () => {
    const expected = createValorWellWeeklyNewsletterDocument();
    const actual = createEmailStudioDocument({
      mode: 'newsletter',
      scope: 'marketing_newsletter',
      themeKey: 'valorwell',
    });

    expect(actual).toEqual(expected);
    expect(blocks(actual).map((node) => node.attrs?.kind)).toEqual([
      'hero',
      'text',
      'story',
      'callout',
      'resource',
      'bty',
      'cta',
      'divider',
      'social-footer',
      'compliance-footer',
    ]);
    expect(validateEmailStudioEditorDocument(actual, 'newsletter', 'marketing_newsletter').valid).toBe(true);
  });

  it('keeps the weekly starter truthful, mailbox-safe, and ready for operator images', () => {
    const document = createValorWellWeeklyNewsletterDocument();
    const newsletterBlocks = blocks(document);
    const serialized = JSON.stringify(document);

    expect(serialized).toContain('{{newsletter_greeting_name}}');
    expect(serialized).not.toContain('{{first_name}}');
    expect(serialized).not.toContain('images.unsplash.com');
    expect(newsletterBlocks.every((node) => node.attrs?.themeKey === 'valorwell')).toBe(true);

    const compliance = newsletterBlocks.find((node) => node.attrs?.kind === 'compliance-footer');
    expect(compliance?.attrs?.locked).toBe(true);
    expect(String(compliance?.attrs?.body)).toContain('{{unsubscribe_url}}');
    expect(String(compliance?.attrs?.body)).toContain('{{postal_address}}');
  });

  it('registers one first-class ValorWell Weekly preset and reproduces the canonical weekly document', () => {
    const preset = EMAIL_STUDIO_PRESETS.find((entry) => entry.key === 'valorwell-weekly');
    expect(preset).toMatchObject({
      label: 'ValorWell Weekly',
      mode: 'newsletter',
      themeKey: 'valorwell',
    });

    const created = createEmailStudioPresetDocument('valorwell-weekly', 'marketing_newsletter');
    expect(created.mode).toBe('newsletter');
    expect(created.themeKey).toBe('valorwell');
    expect(created.document).toEqual(createValorWellWeeklyNewsletterDocument());
  });

  it('keeps the shared Weekly preset valid when another Email Studio scope selects it', () => {
    const staff = createEmailStudioPresetDocument('valorwell-weekly', 'staff');
    const serialized = JSON.stringify(staff.document);

    expect(serialized).toContain('{{staff_first_name}}');
    expect(serialized).not.toContain('{{newsletter_greeting_name}}');
    expect(blocks(staff.document).some((node) => node.attrs?.kind === 'compliance-footer')).toBe(false);
    expect(validateEmailStudioEditorDocument(staff.document, 'newsletter', 'staff').valid).toBe(true);
  });

  it('uses distinct but consistent visual treatments for the weekly hierarchy', () => {
    const hero = getEmailStudioBlockPresentation('hero', 'valorwell');
    const callout = getEmailStudioBlockPresentation('callout', 'valorwell');
    const cta = getEmailStudioBlockPresentation('cta', 'valorwell');
    const footer = getEmailStudioBlockPresentation('compliance-footer', 'valorwell');

    expect(hero).toMatchObject({
      backgroundColor: '#315B45',
      textAlign: 'center',
      titleSize: 30,
      borderRadius: 14,
    });
    expect(callout.borderLeftColor).toBe('#C69A45');
    expect(cta).toMatchObject({
      linkKind: 'button',
      linkBackgroundColor: '#C69A45',
      linkColor: '#18221C',
      textAlign: 'center',
    });
    expect(footer).toMatchObject({
      footer: true,
      bodySize: 12,
      borderRadius: 0,
    });
  });
});
