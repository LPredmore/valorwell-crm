import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('launch safety contracts', () => {
  const owner = readFileSync('supabase/migrations/20261021220125_reply_ownership.sql', 'utf8');
  const billing = readFileSync('supabase/migrations/20261021220126_billing_role_self_only.sql', 'utf8');
  const gmail = readFileSync('supabase/functions/_shared/relationship-google-sync.ts', 'utf8');
  it('inherits reply owners only from tenant-matched opportunities', () => {
    expect(owner).toContain('tenant_id=NEW.tenant_id');
    expect(owner).toContain('NEW.organization_id=v_org');
    expect(owner).toContain('owner_review_required');
    expect(owner).toContain('BEFORE INSERT');
    expect(owner).not.toContain('follow_up_due_at :=');
  });
  it('requires signed-in caller to be the Billing role subject', () => {
    expect(billing).toContain('auth.uid()=_user_id');
    expect(billing).toContain('s.tenant_id=_tenant_id');
  });
  it('uses full Gmail content for related ambiguous mail', () => {
    expect(gmail).toContain('decision.ambiguous === true');
    expect(gmail).toContain('decision.likelyRelationship === true');
    expect(gmail).toContain('if (!shouldFetchFull)');
    expect(gmail).toContain('p_body: gmailBody(fullPayload)');
  });
});
