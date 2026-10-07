import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANONICAL_MESSAGE_CLASSES } from '@/domain/operations';
import {
  MESSAGE_CLASSES,
  isMessageClass,
  parseIndividualSmsMessageClass,
} from '../../supabase/functions/_shared/communication-contracts';
import {
  clientGreetingVariables,
  resolveClientSalutation,
} from '../../supabase/functions/_shared/client-personalization';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Phase 1 communication contracts', () => {
  it('keeps frontend and Edge message-class vocabularies identical', () => {
    expect([...MESSAGE_CLASSES]).toEqual([...CANONICAL_MESSAGE_CLASSES]);
  });

  it('validates the canonical message-class allow-list at runtime', () => {
    for (const messageClass of MESSAGE_CLASSES) {
      expect(isMessageClass(messageClass)).toBe(true);
    }

    expect(isMessageClass('critical_operational')).toBe(false);
    expect(isMessageClass('')).toBe(false);
    expect(isMessageClass(null)).toBe(false);
    expect(isMessageClass(42)).toBe(false);
  });

  it('defaults an omitted individual SMS class but rejects explicit invalid values', () => {
    expect(parseIndividualSmsMessageClass(undefined)).toBe('necessary_scheduling');
    expect(parseIndividualSmsMessageClass('ordinary_promotional')).toBe('ordinary_promotional');
    expect(parseIndividualSmsMessageClass('ordinary_campaign_follow_up')).toBe('ordinary_campaign_follow_up');

    expect(parseIndividualSmsMessageClass(null)).toBeNull();
    expect(parseIndividualSmsMessageClass('critical_operational')).toBeNull();
    expect(parseIndividualSmsMessageClass('')).toBeNull();
  });

  it('uses preferred name, then legal first name, then a neutral fallback', () => {
    expect(resolveClientSalutation({
      pat_name_preferred: ' Jon ',
      pat_name_f: 'Jonathan',
    })).toBe('Jon');

    expect(resolveClientSalutation({
      pat_name_preferred: '   ',
      pat_name_f: ' Jonathan ',
    })).toBe('Jonathan');

    expect(resolveClientSalutation({
      pat_name_preferred: null,
      pat_name_f: null,
    })).toBe('there');

    expect(clientGreetingVariables({
      pat_name_preferred: 'Jon',
      pat_name_f: 'Jonathan',
    })).toEqual({
      first_name: 'Jon',
      preferred_name: 'Jon',
    });
  });

  it('forwards the selected SMS class from the canonical repository', () => {
    const source = read('src/repositories/supabase/communications.ts');
    expect(source).toContain("messageClass: message.messageClass ?? 'necessary_scheduling'");
    expect(source).not.toContain("messageClass: 'necessary_scheduling'");
  });

  it('validates individual SMS classes at both Edge boundaries', () => {
    const crmSms = read('supabase/functions/crm-send-client-sms/index.ts');
    const ringCentral = read('supabase/functions/ringcentral-sms/index.ts');

    for (const source of [crmSms, ringCentral]) {
      expect(source).toContain('parseIndividualSmsMessageClass');
      expect(source).toContain('return json({ error: "Invalid messageClass" }, 400)');
    }

    expect(ringCentral).not.toContain('body.messageClass as MessageClass');
  });

  it('wires both client email delivery paths to the shared salutation resolver', () => {
    const campaignScheduler = read('supabase/functions/campaign-scheduler/index.ts');
    const directEmail = read('supabase/functions/crm-resend-email/index.ts');

    expect(campaignScheduler).toContain('...clientGreetingVariables(typedClient)');
    expect(directEmail).toContain('...clientGreetingVariables(client)');

    expect(campaignScheduler).not.toContain('first_name: typedClient.pat_name_f || "Client"');
    expect(directEmail).not.toContain('first_name: client.pat_name_f || "Client"');
  });
});
