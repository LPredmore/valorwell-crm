import { supabase } from '@/integrations/supabase/client';

/** Default OFF. Only an explicit build-time "true" enables the UI. The server
 * allowlist remains the only authority; this flag never grants access. */
export function ownerPrivateNotesEnabled(env: Record<string, unknown> = import.meta.env): boolean {
  return env.VITE_CRM_OWNER_PRIVATE_NOTES === 'true';
}

export type OwnerPrivateNote = { id: string; body: string; version: number; updatedAt: string };

// Untyped: the staged RPCs are not in generated types until released.
const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);

/** Returns null for no note AND for any denial/error, so callers cannot
 * distinguish existence from lack of permission. */
export async function getOwnerPrivateNote(tenantId: string, submissionId: string): Promise<OwnerPrivateNote | null> {
  const { data, error } = await rpc('crm_owner_note_get', { p_tenant: tenantId, p_submission: submissionId });
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.body !== 'string' || typeof row.version !== 'number') return null;
  return { id: row.id, body: row.body, version: row.version, updatedAt: String(row.updated_at ?? '') };
}

export async function saveOwnerPrivateNote(tenantId: string, submissionId: string, body: string, expectedVersion: number | null) {
  const { error } = await rpc('crm_owner_note_upsert', { p_tenant: tenantId, p_submission: submissionId, p_body: body, p_expected_version: expectedVersion });
  if (error) throw new Error('The note could not be saved.');
}

export async function deleteOwnerPrivateNote(tenantId: string, submissionId: string, expectedVersion: number) {
  const { error } = await rpc('crm_owner_note_delete', { p_tenant: tenantId, p_submission: submissionId, p_expected_version: expectedVersion });
  if (error) throw new Error('The note could not be deleted.');
}

/** Per-user, per-tenant key; never persisted. */
export const ownerNoteQueryKey = (userId: string, tenantId: string, submissionId: string) =>
  ['owner-private-note', userId, tenantId, submissionId] as const;
