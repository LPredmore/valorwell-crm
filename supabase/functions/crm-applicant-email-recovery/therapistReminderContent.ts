export const APPLICATION_URL="https://valorwell.org/therapistapplication";
const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
 .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
export function applicationReminderContent(step:2|3|4,firstName:string|null) {
 const greeting=firstName?"Hi "+firstName.trim()+",":"Hi,";
 const byStep={
  2:{subject:"Checking in about your ValorWell therapist application",body:[
    greeting,
    "Thanks again for your interest in ValorWell. A couple of days ago, we emailed you a link to our professional application.",
    "If you're interested in moving forward, we'd love for you to complete the application so we can learn a bit more about your licensure and experience.",
    "Here is the application portal: "+APPLICATION_URL,
    "Please use the same email address from your original interest registration. You can save your progress.",
    "If you've already started, you can disregard this reminder.",
    "Luke","ValorWell",
  ]},
  3:{subject:"Still interested in exploring ValorWell?",body:[
    greeting,
    "I wanted to check in once more about your interest in practicing with ValorWell.",
    "I know schedules get busy. If the opportunity still sounds like a good fit, you can complete your professional application whenever you're ready.",
    "Application portal: "+APPLICATION_URL,
    "There's no need to reply if you've already begun, and you're welcome to reach out with any questions.",
    "Luke","ValorWell",
  ]},
  4:{subject:"Final follow-up on your ValorWell therapist application",body:[
    greeting,
    "This is my last follow-up about your interest in joining ValorWell.",
    "We haven't received a started application yet, so I'll close out our follow-up sequence for now. You're welcome to return if the timing becomes right.",
    "If you'd still like us to consider your application, you can begin here: "+APPLICATION_URL,
    "Thanks for your interest and for the work you do.",
    "Luke","ValorWell",
  ]}
 } as const;
 const entry=byStep[step];
 if(!entry)throw new Error("Invalid follow-up step");
 const paragraphs=[...entry.body];
 return {
  subject:entry.subject,
  text:paragraphs.join("\n\n"),
  html:paragraphs.map(p=>"<p>"+esc(p).replace(APPLICATION_URL,
   '<a href="'+APPLICATION_URL+'">'+APPLICATION_URL+"</a>")+"</p>").join("")
 };
}
