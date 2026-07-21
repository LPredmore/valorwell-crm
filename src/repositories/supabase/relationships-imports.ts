import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type {
  CapabilityAvailability,
  CapabilityStatus,
} from '@/domain/relationships/contracts';
import type { RelationshipImportPreviewResult } from '@/domain/relationships/import-contracts';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as baseRelationshipsRepository } from './relationships-opportunities';
import {
  mapRelationshipImportPreview,
  parseRelationshipImportCsv,
  relationshipImportResolutions,
} from './relationships-import-mappers';

type OperatingContext = {
  tenantId: string;
  canMutate: boolean;
};

type RelationshipImportBatchRow = {
  id: string;
  tenant_id: string;
  status: string;
};

type RelationshipImportDatabase = {
  public: {
    Tables: {
      relationship_imports: {
        Row: RelationshipImportBatchRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_relationship_import_preview: {
        Args: { p_import_id: string };
        Returns: Json;
      };
      create_relationship_import_preview: {
        Args: {
          p_filename: string;
          p_source_type: string;
          p_mapping: Json;
          p_headers: string[];
          p_rows: Json;
        };
        Returns: Json;
      };
      resolve_relationship_import_conflicts: {
        Args: {
          p_import_id: string;
          p_resolutions: Json;
          p_expected_version?: number | null;
        };
        Returns: Json;
      };
      commit_relationship_import: {
        Args: {
          p_import_id: string;
          p_expected_version: number;
          p_idempotency_key: string;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const importSupabase = supabase as unknown as SupabaseClient<RelationshipImportDatabase>;

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function capabilityStatusFromError(error: unknown): CapabilityStatus {
  const message = errorMessage(error).toLowerCase();
  if (
    message.includes('permission')
    || message.includes('not authorized')
    || message.includes('row-level security')
    || message.includes('operating tenant')
    || message.includes('authenticated')
    || message.includes('42501')
  ) return 'permission_denied';
  if (message.includes('fetch') || message.includes('network') || message.includes('offline')) {
    return 'network_error';
  }
  if (message.includes('invalid') || message.includes('malformed')) return 'invalid_response';
  return 'query_error';
}

async function operatingContext(): Promise<OperatingContext> {
  const { data, error } = await supabase.rpc('get_crm_operating_context');
  if (error) throw new Error(error.message);
  if (!isJsonObject(data)) throw new Error('Invalid CRM operating context response.');
  if (data.authenticated !== true) throw new Error('Authenticated CRM access is required.');

  const tenantId = data.current_tenant_id;
  const capabilities = data.capabilities;
  if (typeof tenantId !== 'string' || !tenantId) {
    throw new Error('No operating tenant is selected for this CRM session.');
  }

  return {
    tenantId,
    canMutate: isJsonObject(capabilities) && capabilities.mutate === true,
  };
}

function requireMutation(context: OperatingContext) {
  if (!context.canMutate) {
    throw new Error('You do not have permission to manage relationship imports.');
  }
}

function replaceCapability(
  capabilities: CapabilityAvailability[],
  replacement: CapabilityAvailability,
) {
  const index = capabilities.findIndex((item) => item.capability === replacement.capability);
  if (index >= 0) capabilities[index] = replacement;
  return capabilities;
}

async function importCapabilities(): Promise<CapabilityAvailability[]> {
  const capabilities = await baseRelationshipsRepository.capabilities();
  try {
    const context = await operatingContext();
    const { error } = await importSupabase
      .from('relationship_imports')
      .select('id')
      .eq('tenant_id', context.tenantId)
      .limit(1);
    return replaceCapability(
      capabilities,
      error
        ? capabilityState('imports', capabilityStatusFromError(error), error.message)
        : capabilityState('imports', 'available'),
    );
  } catch (error) {
    return replaceCapability(
      capabilities,
      capabilityState('imports', capabilityStatusFromError(error), errorMessage(error)),
    );
  }
}

async function getImportPreview(previewId: string): Promise<RelationshipImportPreviewResult> {
  await operatingContext();
  const { data, error } = await importSupabase.rpc('get_relationship_import_preview', {
    p_import_id: previewId,
  });
  if (error) throw new Error(error.message);
  return mapRelationshipImportPreview(data);
}

async function previewImport(
  input: Parameters<RelationshipsRepository['previewImport']>[0],
): Promise<RelationshipImportPreviewResult> {
  const context = await operatingContext();
  requireMutation(context);
  const parsed = parseRelationshipImportCsv(input.csv, input.mapping);
  const { data, error } = await importSupabase.rpc('create_relationship_import_preview', {
    p_filename: input.filename?.trim() || 'relationship-import.csv',
    p_source_type: input.sourceType?.trim() || 'csv',
    p_mapping: input.mapping as unknown as Json,
    p_headers: parsed.headers,
    p_rows: parsed.rows as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return mapRelationshipImportPreview(data);
}

async function resolveImportConflicts(
  input: Parameters<RelationshipsRepository['resolveImportConflicts']>[0],
): Promise<RelationshipImportPreviewResult> {
  const context = await operatingContext();
  requireMutation(context);
  const expectedVersion = input.expectedVersion
    ?? (await getImportPreview(input.previewId)).version;
  const { data, error } = await importSupabase.rpc('resolve_relationship_import_conflicts', {
    p_import_id: input.previewId,
    p_resolutions: relationshipImportResolutions(input.conflicts),
    p_expected_version: expectedVersion,
  });
  if (error) throw new Error(error.message);
  return mapRelationshipImportPreview(data);
}

async function commitImport(
  input: Parameters<RelationshipsRepository['commitImport']>[0],
): Promise<{ importId: string }> {
  const context = await operatingContext();
  requireMutation(context);
  const expectedVersion = input.expectedVersion
    ?? (await getImportPreview(input.previewId)).version;
  const { data, error } = await importSupabase.rpc('commit_relationship_import', {
    p_import_id: input.previewId,
    p_expected_version: expectedVersion,
    p_idempotency_key: input.idempotencyKey?.trim() || `relationship-import:${input.previewId}`,
  });
  if (error) throw new Error(error.message);
  const result = mapRelationshipImportPreview(data);
  return { importId: result.previewId };
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...baseRelationshipsRepository,
  capabilities: importCapabilities,
  getImportPreview,
  previewImport,
  resolveImportConflicts,
  commitImport,
};
