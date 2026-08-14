import { describe, expect, it } from 'vitest';
import {
  CONTROL_PLANE_FLAGS,
  CONTROL_PLANE_FLAG_LABELS,
  canEnableControlPlaneFlag,
  type ControlPlaneFlag,
} from '@/lib/crm/communications-control-plane';

const flags = (overrides: Partial<Record<string, boolean>> = {}): ControlPlaneFlag[] =>
  CONTROL_PLANE_FLAGS.map((flagName) => ({
    flagName,
    enabled: overrides[flagName] ?? false,
    updatedAt: null,
  }));

describe('communications control plane flags', () => {
  it('labels every flag', () => {
    for (const flagName of CONTROL_PLANE_FLAGS) {
      expect(CONTROL_PLANE_FLAG_LABELS[flagName]).toBeTruthy();
    }
  });

  it('blocks trigger cutovers until the trigger engine is enabled', () => {
    const off = flags();
    expect(canEnableControlPlaneFlag('client_trigger_cutover_enabled', off)).toBe(false);
    expect(canEnableControlPlaneFlag('bty_trigger_cutover_enabled', off)).toBe(false);
  });

  it('allows trigger cutovers once the trigger engine is enabled', () => {
    const on = flags({ campaign_trigger_engine_enabled: true });
    expect(canEnableControlPlaneFlag('client_trigger_cutover_enabled', on)).toBe(true);
    expect(canEnableControlPlaneFlag('bty_trigger_cutover_enabled', on)).toBe(true);
  });

  it('does not gate unrelated switches', () => {
    const off = flags();
    expect(canEnableControlPlaneFlag('universal_newsletters_enabled', off)).toBe(true);
    expect(canEnableControlPlaneFlag('staff_campaigns_enabled', off)).toBe(true);
  });
});
