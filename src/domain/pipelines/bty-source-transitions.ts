/** Mirrors the authoritative private.relationship_opportunity_status_transition_allowed
 * contract. The server independently revalidates all transitions under lock.
 * This is presentation guidance, NOT permission or business-rule enforcement.
 */
const allowed:Readonly<Record<string,readonly string[]>>={
  identified:['researching','qualified','nurture','disqualified'],
  researching:['qualified','nurture','disqualified'],
  qualified:['ready_for_campaign','contacted','nurture','disqualified'],
  ready_for_campaign:['contacted','nurture','disqualified'],
  contacted:['responded','nurture','declined','disqualified'],
  responded:['interested','nurture','declined'],
  interested:['recording_planned','booked','nurture','declined'],
  recording_planned:['booked','nurture','declined'],
  booked:['completed','nurture','declined'],
  nurture:['researching','qualified','contacted','responded','interested','disqualified'],
  declined:['nurture','researching'],
  disqualified:['identified'],
  completed:['nurture'],
};
export function allowedBtySourceStatuses(current:string):readonly string[]{
  return allowed[current]??[];
}
export function requireBtySourceTransition(
  current:string,destination:string,reason:string,version:number|null,
):void{
  if(!allowedBtySourceStatuses(current).includes(destination))
    throw new Error('That transition is not supported by the authoritative BTY workflow.');
  if(!reason.trim()||reason.trim().length<8)
    throw new Error('Enter an audit reason of at least 8 characters explaining the actual change.');
  if(version===null||!Number.isSafeInteger(version)||version<0)
    throw new Error('Source version is missing. Reload the opportunity before changing its status.');
}
