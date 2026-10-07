import { supabase } from '@/integrations/supabase/client';

export type BtyDuplicateMember = {
  organizationId: string;
  name: string;
  website: string | null;
  headquartersState: string | null;
  roles: string[];
  createdAt: string;
};

export type BtyDuplicateGroup = {
  matchType: 'website_domain' | 'youtube_channel' | 'name_and_state' | 'exact_name' | string;
  matchKey: string;
  memberCount: number;
  survivorId: string;
  duplicateIds: string[] | null;
  members: BtyDuplicateMember[];
};

export type BtyAmbiguousDuplicate = {
  organizationId: string;
  name: string;
  similarTo: { organizationId: string; name: string };
  note: string;
};

export type BtyDuplicatePreview = {
  deterministic: BtyDuplicateGroup[];
  ambiguous: BtyAmbiguousDuplicate[];
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export function previewBtyDuplicates() {
  return rpc<BtyDuplicatePreview>('bty_preview_organization_duplicates');
}

export function mergeBtyDuplicates(group: BtyDuplicateGroup, reason: string) {
  return rpc<Record<string, unknown>>('bty_merge_organization_duplicates', {
    p_survivor_id: group.survivorId,
    p_duplicate_ids: group.duplicateIds ?? [],
    p_reason: reason,
  });
}
