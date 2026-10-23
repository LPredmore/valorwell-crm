/** Source-connected applicant actions. Automatic qualification on submission is
 * implemented in the authoritative database trigger, not drag-and-drop. */
export function allowedApplicantSourceStatuses(current:string):readonly string[]{
  if(current==='contacted')return ['screening'];
  if(current==='screening')return ['interview_invited'];
  if(current==='interview_scheduled')return ['interview_completed','accepted'];
  if(current==='interview_completed')return ['accepted'];
  return [];
}
export function requireApplicantSourceTransition(
  current:string,destination:string,version:number|null,ownerId:string|null,
  nextAction:string|null,nextActionDueAt:string|null,reason:string,
):void{
  if(!allowedApplicantSourceStatuses(current).includes(destination))
    throw new Error('This applicant stage must be changed in the authorized staff applicant workflow.');
  if(version===null||!Number.isSafeInteger(version)||version<0)
    throw new Error('Applicant source version is missing. Refresh the board.');
  if(reason.trim().length<8)
    throw new Error('Enter a note of at least 8 characters explaining the stage change.');
  // Contacted -> Screening continues to require a staffed and dated follow-up.
  // Other transitions use the dedicated, audited interview-stage RPC.
  if(current==='contacted'&&(!ownerId||!nextAction?.trim()||!nextActionDueAt))
    throw new Error('An assigned owner and next action with due date are required by the staff workflow.');
}
