import type { SupabaseClient } from '@supabase/supabase-js';
import { capabilityState } from '@/domain/relationships/capabilities';
import type {
  CapabilityAvailability,
  CapabilityStatus,
  RelationshipReportMetric,
  RelationshipSearchResult,
} from '@/domain/relationships/contracts';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { RelationshipsRepository } from '@/repositories/relationships';
import { supabaseRelationshipsRepository as deliveryRelationshipsRepository } from './relationships-delivery';

type JsonObject = { [key: string]: Json | undefined };
type ReportingDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      search_relationships: {
        Args: {
          p_query: string;
          p_kinds?: string[] | null;
          p_page?: number;
          p_page_size?: number;
        };
        Returns: Json;
      };
      get_relationship_report_metrics: {
        Args: { p_period?: Json };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const reportingSupabase = supabase as unknown as SupabaseClient<ReportingDatabase>;

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: Json | undefined) {
  return typeof value === 'string' && value ? value : undefined;
}

function requiredText(value: Json | undefined, label: string) {
  const result = text(value);
  if (!result) throw new Error(`Invalid relationship ${label}.`);
  return result;
}

function number(value: Json | undefined, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function capabilityStatus(error: unknown): CapabilityStatus {
  const message = errorMessage(error).toLowerCase();
  if (message.includes('permission') || message.includes('authorized') || message.includes('42501')) return 'permission_denied';
  if (message.includes('fetch') || message.includes('network')) return 'network_error';
  if (message.includes('invalid')) return 'invalid_response';
  return 'query_error';
}

function replaceCapability(items: CapabilityAvailability[], replacement: CapabilityAvailability) {
  const index = items.findIndex((item) => item.capability === replacement.capability);
  if (index >= 0) items[index] = replacement;
}

function mapMetric(value: Json): RelationshipReportMetric {
  if (!isObject(value)) throw new Error('Invalid relationship report metric response.');
  const rawValue = value.value;
  return {
    key: requiredText(value.key, 'report metric key'),
    label: requiredText(value.label, 'report metric label'),
    value: typeof rawValue === 'number' || typeof rawValue === 'string' ? number(rawValue) : undefined,
    unavailableReason: text(value.unavailableReason),
    periodStart: text(value.periodStart),
    periodEnd: text(value.periodEnd),
  };
}

function mapSearchResult(value: Json): RelationshipSearchResult {
  if (!isObject(value)) throw new Error('Invalid relationship search result.');
  const kind = requiredText(value.kind, 'search result kind');
  if (!['organization', 'contact', 'opportunity', 'campaign'].includes(kind)) {
    throw new Error('Invalid relationship search result kind.');
  }
  return {
    id: requiredText(value.id, 'search result id'),
    kind: kind as RelationshipSearchResult['kind'],
    label: requiredText(value.label, 'search result label'),
    detail: text(value.detail),
    route: requiredText(value.route, 'search result route'),
  };
}

async function capabilities() {
  const states = await deliveryRelationshipsRepository.capabilities();
  const [reporting, search] = await Promise.allSettled([
    reportingSupabase.rpc('get_relationship_report_metrics', { p_period: {} }),
    reportingSupabase.rpc('search_relationships', { p_query: '', p_kinds: null, p_page: 1, p_page_size: 1 }),
  ]);

  if (reporting.status === 'fulfilled' && !reporting.value.error) {
    replaceCapability(states, capabilityState('reporting', 'available'));
  } else {
    const error = reporting.status === 'rejected' ? reporting.reason : reporting.value.error;
    replaceCapability(states, capabilityState('reporting', capabilityStatus(error), errorMessage(error)));
  }

  if (search.status === 'fulfilled' && !search.value.error) {
    replaceCapability(states, capabilityState('search', 'available'));
  } else {
    const error = search.status === 'rejected' ? search.reason : search.value.error;
    replaceCapability(states, capabilityState('search', capabilityStatus(error), errorMessage(error)));
  }

  return states;
}

async function listReportMetrics(input: Parameters<RelationshipsRepository['listReportMetrics']>[0] = {}) {
  const { data, error } = await reportingSupabase.rpc('get_relationship_report_metrics', {
    p_period: (input.period ?? {}) as unknown as Json,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Invalid relationship report response.');
  return data.map(mapMetric);
}

async function search(input: Parameters<RelationshipsRepository['search']>[0]) {
  const query = input.query.trim();
  const { data, error } = await reportingSupabase.rpc('search_relationships', {
    p_query: query,
    p_kinds: input.kinds?.length ? input.kinds : null,
    p_page: input.page ?? 1,
    p_page_size: input.pageSize ?? 25,
  });
  if (error) throw new Error(error.message);
  if (!isObject(data) || !Array.isArray(data.items)) throw new Error('Invalid relationship search response.');
  return {
    items: data.items.map(mapSearchResult),
    total: number(data.total),
    page: number(data.page, 1),
    pageSize: number(data.pageSize, 25),
  };
}

export const supabaseRelationshipsRepository: RelationshipsRepository = {
  ...deliveryRelationshipsRepository,
  capabilities,
  listReportMetrics,
  search,
};
