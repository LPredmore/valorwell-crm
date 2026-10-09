import {describe,it,expect} from 'vitest';
import {allowedBtySourceStatuses,requireBtySourceTransition} from './bty-source-transitions';
describe('BTY source-driven stage permissions',()=>{
  it('matches authoritative known opportunity transition graph',()=>{
    expect(allowedBtySourceStatuses('ready_for_campaign')).toEqual(['contacted','nurture','disqualified']);
    expect(allowedBtySourceStatuses('booked')).toContain('completed');
    expect(allowedBtySourceStatuses('qualified')).not.toContain('ready_for_campaign');
    expect(allowedBtySourceStatuses('declined')).toEqual(['nurture','researching']);
    expect(allowedBtySourceStatuses('bad_source_status')).toEqual([]);
  });
  it('rejects shortcuts, empty audit reasons and absent versions',()=>{
    expect(()=>requireBtySourceTransition('identified','completed','Actual interview completed',2)).toThrow(/not supported/);
    expect(()=>requireBtySourceTransition('qualified','contacted','',2)).toThrow(/reason/);
    expect(()=>requireBtySourceTransition('qualified','contacted','Verified a personal reply',null)).toThrow(/version/);
    expect(()=>requireBtySourceTransition('qualified','contacted','Verified an outreach interaction',3)).not.toThrow();
  });
});
