import type { CrmDataProvider } from '@/repositories/types';
import { mockDataProvider } from '@/repositories/mock';
import { supabaseDataProvider } from '@/repositories/supabase';

/**
 * Data provider switch.
 *
 * Set VITE_USE_MOCK_DATA=true in the environment to force the mock
 * provider (useful for storybook/tests). By default the app now reads
 * canonical client state from Supabase (v_client_canonical_state) and
 * writes through the canonical RPCs (see supabase/migrations).
 */
const forceMock = import.meta.env.VITE_USE_MOCK_DATA === 'true';

export const dataProvider: CrmDataProvider = forceMock ? mockDataProvider : supabaseDataProvider;
