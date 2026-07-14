// Versioned canonical contract package — v1
// Version identity surfaces in every Phase Completion Report + CI assertion.
// Live backend contract deployed 2026-07-14 to project ahqauomkgflopxgnlndd.
export const CONTRACT_VERSION = 'valorwell-crm-contracts@1.0.1+20260714';
export const CANONICAL_READ_VIEW = 'v_client_canonical_state';

export * from './client-state.types';
export * from './events.types';
export * from './mutations.types';
export * from './roles.ts';
export * from './campaigns.types';
