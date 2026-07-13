import type { CrmDataProvider } from '../types';
import { mockDataProvider } from '../mock';
import { supabaseClientsRepository } from './clients';

/**
 * Hybrid provider: canonical client reads/writes go to Supabase
 * (v_client_canonical_state + RPCs); tasks/exceptions/campaigns/
 * communications/staff/audit/reports continue on the mock provider
 * until their backing tables and RPCs land in later workstreams.
 */
export const supabaseDataProvider: CrmDataProvider = {
  ...mockDataProvider,
  clients: supabaseClientsRepository,
};
