import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261022010200_valorwell_daily_ambiguity_metrics.sql', 'utf8');
const monitor = readFileSync('supabase/functions/valorwell-daily-exception-watch/index.ts', 'utf8');

describe('internal ambiguity monitoring boundaries', () => {
  it('restricts aggregate-only function to service role', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("i.tenant_id='00000000-0000-0000-0000-000000000001'::uuid");
    expect(sql).toContain("i.issue_type='ambiguous_email_thread'");
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/);
    expect(sql).not.toContain('sender_email');
    expect(sql).not.toContain('rendered_body');
  });
  it('compares latest issue against previous snapshot rather than repeatedly alerting backlog', () => {
    expect(monitor).toContain('valorwell_daily_watch_ambiguity_snapshot_v1');
    expect(monitor).toContain('latest_created_epoch');
    expect(monitor).toContain('latestAmbiguity > previousAmbiguity');
    expect(monitor).toContain('ambiguityNew24h > 0');
    expect(monitor).toContain('new_ambiguous_email_review');
  });
});
