import { capabilityState, relationshipCapabilityKeys } from '@/domain/relationships/capabilities';
import type { Capability, CapabilityAvailability, CapabilityStatus } from '@/domain/relationships/contracts';
import { RelationshipCapabilityUnavailableError, type RelationshipsRepository } from '@/repositories/relationships';

export interface RelationshipCapabilityProbe {
  capabilities(): Promise<CapabilityAvailability[]>;
}

function failureStatus(error: unknown): CapabilityStatus {
  if (error instanceof RelationshipCapabilityUnavailableError) return 'pending';
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('permission') || message.includes('not authorized')) return 'permission_denied';
    if (message.includes('network') || message.includes('fetch') || message.includes('offline')) return 'network_error';
    if (message.includes('invalid') || message.includes('malformed')) return 'invalid_response';
  }
  return 'query_error';
}

function normalizeCapabilities(records: CapabilityAvailability[]): CapabilityAvailability[] {
  const byCapability = new Map<Capability, CapabilityAvailability>();
  for (const record of records) {
    if (byCapability.has(record.capability)) {
      return relationshipCapabilityKeys.map(capability => capabilityState(capability, 'invalid_response', 'Duplicate capability record.'));
    }
    byCapability.set(record.capability, record);
  }
  return relationshipCapabilityKeys.map(capability => byCapability.get(capability) ?? capabilityState(capability, 'missing_contract'));
}

/**
 * Caches one typed capability snapshot. Relationship pages use this adapter
 * instead of independently probing tables or functions that may not exist.
 */
export class CachedRelationshipCapabilityAdapter {
  private snapshot?: CapabilityAvailability[];
  private inFlight?: Promise<CapabilityAvailability[]>;

  constructor(private readonly probe: RelationshipCapabilityProbe) {}

  async all(): Promise<CapabilityAvailability[]> {
    if (this.snapshot) return this.snapshot;
    if (!this.inFlight) {
      this.inFlight = this.probe.capabilities()
        .then(normalizeCapabilities)
        .catch(error => {
          const status = failureStatus(error);
          const diagnostic = error instanceof Error ? error.message : undefined;
          return relationshipCapabilityKeys.map(capability => capabilityState(capability, status, diagnostic));
        })
        .then(result => {
          this.snapshot = result;
          return result;
        })
        .finally(() => { this.inFlight = undefined; });
    }
    return this.inFlight;
  }

  async get(capability: Capability): Promise<CapabilityAvailability> {
    const states = await this.all();
    return states.find(state => state.capability === capability) ?? capabilityState(capability, 'missing_contract');
  }

  invalidate() { this.snapshot = undefined; }
}

export function createRelationshipCapabilityAdapter(repository: Pick<RelationshipsRepository, 'capabilities'>) {
  return new CachedRelationshipCapabilityAdapter(repository);
}
