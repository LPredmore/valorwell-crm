import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNewsletterTemplatesSchedulable,
} from '@/lib/crm/newsletter-control-plane';
import {
  renderNewsletterDelivery,
  validateNewsletterTemplateContract,
} from '../../supabase/functions/newsletter-send-worker/rendering';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 2 newsletter rendering contract', () => {
  it('renders the canonical greeting consistently in subject, body, text, and preheader', () => {
    const rendered = renderNewsletterDelivery({
      template: {
        subject: 'Hello {{newsletter_greeting_name}}',
        html: '<p>Hi {{newsletter_greeting_name}}</p>',
        text: 'Hi {{newsletter_greeting_name}}',
        preheader: 'A note for {{newsletter_greeting_name}}',
      },
      greetingName: 'Luke',
      senderName: 'ValorWell',
      unsubscribeUrl: 'https://example.org/unsubscribe?token=abc',
      postalAddress: '100 Main Street, Kansas City, MO',
    });

    expect(rendered.subject).toBe('Hello Luke');
    expect(rendered.html).toContain('<p>Hi Luke</p>');
    expect(rendered.text).toContain('Hi Luke');
    expect(rendered.preheader).toBe('A note for Luke');
    expect(rendered.html).toContain('display:none');
    expect(rendered.html).toContain('A note for Luke');
  });

  it('supports the mailbox-safe sender and system variables', () => {
    const rendered = renderNewsletterDelivery({
      template: {
        subject: 'News from {{sender_name}}',
        html: '<p>{{postal_address}}</p><a href="{{unsubscribe_url}}">Unsubscribe</a>',
        text: '{{postal_address}}\n{{unsubscribe_url}}',
        preheader: null,
      },
      greetingName: 'Friend',
      senderName: 'ValorWell Foundation',
      unsubscribeUrl: 'https://example.org/unsubscribe?token=a&b=1',
      postalAddress: '100 Main & First, Kansas City, MO',
    });

    expect(rendered.subject).toBe('News from ValorWell Foundation');
    expect(rendered.html).toContain('100 Main &amp; First');
    expect(rendered.html).toContain('token=a&amp;b=1');
    expect(rendered.text).toContain('100 Main & First');
    expect(rendered.unsubscribeLink).toBe('https://example.org/unsubscribe?token=a&b=1');
  });

  it('escapes recipient-controlled greeting values in HTML but not text', () => {
    const rendered = renderNewsletterDelivery({
      template: {
        subject: 'Hello {{newsletter_greeting_name}}',
        html: '<p>{{newsletter_greeting_name}}</p>',
        text: '{{newsletter_greeting_name}}',
        preheader: '{{newsletter_greeting_name}}',
      },
      greetingName: '<Luke & Co>',
      senderName: 'ValorWell',
      unsubscribeUrl: 'https://example.org/unsubscribe',
      postalAddress: 'Kansas City, MO',
    });

    expect(rendered.subject).toBe('Hello <Luke & Co>');
    expect(rendered.html).toContain('&lt;Luke &amp; Co&gt;');
    expect(rendered.text).toContain('<Luke & Co>');
    expect(rendered.preheader).toBe('<Luke & Co>');
    expect(rendered.html).toContain('&lt;Luke &amp; Co&gt;');
  });

  it('preserves all supported legacy newsletter aliases', () => {
    const rendered = renderNewsletterDelivery({
      template: {
        subject: '{{greeting_name}} / {{recipient_name}} / {{first_name}} / {{preferred_name}}',
        html: '<p>{{unsubscribe_link}}</p><p>{{valorwell_postal_address}}</p>',
        text: '{{unsubscribe_link}}\n{{valorwell_postal_address}}',
        preheader: '{{first_name}}',
      },
      greetingName: 'Alex',
      senderName: 'ValorWell',
      unsubscribeUrl: 'https://example.org/u/1',
      postalAddress: 'Lee\'s Summit, Missouri',
    });

    expect(rendered.subject).toBe('Alex / Alex / Alex / Alex');
    expect(rendered.preheader).toBe('Alex');
    expect(rendered.html).toContain('https://example.org/u/1');
    expect(rendered.text).toContain("Lee's Summit, Missouri");
  });

  it('uses Friend when a mailbox has no usable greeting name', () => {
    const rendered = renderNewsletterDelivery({
      template: {
        subject: 'Hello {{newsletter_greeting_name}}',
        html: '<p>Hello {{newsletter_greeting_name}}</p>',
        text: 'Hello {{newsletter_greeting_name}}',
        preheader: null,
      },
      greetingName: '   ',
      senderName: null,
      unsubscribeUrl: 'https://example.org/unsubscribe',
      postalAddress: 'Kansas City, MO',
    });

    expect(rendered.subject).toBe('Hello Friend');
    expect(rendered.preheader).toBeNull();
    expect(rendered.html).not.toContain('display:none');
  });

  it('fails closed on unknown newsletter variables', () => {
    expect(() => validateNewsletterTemplateContract({
      subject: 'Hello {{made_up_variable}}',
      html: '<p>Body</p>',
      text: 'Body',
      preheader: null,
    })).toThrow('UNKNOWN_NEWSLETTER_VARIABLE:made_up_variable');
  });

  it('fails closed on known variables that are disallowed for marketing newsletters', () => {
    expect(() => validateNewsletterTemplateContract({
      subject: 'Hello',
      html: '<p>Your therapist is {{therapist_name}}</p>',
      text: 'Your therapist is {{therapist_name}}',
      preheader: null,
    })).toThrow('DISALLOWED_NEWSLETTER_VARIABLE:therapist_name');
  });

  it('validates subject, preheader, HTML, and text before CRM scheduling', () => {
    expect(() => assertNewsletterTemplatesSchedulable({
      subject: 'Hello {{newsletter_greeting_name}}',
      preheader: 'From {{sender_name}}',
      bodyHtml: '<p>{{unsubscribe_url}}</p>',
      bodyText: '{{postal_address}}',
    })).not.toThrow();

    // Legacy worker alias is intentionally accepted by the browser contract too.
    expect(() => assertNewsletterTemplatesSchedulable({
      subject: 'Hello {{greeting_name}}',
      preheader: null,
      bodyHtml: '<p>Body</p>',
      bodyText: 'Body',
    })).not.toThrow();

    expect(() => assertNewsletterTemplatesSchedulable({
      subject: 'Hello',
      preheader: '{{therapist_name}}',
      bodyHtml: '<p>Body</p>',
      bodyText: 'Body',
    })).toThrow('Newsletter contains invalid personalization variables');
  });

  it('wires preheader and strict validation into the production worker before claims', () => {
    const worker = read('supabase/functions/newsletter-send-worker/index.ts');
    expect(worker).toContain('.select("id, tenant_id, subject, preheader, body_html, body_text, status")');
    expect(worker).toContain('validateNewsletterTemplateContract(template)');
    expect(worker).toContain('renderNewsletterDelivery({');
    expect(worker).toContain('subject: body.subject');
    expect(worker).not.toContain('.replace(/\\{\\{\\s*greeting_name');
  });
});
