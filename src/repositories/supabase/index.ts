import type { CrmDataProvider } from '../types';
import { mockDataProvider } from '../mock';
import { supabaseClientsRepository } from './clients';
import { supabaseTasksRepository } from './tasks';
import { supabaseExceptionsRepository } from './exceptions';

/**
 * Hybrid provider: canonical clients, tasks, and exceptions read/write from
 * Supabase. Campaigns / communications / staff / audit / reports continue
 * on the mock provider until their backing tables and RPCs ship in later
 * workstreams.
 */
export const supabaseDataProvider: CrmDataProvider = {
  ...mockDataProvider,
  clients: supabaseClientsRepository,
  tasks: supabaseTasksRepository,
  exceptions: supabaseExceptionsRepository,
};
