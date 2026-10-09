export type DonorRecord = {
  relationship_contact_id:string|null;
  recurring_status:string|null;
  donation_count:number|null;
  lifetime_amount:number|string|null;
  last_donation_at:string|null;
  metadata:Record<string,unknown>|null;
};
export type DonorCardValues = {donor_type:string;lifetime_amount:number;last_donation_at:string|null};

/** Monetary values come exclusively from ingested, authoritative donor data.
 * Never treat a temporary QA record as an actual donor or gift. */
export function donorCardValues(row:DonorRecord):DonorCardValues|null{
  if(!row.relationship_contact_id||row.metadata?.temporaryE2ETest===true)return null;
  const count=Math.max(0,row.donation_count??0);
  const amount=Number(row.lifetime_amount??0);
  if(!Number.isFinite(amount)||amount<0)return null;
  const recurring=(row.recurring_status??'').trim().toLowerCase();
  let type='Prospective';
  if(count>0){
    if(['active','recurring','current'].includes(recurring))type='Recurring';
    else if(['canceled','cancelled','lapsed','failed','past_due','inactive'].includes(recurring))type='Lapsed';
    else type='One-time';
  }
  return {donor_type:type,lifetime_amount:amount,last_donation_at:row.last_donation_at};
}
