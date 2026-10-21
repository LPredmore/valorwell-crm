import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
// Execute the actual Edge function with controlled I/O; no Deno runtime or network.
const source = readFileSync('supabase/functions/_shared/relationship-google-sync.ts', 'utf8');
const ast = ts.createSourceFile('sync.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'processGmailMessage');
if (!declaration) throw new Error('Gmail processor missing');
const processGmailMessage = vm.runInNewContext(ts.transpileModule(declaration.getText(ast) + '\nprocessGmailMessage;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
  TENANT_ID: 'synthetic-tenant',
  googleJson: async () => ({ threadId: 'thread', internalDate: '0', payload: {}, labelIds: [] }),
  metadataUrl: () => 'https://example.invalid',
  headerMap: () => ({ from: 'sender@example.invalid', to: 'recipient@example.invalid' }),
  firstEmail: (value: string) => value,
  emailList: (value: string) => [value],
  gmailBody: () => 'synthetic body',
}) as (admin: { rpc: (name: string) => Promise<unknown> }, token: string, id: string) => Promise<{ matched: boolean }>;
describe('Gmail replay reports actual ingestion outcomes', () => {
  it.each([
    [null, false], [{}, false], [{ matched: false }, false],
    [{ observed: false, matched: false }, false],
    [{ matched: 'true', observed: 'true' }, false],
    [{ observed: true }, true], [{ matched: true }, true],
  ])('classifies ingestion %j as captured=%s', async (result, expected) => {
    const rpc = vi.fn(async (name: string) => ({ data: name === 'match_relationship_gmail_message'
      ? { observationEnabled: true, matched: true } : result, error: null }));
    const actual = await processGmailMessage({ rpc } as unknown as Parameters<typeof processGmailMessage>[0], 'synthetic-token', 'message');
    expect(actual.matched).toBe(expected);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('propagates failed persistence so replay can retry', async () => {
    const rpc = vi.fn(async (name: string) => name === 'match_relationship_gmail_message'
      ? { data: { observationEnabled: true, matched: true }, error: null }
      : { data: null, error: { message: 'synthetic persistence failure' } });
    await expect(processGmailMessage({ rpc } as unknown as Parameters<typeof processGmailMessage>[0], 'synthetic-token', 'message')).rejects.toThrow('synthetic persistence failure');
  });
});
