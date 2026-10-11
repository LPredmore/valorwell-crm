export type RecruitmentClaim = {
 tenantId:string;stepId:string;planId:string;leaseToken:string;emailMessageId:string;
 attempt:number;fromEmail:string;fromName:string|null;replyTo:string|null;
 to:string;subject:string;bodyText:string;postalAddress:string;idempotencyKey:string;
};
export type SendResponse = {id?:string;message?:string;name?:string};
export type WorkerDecision = 'accepted'|'retry'|'uncertain'|'failed';
export function canAttemptDelivery(options:{runtimeEnabled:boolean;databaseEnabled:boolean;claimValid:boolean}):boolean{
 return options.runtimeEnabled===true&&options.databaseEnabled===true&&options.claimValid===true;
}
export function normalizeEmail(input:string):string {
 const email=input.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('INVALID_EMAIL');
 return email;
}
export function taggedReplyTo(email:string|null,messageId:string):string {
 if(!email)throw new Error('INBOUND_REPLY_NOT_CONFIGURED');
 const [local,domain]=normalizeEmail(email).split('@');
 if(!/^[0-9a-f-]{36}$/i.test(messageId))throw new Error('INVALID_MESSAGE_ID');
 return local.split('+')[0]+`+crm-${messageId}@`+domain;
}
export function classifyResendResponse(status:number,response:SendResponse|null,networkFailed=false):WorkerDecision{
 if(networkFailed)return 'uncertain';
 if(status>=200&&status<300&&response?.id)return 'accepted';
 if(status===429)return 'retry';
 // If the request may have reached Resend, never blindly resend on 5xx/timeouts.
 if(status>=500)return 'uncertain';
 return 'failed';
}
export function renderRecruitmentEmail(input:{
 body:string;postalAddress:string;unsubscribeUrl:string;
}):{text:string;html:string}{
 const postal=input.postalAddress.trim();
 if(!postal)throw new Error('POSTAL_ADDRESS_REQUIRED');
 const plain=input.body.trim();
 if(!plain||!/^https:\/\//.test(input.unsubscribeUrl))throw new Error('INVALID_EMAIL_CONTENT');
 const text=plain+`\n\n---\nValorWell · ${postal}\nStop recruitment emails: ${input.unsubscribeUrl}\n`;
 const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const html=`<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escape(plain)}</div><hr/><p style="font-size:12px;color:#555">ValorWell · ${escape(postal)}<br><a href="${escape(input.unsubscribeUrl)}">Stop recruitment emails</a></p>`;
 return {text,html};
}
