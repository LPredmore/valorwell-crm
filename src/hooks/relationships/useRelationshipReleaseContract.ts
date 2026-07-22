import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import {
  RELATIONSHIP_DOMAIN_KEY,
  type RelationshipActivationStatus,
  type RelationshipArchitectureContract,
  type RelationshipReleaseStatus,
} from '@/lib/crm/relationship-architecture';

type ReleaseContractRow = {
  domain_key: string;
  canonical_database: string;
  canonical_application: string;
  inbound_lane: string;
  outbound_lane: string;
  clinical_campaign_lane: string;
  clinical_campaign_boundary_enforced: boolean;
  implementation_status: string;
  terminology: Json;
  contract_version: number;
  schema_fingerprint: string | null;
  generated_type_hash: string | null;
  capability_manifest: Json;
  object_inventory: Json;
  rpc_signatures: Json;
  grant_manifest: Json;
  release_status: string;
  activation_status: string;
  activation_blockers: Json;
  acceptance_evidence: Json;
  accepted_at: string | null;
  effective_at: string | null;
  updated_at: string | null;
};

type QueryError = { message: string };
type ReleaseContractResult = Promise<{ data: ReleaseContractRow | null; error: QueryError | null }>;
type ReleaseContractQueryClient = {
  from: (relation: 'crm_domain_contracts') => {
    select: (columns: '*') => {
      eq: (column: 'domain_key', value: string) => {
        maybeSingle: () => ReleaseContractResult;
      };
    };
  };
};

const releaseContractSupabase = supabase as unknown as ReleaseContractQueryClient;

function record(value: Json): Record<string, Json | undefined> {
  if (!value || Array.isArray(value) || typeof value !== 'object') return {};
  return value;
}

function stringRecord(value: Json): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function stringArray(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function releaseStatus(value: string): RelationshipReleaseStatus {
  return ['not_evaluated', 'release_candidate', 'accepted', 'rejected'].includes(value)
    ? value as RelationshipReleaseStatus
    : 'not_evaluated';
}

function activationStatus(value: string): RelationshipActivationStatus {
  return ['locked', 'pilot_ready', 'active', 'suspended'].includes(value)
    ? value as RelationshipActivationStatus
    : 'locked';
}

function mapReleaseContract(row: ReleaseContractRow): RelationshipArchitectureContract {
  return {
    ...row,
    terminology: stringRecord(row.terminology),
    capability_manifest: stringRecord(row.capability_manifest),
    rpc_signatures: Array.isArray(row.rpc_signatures) ? row.rpc_signatures : [],
    activation_blockers: stringArray(row.activation_blockers),
    acceptance_evidence: record(row.acceptance_evidence),
    release_status: releaseStatus(row.release_status),
    activation_status: activationStatus(row.activation_status),
  };
}

async function loadRelationshipReleaseContract() {
  const { data, error } = await releaseContractSupabase
    .from('crm_domain_contracts')
    .select('*')
    .eq('domain_key', RELATIONSHIP_DOMAIN_KEY)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('The relationship release contract is not installed.');
  return mapReleaseContract(data);
}

export function useRelationshipReleaseContract() {
  return useQuery({
    queryKey: ['relationship-release-contract', RELATIONSHIP_DOMAIN_KEY],
    queryFn: loadRelationshipReleaseContract,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
