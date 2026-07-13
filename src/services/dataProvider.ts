import type { CrmDataProvider } from '@/repositories/types';
import { mockDataProvider } from '@/repositories/mock';

/**
 * Central switch between mock and Supabase-backed data providers.
 *
 * The Supabase adapter is intentionally NOT wired here yet. Phase-1 of the
 * CRM overhaul builds the entire application against the mock provider.
 * When Supabase adapters are implemented in the dedicated backend phase,
 * flip the flag below by reading VITE_USE_MOCK_DATA at runtime.
 */
const useMock = true;

export const dataProvider: CrmDataProvider = useMock ? mockDataProvider : mockDataProvider;
