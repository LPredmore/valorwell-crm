import {describe,it,expect} from "vitest";
import {screeningInterviewEmail,INTERVIEW_BOOKING_URL} from "../../supabase/functions/screening-interview-campaign/content";

describe("Screening interview invitation campaign",()=>{
 it("sends four distinct, personal messages with the real scheduling link",()=>{
  const subjects=new Set<string>();
  for(const step of [1,2,3,4] as const){
   const message=screeningInterviewEmail(step,"Taylor");
   subjects.add(message.subject);
   expect(message.text).toContain(INTERVIEW_BOOKING_URL);
   expect(message.html).toContain('<a href="'+INTERVIEW_BOOKING_URL+'">');
   expect(message.text).toContain("Luke");
   expect(message.text).not.toContain("therapistapplication");
  }
  expect(subjects.size).toBe(4);
 });
 it("ends with courteous and explicit closure of follow-up",()=>{
  const last=screeningInterviewEmail(4,"Taylor");
  expect(last.text).toContain("last");
  expect(last.text).toContain("right time");
  expect(last.text).toContain("close out my follow-ups");
 });
 it("escapes untrusted names before rendering HTML",()=>{
  const m=screeningInterviewEmail(1,'<script>alert("hi")</script>');
  expect(m.html).not.toContain("<script>");
  expect(m.html).toContain("&lt;script&gt;");
 });
});
