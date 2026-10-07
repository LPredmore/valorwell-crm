import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as controlPlane from '@/lib/crm/communications-control-plane';
import * as newsletters from '@/lib/crm/newsletter-control-plane';

const worker = readFileSync('supabase/functions/newsletter-send-worker/index.ts', 'utf8');

describe('newsletter lifecycle consolidation', () => {
  it('control plane shares the single newsletter client implementation', () => {
    expect(controlPlane.scheduleNewsletter).toBe(newsletters.scheduleNewsletter);
    expect(controlPlane.cancelNewsletterSend).toBe(newsletters.cancelNewsletterSend);
    expect(controlPlane.listNewsletters).toBe(newsletters.listNewsletters);
    expect(controlPlane.getNewsletterDeliveryTrace).toBe(newsletters.getNewsletterDeliveryTrace);
    expect(controlPlane.NEWSLETTER_AUDIENCE_DOMAINS).toBe(newsletters.NEWSLETTER_AUDIENCE_DOMAINS);
  });

  it('rejects invalid variables before scheduling from any page', () => {
    expect(() =>
      newsletters.assertNewsletterTemplatesSchedulable({
        subject: 'Hi {{last_name}}', preheader: null, bodyHtml: '<p>x</p>', bodyText: 'x',
      }),
    ).toThrow(/invalid personalization/i);
  });

  it('worker uses one claim path for cron and wake-up runs', () => {
    expect(worker).toContain('p_newsletter_id: input.newsletterId ? String(input.newsletterId) : null');
    expect(worker).not.toMatch(/due = \[\{ newsletterId: String\(input\.newsletterId\)/);
  });

  it('worker reconciles stranded sending newsletters every run', () => {
    expect(worker).toContain('crm_reconcile_sending_newsletters');
  });

  it('worker fails a newsletter on permanent template errors instead of leaving it sending', () => {
    const block = worker.slice(worker.indexOf('validateNewsletterTemplateContract(template)'));
    expect(block.indexOf('crm_fail_newsletter')).toBeGreaterThan(-1);
    expect(block.indexOf('crm_fail_newsletter')).toBeLessThan(block.indexOf('continue;'));
  });

  it('worker calls the send guard immediately before every Resend delivery', () => {
    const guard = worker.indexOf('crm_newsletter_recipient_send_guard');
    const send = worker.indexOf('await sendOne(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(send);
  });
});
