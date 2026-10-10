import {describe,it,expect} from 'vitest';
import {durationSeconds} from '../../supabase/functions/release-distributor/metadata';
describe('release discovery duration metadata',()=>{
  it('parses both three-minute and long-form durations without applying a 60-second cutoff',()=>{
    expect(durationSeconds('PT3M')).toBe(180);
    expect(durationSeconds('PT1H2M3.5S')).toBe(3723.5);
    expect(durationSeconds('P1DT2H')).toBe(93600);
  });
  it('retains missing and invalid metadata as unknown',()=>{
    expect(durationSeconds(undefined)).toBeNull();
    expect(durationSeconds('three minutes')).toBeNull();
    expect(durationSeconds('PT-1S')).toBeNull();
  });
});
