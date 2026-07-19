import type { Capability, CapabilityAvailability } from './contracts';

export const relationshipCapabilities = (available: Partial<Record<Capability, boolean>> = {}): CapabilityAvailability[] =>
  (['organizations', 'contacts', 'referrals', 'opportunities', 'interactions', 'imports', 'campaigns', 'enrollment', 'suppression', 'unsubscribe', 'replies', 'reporting'] as Capability[])
    .map(capability => ({ capability, available: available[capability] === true, reason: available[capability] ? 'Database capability is available.' : 'Database support pending; no relationship data is read or written.' }));
