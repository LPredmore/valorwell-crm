import { describe, expect, it } from 'vitest';
import { rpcCalls, definedFunctions, missingRpcs } from '../../scripts/check-edge-rpc-contracts.mjs';

describe('edge RPC contract check', () => {
  it('flags the Gmail retrieval-failure RPC when no migration defines it', () => {
    const calls = rpcCalls('await admin.rpc("record_relationship_gmail_retrieval_failure", {})');
    expect(missingRpcs(calls, new Set<string>(), new Set<string>())).toEqual(['record_relationship_gmail_retrieval_failure']);
  });
  it('passes once a migration defines the function, with or without public. prefix', () => {
    const defined = definedFunctions('create or replace function public.record_relationship_gmail_retrieval_failure(p text)');
    expect(missingRpcs(['record_relationship_gmail_retrieval_failure'], defined, new Set())).toEqual([]);
    expect(definedFunctions('CREATE FUNCTION foo_bar(x int)').has('foo_bar')).toBe(true);
  });
  it('honors the verified-live allowlist', () => {
    expect(missingRpcs(['crm_apply_remove'], new Set(), new Set(['crm_apply_remove']))).toEqual([]);
  });
});
