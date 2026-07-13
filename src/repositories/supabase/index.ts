import type { CrmDataProvider } from '../types';
import { mockDataProvider } from '../mock';
import { supabaseClientsRepository } from './clients';
import { supabaseTasksRepository } from './tasks';
import { supabaseExceptionsRepository } from './exceptions';
import { supabaseStaffRepository } from './staff';
import { supabaseAuditRepository } from './audit';
import { supabaseCampaignsRepository } from './campaigns';
import { supabaseCommunicationsRepository } from './communications';

/**
 * Hybrid provider: canonical clients, tasks, exceptions, staff, audit,
 * campaigns, and communications read/write from Supabase. Reports remain
 * on the mock provider until aggregations ship in the next workstream.
 */
export const supabaseDataProvider: CrmDataProvider = {
  ...mockDataProvider,
  clients: supabaseClientsRepository,
  tasks: supabaseTasksRepository,
  exceptions: supabaseExceptionsRepository,
  staff: supabaseStaffRepository,
  audit: supabaseAuditRepository,
  campaigns: supabaseCampaignsRepository,
  communications: supabaseCommunicationsRepository,
};


