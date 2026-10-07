import type { StaffMember } from './operations';

export type StaffDisplayNameSource = {
  preferredDisplayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Canonical human-readable operator label.
 *
 * Staff-record IDs and profile IDs are intentionally separate identities.
 * This helper only resolves presentation text; operational ownership uses profiles.id.
 */
export function buildStaffOperatorDisplayName(source: StaffDisplayNameSource): string {
  const preferred = nonBlank(source.preferredDisplayName);
  if (preferred) return preferred;

  const fullName = [nonBlank(source.firstName), nonBlank(source.lastName)]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .trim();
  if (fullName) return fullName;

  return nonBlank(source.email) ?? 'Unknown staff member';
}

export function findStaffByProfileId(
  staff: readonly StaffMember[],
  profileId: string | null | undefined,
): StaffMember | undefined {
  if (!profileId) return undefined;
  return staff.find((member) => member.profileId === profileId);
}

export function resolveStaffOperatorLabel(
  staff: readonly StaffMember[],
  profileId: string | null | undefined,
): string {
  if (!profileId) return 'Unassigned';
  const member = findStaffByProfileId(staff, profileId);
  return member?.displayName?.trim() || member?.email?.trim() || 'Unknown staff member';
}
