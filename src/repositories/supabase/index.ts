import type { CrmDataProvider } from '../types';
import { mockDataProvider } from '../mock';
import { supabaseClientsRepository } from './clients';
import { supabaseTasksRepository } from './tasks';
import { supabaseExceptionsRepository } from './exceptions';
import { supabaseStaffRepository } from './staff';
import { supabaseAuditRepository } from './audit';

/**
 * Hybrid provider: canonical clients, tasks, exceptions, staff, and audit
 * read/write from Supabase. Campaigns / communications / reports continue
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
};
