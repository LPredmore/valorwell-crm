import type { CrmDataProvider } from '../types';
import { mockDataProvider } from '../mock';
import { supabaseClientsRepository } from './clients';
import { supabaseTasksRepository } from './tasks';
import { supabaseExceptionsRepository } from './exceptions';
import { supabaseStaffRepository } from './staff';
import { supabaseAuditRepository } from './audit';
import { supabaseCampaignsRepository } from './campaigns';

/**
 * Hybrid provider: canonical clients, tasks, exceptions, staff, audit, and
 * campaigns read/write from Supabase. Communications and reports continue
 * on the mock provider until their backing tables and RPCs ship in later
 * workstreams.
 */
export const supabaseDataProvider: CrmDataProvider = {
  ...mockDataProvider,
  clients: supabaseClientsRepository,
  tasks: supabaseTasksRepository,
  exceptions: supabaseExceptionsRepository,
  staff: supabaseStaffRepository,
  audit: supabaseAuditRepository,
  campaigns: supabaseCampaignsRepository,
};

