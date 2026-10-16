export const actor={userId:'operator-a',allowedTenantIds:['tenant-a'],canCommunicate:true};
export const mailbox='inbox-a@example.test';
export const rules='BTY_RULE: Include https://example.test/schedule for booking. Use a one-hour interview.';
export const reply='Thanks for your interest. Please book your one-hour interview at https://example.test/schedule.';
export const followUp={type:'create_follow_up_task',key:'followup-1',title:'Confirm interview booking',dueAt:'2026-11-03T15:00:00-06:00'};
export async function seed(store) {
 await store.insert('crm_resend_email_settings',{tenant_id:'tenant-a',inbound_email:mailbox});
 await store.insert('clients',{id:'client-a',tenant_id:'tenant-a',email:'guest@example.test',pat_name_f:'Fixture'});
 await store.insert('clients',{id:'client-b',tenant_id:'tenant-b',email:'guest@example.test',pat_name_f:'Other tenant'});
 await store.insert('spike_context',{tenant_id:'tenant-a',email:'guest@example.test',organization:'Fixture Veterans Organization',operating_rules:rules});
 await store.insert('spike_context',{tenant_id:'tenant-b',email:'guest@example.test',organization:'SECRET_OTHER_TENANT',operating_rules:'SECRET_OTHER_RULE'});
 await store.insert('crm_email_messages',{id:'out-a',tenant_id:'tenant-a',client_id:'client-a',direction:'outbound',status:'sent',sender_email:mailbox,recipient_email:'guest@example.test',subject:'Interview invitation',body_text:'Would you join our veteran organization interview?',provider:'resend',provider_message_id:'provider-out-a',provider_thread_id:'rfc-out-a@example.test',occurred_at:'2026-10-15T12:00:00Z'});
 await store.insert('crm_email_messages',{id:'other-b',tenant_id:'tenant-b',client_id:'client-b',direction:'inbound',status:'received',sender_email:'guest@example.test',recipient_email:'inbox-b@example.test',subject:'Interview invitation',body_text:'SECRET_OTHER_TENANT_MESSAGE',provider:'resend',provider_message_id:'provider-other-b',occurred_at:'2026-10-15T12:01:00Z'});
}
export const inboundContent={from:'guest@example.test',to:[mailbox],subject:'Re: Interview invitation',text:'Yes, how do I book the interview? Please follow up next week.',html:'<p>Yes, how do I book the interview? Please follow up next week.</p>',message_id:'rfc-in-a@example.test',headers:{'in-reply-to':'rfc-out-a@example.test'}};
export function mime(to=mailbox,body=inboundContent.text) {
 return ['From: Fixture Guest <guest@example.test>',`To: ${to}`,'Subject: Re: Interview invitation','Message-ID: <rfc-in-a@example.test>','In-Reply-To: <rfc-out-a@example.test>','References: <rfc-out-a@example.test>','Content-Type: text/plain; charset=UTF-8','',''+body].join('\r\n');
}
