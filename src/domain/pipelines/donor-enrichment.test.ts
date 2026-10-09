import {describe,it,expect} from 'vitest';
import {donorCardValues} from './donor-enrichment';
describe('authoritative donor read-through',()=>{
  it('never treats unlinked or temporary test donor records as real gifts',()=>{
    expect(donorCardValues({relationship_contact_id:null,recurring_status:'active',donation_count:4,lifetime_amount:'90.00',last_donation_at:null,metadata:{}})).toBeNull();
    expect(donorCardValues({relationship_contact_id:'a',recurring_status:'active',donation_count:4,lifetime_amount:'90.00',last_donation_at:null,metadata:{temporaryE2ETest:true}})).toBeNull();
  });
  it('distinguishes prospective, recurring, one-time and lapsed from actual gift ledger',()=>{
    const base={relationship_contact_id:'a',donation_count:0,lifetime_amount:'0',last_donation_at:null,recurring_status:'none',metadata:null};
    expect(donorCardValues(base)?.donor_type).toBe('Prospective');
    expect(donorCardValues({...base,donation_count:2,lifetime_amount:'500.80',recurring_status:'active'})?.donor_type).toBe('Recurring');
    expect(donorCardValues({...base,donation_count:1,lifetime_amount:'50.00'})?.donor_type).toBe('One-time');
    expect(donorCardValues({...base,donation_count:5,lifetime_amount:'200.00',recurring_status:'cancelled'})?.donor_type).toBe('Lapsed');
    expect(donorCardValues({...base,donation_count:1,lifetime_amount:'NaN'})).toBeNull();
  });
});
