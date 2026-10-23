import {describe,it,expect} from 'vitest';
import {allowedApplicantSourceStatuses,requireApplicantSourceTransition} from './applicant-source-transitions';
describe('authorized applicant stage transitions',()=>{
  it('keeps initial application routing authoritative, not editable by dragging',()=>{
    for(const s of ['new','application','interview_invited','ready','hired','withdrawn'])
      expect(allowedApplicantSourceStatuses(s)).toEqual([]);
    expect(allowedApplicantSourceStatuses('contacted')).toEqual(['screening']);
    expect(()=>requireApplicantSourceTransition('new','interview_invited',1,'a','Follow up','2026-10-23T20:00:00Z','Someone applied')).toThrow(/staff/);
  });
  it('supports manual hold release after staff review',()=>{
    expect(allowedApplicantSourceStatuses('screening')).toEqual(['interview_invited']);
    expect(()=>requireApplicantSourceTransition('screening','interview_invited',3,null,null,null,'Cleared disclosure details')).not.toThrow();
  });
  it('permits only interview completed or accepted after an actual scheduled interview',()=>{
    expect(allowedApplicantSourceStatuses('interview_scheduled')).toEqual(['interview_completed','accepted']);
    expect(allowedApplicantSourceStatuses('interview_completed')).toEqual(['accepted']);
    expect(()=>requireApplicantSourceTransition('interview_scheduled','accepted',5,null,null,null,'I interviewed the clinician and approved')).not.toThrow();
    expect(()=>requireApplicantSourceTransition('interview_scheduled','accepted',null,null,null,null,'I approve candidate')).toThrow(/version/);
    expect(()=>requireApplicantSourceTransition('screening','accepted',3,null,null,null,'Not interviewed yet')).toThrow(/staff/);
  });
  it('retains owner and dated next action for Contacted -> Screening',()=>{
    expect(()=>requireApplicantSourceTransition('contacted','screening',1,null,'Call Friday','2026-10-13T13:00:00Z','Discussed screening')).toThrow(/owner/);
    expect(()=>requireApplicantSourceTransition('contacted','screening',1,'a','Call Friday','2026-10-13T13:00:00Z','Discussed screening')).not.toThrow();
  });
});