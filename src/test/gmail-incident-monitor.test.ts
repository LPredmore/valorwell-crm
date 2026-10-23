// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync('scripts/gmail-recovery/daily-monitor.candidate.ts','utf8');
const ast = ts.createSourceFile('monitor.ts',source,ts.ScriptTarget.Latest,true);
const code = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ['num','timestamp','buildSignals'].includes(n.name?.text ?? '')).map(n => n.getText(ast)).join('\n');
const signals = vm.runInNewContext(ts.transpileModule(code+'\nbuildSignals;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{Date}) as (now: Record<string,unknown>, previous: Record<string,unknown> | null) => Array<{code:string;severity:string}>;
describe('staged daily monitor persistent Gmail conditions',()=>{
  it('warns at 60 and becomes critical at 240 minutes, including an unchanged stale timestamp',()=>{
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T15:00:00Z'));
    try {
      for (const [age,expected] of [[59,null],[60,'gmail_sync_stale'],[239,'gmail_sync_stale'],[240,'gmail_sync_critical']] as const) {
        const snapshot={gmail:{last_sync:new Date(Date.now()-age*60_000).toISOString(),watch_expires:'2026-10-30T00:00:00Z'}};
        const result=signals(snapshot,snapshot).filter(s=>s.code.startsWith('gmail_sync'));
        expect(result.map(s=>s.code)).toEqual(expected ? [expected] : []);
      }
    } finally {vi.useRealTimers();}
  });
  it('reports unknown successful verification separately',()=>{
    expect(signals({gmail:{watch_expires:'2099-01-01'}},null).map(s=>s.code)).toContain('gmail_sync_unknown');
  });
});