import { describe, expect, it } from 'vitest';
import { gmailContractMissing, gmailSyncHealth } from '@/lib/crm/gmail-sync-health';

describe('Gmail verification age, not notification or watch age', () => {
  it('warns at exactly 60 minutes', () => {
    expect(gmailSyncHealth(59 * 60 + 59)).toBe('healthy');
    expect(gmailSyncHealth(60 * 60)).toBe('warning');
  });
  it('is critical at exactly 240 minutes', () => {
    expect(gmailSyncHealth(239 * 60 + 59)).toBe('warning');
    expect(gmailSyncHealth(240 * 60)).toBe('critical');
  });
  it('does not establish verification from unknown or invalid ages', () => {
    for (const value of [null, undefined, NaN, -1]) expect(gmailSyncHealth(value)).toBe('unknown');
  });
  it('recognizes missing schema contracts without treating Google 404 as deletion', () => {
    expect(gmailContractMissing({ code: 'PGRST202' })).toBe(true);
    expect(gmailContractMissing({ message: 'Could not find the function public.record_relationship_gmail_retrieval_failure(p_message_id, p_status) in the schema cache' })).toBe(true);
    expect(gmailContractMissing({ code: '404', message: 'Google API request failed (404)' })).toBe(false);
  });
});