import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

describe('relationship Google Drive OAuth reconnect contract', () => {
  it('accepts Drive in the frontend connection contract and exposes Connect/Reconnect Drive', () => {
    const client = source('src/lib/crm/relationship-orchestration.ts');
    const types = source('src/domain/relationships/orchestration-contracts.ts');
    const page = source('src/pages/crm/business-development/RelationshipOrchestrationPage.tsx');

    expect(client).toContain("'gmail' | 'calendar' | 'drive'");
    expect(types).toContain("'gmail' | 'calendar' | 'drive'");
    expect(page).toContain("connect.mutate('drive')");
    expect(page).toContain("'Reconnect Drive'");
    expect(page).toContain("'Connect Drive'");
  });

  it('requests writable Drive scope while preserving read-only Gmail and Calendar scopes', () => {
    const start = source('supabase/functions/relationship-google-oauth-start/index.ts');
    expect(start).toContain('https://www.googleapis.com/auth/drive');
    expect(start).not.toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(start).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(start).toContain('https://www.googleapis.com/auth/calendar.events.readonly');
    expect(start).toContain('input.connectionType !== "drive"');
    expect(start).toContain('include_granted_scopes: "false"');
    expect(start).toContain('prompt: "consent"');
  });

  it('stores Drive through the existing connection RPC and redirects every connection back to the CRM', () => {
    const callback = source('supabase/functions/relationship-google-oauth-callback/index.ts');
    expect(callback).toContain('connectionType === "drive"');
    expect(callback).toContain('https://www.googleapis.com/auth/drive');
    expect(callback).toContain('verifyDriveWriteAccess');
    expect(callback).toContain('requeueDriveScopeThumbnailJobs');
    expect(callback).toContain('newestByClip');
    expect(callback).toContain('thumbnail_generation_revision');
    expect(callback).toContain('["queued", "claimed", "running", "waiting"]');
    expect(callback).toContain('store_relationship_google_connection');
    expect(callback).toContain('new URL("/crm/business-development/orchestration", appUrl)');
    expect(callback).not.toContain('You can close this window');
  });

  it('keeps the exact info@valorwell.org account restriction for Drive', () => {
    const callback = source('supabase/functions/relationship-google-oauth-callback/index.ts');
    expect(callback).toContain('Drive connection must authenticate exactly info@valorwell.org.');
  });

  it('does not add Drive to Gmail/Calendar maintenance polling', () => {
    const maintenance = source('supabase/functions/relationship-google-maintenance/index.ts');
    const sync = source('supabase/functions/_shared/relationship-google-sync.ts');
    expect(maintenance).not.toMatch(/flags\.drive|driveSync|driveWatch/);
    expect(sync).not.toContain('connectionRuntime(admin, "drive"');
  });
});
