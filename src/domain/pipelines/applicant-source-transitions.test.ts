import {describe,it,expect} from 'vitest';
import {allowedApplicantSourceStatuses,requireApplicantSourceTransition} from './applicant-source-transitions';
describe('authoritative applicant status transition gating',()=>{
  it('permits only safe Contacted -> Screening through existing staff contract',()=>{
    expect(allowedApplicantSourceStatuses('contacted')).toEqual(['screening']);
    for(const s of ['new','screening','application','credentialing','ready','hired','withdrawn']){
      expect(allowedApplicantSourceStatuses(s)).toEqual([]);
    }
    expect(()=>requireApplicantSourceTransition('new','contacted',1,'a','Call Friday','2026-10-13T13:00:00Z','We sent an email')).toThrow(/staff/);
    expect(()=>requireApplicantSourceTransition('screening','ready',1,'a','Call Friday','2026-10-13T13:00:00Z','Approved now')).toThrow(/staff/);
    expect(()=>requireApplicantSourceTransition('contacted','screening',1,null,'Call Friday','2026-10-13T13:00:00Z','Discussed screening')).toThrow(/owner/);
    expect(()=>requireApplicantSourceTransition('contacted','screening',1,'a','Call Friday','2026-10-13T13:00:00Z','Discussed screening')).not.toThrow();
  });
});
