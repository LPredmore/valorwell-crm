// Four-stage interview invitation series. Source of truth for email copy.
// This module has no access to applicant data or service credentials.
export const INTERVIEW_BOOKING_URL = "https://valorwell.org/clinicians/interview";
const escapeHTML = (s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;")
 .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
export function screeningInterviewEmail(step:1|2|3|4,firstName:string|null){
 const name=firstName?.trim()||"there";
 const greeting="Hi "+name+",";
 const link="You can choose a time here: "+INTERVIEW_BOOKING_URL;
 const instruction="Use the same email address from your application to access the scheduling page.";
 const variants={
  1:{
    subject:"An invitation to interview with ValorWell",
    paragraphs:[greeting,
      "Thank you for taking the time to complete your ValorWell application. I've had a chance to move your application forward, and I'd like to invite you to meet with me.",
      "It would be a one-hour conversation about your clinical experience, what you're looking for, and whether ValorWell might be a good fit for both of us.",
      link,instruction,"I look forward to talking with you.","Luke"]
  },
  2:{
    subject:"Following up on your ValorWell interview invitation",
    paragraphs:[greeting,
      "I wanted to follow up on the interview invitation I sent a couple of days ago.",
      "If you're still interested in the opportunity, you're welcome to choose a time that works for you. There's no need to send me your availability separately.",
      link,instruction,"Hope we have the chance to connect.","Luke"]
  },
  3:{
    subject:"Checking back in about ValorWell",
    paragraphs:[greeting,
      "Just checking back in about the invitation to interview with ValorWell.",
      "I know schedules get full, so I don't want to crowd your inbox. If you'd still like to explore the opportunity, the invitation is open and you can find a time here:",
      INTERVIEW_BOOKING_URL,instruction,"All the best,","Luke"]
  },
  4:{
    subject:"Closing the loop on your ValorWell interview invitation",
    paragraphs:[greeting,
      "I wanted to send one last note about the opportunity to interview with ValorWell.",
      "I understand that this may not be the right time, and that's completely fine. I haven't heard back about scheduling, so I'll close out my follow-ups rather than keep filling your inbox. I won't send any further reminders about this opportunity.",
      "If your circumstances change and you'd like to reconnect, you're welcome to reach out. You can also still use the interview link here:",
      INTERVIEW_BOOKING_URL,instruction,
      "Thank you again for your interest, and I wish you the best.","Luke"]
  }
 } as const;
 const entry=variants[step];
 return {subject:entry.subject,text:entry.paragraphs.join("\n\n"),
  html:entry.paragraphs.map(p=>"<p>"+escapeHTML(p).replace(
    INTERVIEW_BOOKING_URL,'<a href="'+INTERVIEW_BOOKING_URL+'">'+INTERVIEW_BOOKING_URL+"</a>")+"</p>").join("")};
}
