import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { interviewInvitationEmailContent } from '../../supabase/functions/provider-applicant-communication-worker/interview-content';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261022223000_applicant_invitation_to_interview.sql'),
  'utf8',
);

describe('Invitation to Interview clinician workflow', () => {
  const recipient = { first_name: 'Taylor' };
  const link = 'https://valorwell.org/clinicians/interview';

  it('uses the new one-hour scheduler and the application email for all three messages', () => {
    for (const step of ['initial_email', 'interview_followup_2', 'interview_followup_3'] as const) {
      const result = interviewInvitationEmailContent(recipient, step);
      expect(result.text).toContain('Taylor');
      expect(result.text).toContain(link);
      expect(result.text).toContain('same email address you used on your application');
      expect(result.html).toContain('<a href="' + link + '">');
      expect(result.text).not.toContain('calendly.com');
      expect(result.text).not.toContain('SMS');
    }
  });

  it('sends distinct messages and promises not to continue reaching out after the final note', () => {
    const initial = interviewInvitationEmailContent(recipient, 'initial_email');
    const reminder = interviewInvitationEmailContent(recipient, 'interview_followup_2');
    const final = interviewInvitationEmailContent(recipient, 'interview_followup_3');
    expect(initial.subject).toMatch(/thank you/i);
    expect(reminder.text).toMatch(/still interested/i);
    expect(final.text).toContain("This will be my last follow-up.");
    expect(final.text).toMatch(/whenever you're ready/i);
    expect(new Set([initial.subject, reminder.subject, final.subject]).size).toBe(3);
  });

  it('escapes applicant-supplied names before HTML rendering', () => {
    const result = interviewInvitationEmailContent({ first_name: '<script>alert(1)</script>' }, 'initial_email');
    expect(result.html).not.toContain('<script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  it('keeps existing staff out of the campaign and creates a manual owner task instead', () => {
    expect(sql).toContain('private.crm_matching_staff_for_applicant(new.tenant_id,new.email,new.phone)');
    expect(sql).toContain('insert into public.crm_tasks');
    expect(sql).toContain("where s.id='af790579-5d4c-4aed-9d2e-77d72908ed85'");
    expect(sql).toContain("return new;\n end if;\n insert into public.crm_applicant_interview_enrollments");
    expect(sql).not.toContain("'initial_sms','sms','interview_invitation_v1'");
  });

  it('uses successful provider acceptance for two-day and seven-day delays', () => {
    expect(sql).toContain("v_delay:=interval '2 days'");
    expect(sql).toContain("v_delay:=interval '7 days'");
    expect(sql).toContain("coalesce(new.sent_at,clock_timestamp())+v_delay");
  });

  it('advances to Interview Scheduled and stops unsent reminders on booking confirmation', () => {
    expect(sql).toContain("new.status='confirmed'");
    expect(sql).toContain("set status='interview_scheduled'");
    expect(sql).toContain("error_code='interview_booked'");
    expect(sql).toContain("'Interview Scheduled',10,false,'interview_scheduled'");
  });
});
