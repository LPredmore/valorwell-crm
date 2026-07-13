// Versioned canonical contract package — v1
// Version identity surfaces in every Phase Completion Report + CI assertion.
export const CONTRACT_VERSION = 'valorwell-crm-contracts@1.0.0+pending-supabase-hash';
export const CANONICAL_READ_VIEW = 'v_client_canonical_state';

export * from './client-state.types';
export * from './events.types';
export * from './mutations.types';
export * from './roles.ts';
export * from './campaigns.types';
