import type { CrmDataProvider } from '../types';
import { supabaseClientsRepository } from './clients';
import { supabaseTasksRepository } from './tasks';
import { supabaseExceptionsRepository } from './exceptions';
import { supabaseStaffRepository } from './staff';
import { supabaseAuditRepository } from './audit';
import { supabaseCampaignsRepository } from './campaigns';
import { supabaseCommunicationsRepository } from './communications';
import { supabaseReportsRepository } from './reports';
import { supabaseRelationshipsRepository } from './relationships-opportunities';

/**
 * Full Supabase provider. Every domain repository is backed by Supabase
 * tables, RPCs, or edge functions — no mock fallbacks.
 */
export const supabaseDataProvider: CrmDataProvider = {
  clients: supabaseClientsRepository,
  tasks: supabaseTasksRepository,
  exceptions: supabaseExceptionsRepository,
  staff: supabaseStaffRepository,
  audit: supabaseAuditRepository,
  campaigns: supabaseCampaignsRepository,
  communications: supabaseCommunicationsRepository,
  reports: supabaseReportsRepository,
  relationships: supabaseRelationshipsRepository,
};
