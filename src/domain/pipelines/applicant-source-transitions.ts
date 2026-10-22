/** Only enable applicant moves compatible with the existing staff approval,
 * contact-delivery and onboarding contracts. No generic CRM action can claim
 * outreach was delivered or skip Approved -> Invited staff handoff. */
export function allowedApplicantSourceStatuses(current:string):readonly string[]{
  if(current==='contacted')return ['screening'];
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
  if(!ownerId||!nextAction?.trim()||!nextActionDueAt)
    throw new Error('An assigned owner and next action with due date are required by the staff workflow.');
  if(reason.trim().length<8)
    throw new Error('Enter a note of at least 8 characters explaining the stage change.');
}
