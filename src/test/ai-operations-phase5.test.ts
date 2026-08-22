import { describe, expect, it } from 'vitest';
import { MODULE_WORK_TYPES, promptVersionForModule } from '../../supabase/functions/_shared/ai-ops-prompts';
import { dispatcherActionFor } from '../../supabase/functions/_shared/ai-ops';
import { AI_OPERATIONS_MODULES, AI_OPERATIONS_MODULE_LABELS, AI_OPERATIONS_FLAGS } from '@/lib/crm/ai-operations';

describe('Phase 5 AI Operations modules', () => {
  it('registers Phase 5 modules in the prompt registry', () => {
    expect(MODULE_WORK_TYPES.sop_compliance).toBe('sop_compliance_review');
    expect(MODULE_WORK_TYPES.weekly_patterns).toBe('weekly_pattern_review');
    expect(MODULE_WORK_TYPES.user_flow_smoke).toBe('user_flow_smoke_check');
    expect(promptVersionForModule('user_flow_smoke')).toBe('1');
  });

  it('exposes the smoke-test module and its switch to the dashboard', () => {
    expect(AI_OPERATIONS_MODULES).toContain('user_flow_smoke');
    expect(AI_OPERATIONS_MODULE_LABELS.user_flow_smoke).toBe('User-flow smoke tests');
    expect(AI_OPERATIONS_FLAGS).toContain('user_flow_smoke_enabled');
  });

  it('refreshes deterministic System Integrity every 15 minutes after the daily run starts', () => {
    expect(dispatcherActionFor('03:25')).toBeNull();
    expect(dispatcherActionFor('03:30')).toBe('integrity');
    expect(dispatcherActionFor('03:45')).toBe('integrity');
    expect(dispatcherActionFor('04:00')).toBe('integrity');
    expect(dispatcherActionFor('04:15')).toBe('integrity');
    expect(dispatcherActionFor('04:30')).toBe('reconcile');
    expect(dispatcherActionFor('04:45')).toBe('retry');
    expect(dispatcherActionFor('05:00')).toBe('integrity');
    expect(dispatcherActionFor('23:45')).toBe('integrity');
  });
});
