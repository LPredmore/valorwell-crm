import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  verifyResendConnectionSettings,
} from '../../supabase/functions/crm-resend-email/connection-verification';
import {
  classifyNewsletterSendFailure,
  newsletterIdempotencyKey,
} from '../../supabase/functions/newsletter-send-worker/delivery-contract';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 9 newsletter production readiness', () => {
  it('accepts a Resend-managed inbound address while verifying both transactional and marketing send domains', () => {
    expect(verifyResendConnectionSettings({
      fromEmail: ' Info@ValorWell.org ',
      marketingFromEmail: ' Updates@Updates.ValorWell.org ',
      inboundEmail: 'crm@onteireli.resend.app',
      domains: [
        { name: 'valorwell.org', status: 'verified' },
        { name: 'updates.valorwell.org', status: 'verified' },
      ],
    })).toEqual({
      fromEmail: 'info@valorwell.org',
      marketingFromEmail: 'updates@updates.valorwell.org',
      inboundEmail: 'crm@onteireli.resend.app',
      verifiedDomains: ['valorwell.org', 'updates.valorwell.org'],
      inboundMode: 'resend_managed',
    });
  });

  it('fails closed when a configured marketing sender is not verified', () => {
    expect(() => verifyResendConnectionSettings({
      fromEmail: 'info@valorwell.org',
      marketingFromEmail: 'updates@unverified.example',
      inboundEmail: 'crm@onteireli.resend.app',
      domains: [{ name: 'valorwell.org', status: 'verified' }],
    })).toThrow('The unverified.example domain was not found in Resend');
  });

  it('requires custom inbound domains to be verified but does not misclassify provider-managed inbound', () => {
    expect(() => verifyResendConnectionSettings({
      fromEmail: 'info@valorwell.org',
      marketingFromEmail: null,
      inboundEmail: 'crm@reply.valorwell.org',
      domains: [{ name: 'valorwell.org', status: 'verified' }],
    })).toThrow('The reply.valorwell.org domain was not found in Resend');
  });

  it('uses one stable provider idempotency key for every retry of the same ledger message', () => {
    expect(newsletterIdempotencyKey(' message-123 ')).toBe('crm-newsletter/message-123');
    expect(newsletterIdempotencyKey('message-123')).toBe('crm-newsletter/message-123');
    expect(() => newsletterIdempotencyKey('   ')).toThrow('Newsletter email message ID is required');
  });

  it('retries only transient transport/provider failures and preserves permanent failures', () => {
    expect(classifyNewsletterSendFailure({
      networkError: true,
      errorMessage: 'socket reset',
    })).toMatchObject({
      outcome: 'retry',
      errorCode: 'network_error',
      retryAfterSeconds: 300,
    });

    expect(classifyNewsletterSendFailure({
      status: 429,
      errorCode: 'rate_limit_exceeded',
      errorMessage: 'slow down',
      retryAfterHeader: '120',
    })).toMatchObject({
      outcome: 'retry',
      retryAfterSeconds: 120,
    });

    expect(classifyNewsletterSendFailure({
      status: 503,
      errorMessage: 'provider unavailable',
    })).toMatchObject({
      outcome: 'retry',
      retryAfterSeconds: 300,
    });

    expect(classifyNewsletterSendFailure({
      status: 422,
      errorCode: 'validation_error',
      errorMessage: 'bad recipient',
    })).toEqual({
      outcome: 'failed',
      errorCode: 'validation_error',
      errorMessage: 'bad recipient',
    });
  });

  it('wires the production worker to claim-owned send recording and stable provider idempotency', () => {
    const worker = read('supabase/functions/newsletter-send-worker/index.ts');

    expect(worker).toContain('crm_record_newsletter_send_attempt');
    expect(worker).not.toContain('crm_record_newsletter_send_result');
    expect(worker).toContain('p_claim_token: batch.claimToken');
    expect(worker).toContain('newsletterIdempotencyKey(recipient.emailMessageId)');
    expect(worker).not.toContain('recipient.emailMessageId}/${recipient.attempt}');
    expect(worker).toContain('p_outcome: outcome.outcome');
    expect(worker).toContain('retryAfterSeconds');
    expect(worker).toContain('function displayFrom');
    expect(worker).toContain('function unsubscribeUrl');
  });

  it('keeps browser and internal operations verification on the same Resend verification core', () => {
    const resend = read('supabase/functions/crm-resend-email/index.ts');

    expect(resend).toContain('verifyResendConnectionSettings');
    expect(resend).toContain('marketing_from_email');
    expect(resend).toContain('verify-connection-internal');
    expect(resend).toContain('isCronAuthorized(request)');
    expect(resend).toContain('return verifyConnectionForTenant(auth.db, auth.tenantId, requestId)');
    expect(resend).toContain('verifyConnectionForTenant(serviceDb(), tenantId, requestId)');
  });

  it('keeps tenant-level control-plane activity auditable without requiring a client id', () => {
    const migration = read('supabase/migrations/20261007161927_crm_activity_events_tenant_scope.sql');

    expect(migration).toContain('alter column client_id drop not null');
    expect(migration).toContain('drop constraint if exists crm_activity_events_event_type_check');
    expect(migration).toContain("check (nullif(btrim(event_type), '') is not null)");
  });

  it('keeps the public newsletter unsubscribe page marketing-only and idempotent', () => {
    const page = read('src/pages/NewsletterUnsubscribePage.tsx');

    expect(page).toContain("supabase.rpc('crm_process_newsletter_unsubscribe'");
    expect(page).toContain('It does not change healthcare, appointment, billing, or');
    expect(page).toContain("outcome === 'already_unsubscribed'");
  });
});
