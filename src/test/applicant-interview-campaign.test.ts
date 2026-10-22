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
    expect(sql).toContain('if v_match is not null');
    expect(sql).toContain('insert into public.crm_applicant_interview_enrollments');
    expect(sql.indexOf('insert into public.crm_tasks')).toBeLessThan(sql.indexOf('insert into public.crm_applicant_interview_enrollments'));
    expect(sql).not.toContain("'initial_sms','sms','interview_invitation_v1'");
  });

  it('uses successful provider acceptance for two-day and seven-day delays', () => {
    expect(sql).toContain("v_delay:=interval '2 days'");
    expect(sql).toContain("v_delay:=interval '7 days'");
    expect(sql).toContain('coalesce(new.sent_at,clock_timestamp())+v_delay');
  });

  it('is disabled until an administrator explicitly activates it', () => {
    expect(sql).toContain('enabled boolean not null default false');
    expect(sql).toContain("values('00000000-0000-0000-0000-000000000001'::uuid,false)");
    expect(sql).toContain('where ctl.tenant_id=new.tenant_id and ctl.enabled=true');
    expect(sql).toContain("coalesce(v_context->>'crm_role','')<>'crm_admin'");
  });

  it('enforces at least two hours from application submission', () => {
    expect(sql).toContain("new.created_at+interval '2 hours'");
    expect(sql).toContain('private.crm_applicant_interview_next_window(');
  });

  it('uses a 6 AM to 6 PM America/Chicago window for initial and follow-up dispatch', () => {
    expect(sql).toContain("time '06:00'");
    expect(sql).toContain("time '18:00'");
    expect(sql).toContain("v_local:=p_after at time zone 'America/Chicago'");
    expect(sql).toContain("job.content_version='interview_invitation_v1'");
    expect(sql).toContain("job.content_version<>'interview_invitation_v1'");
    expect(sql).toContain("coalesce(new.sent_at,clock_timestamp())+v_delay");
  });

  it('advances to Interview Scheduled and stops unsent reminders on booking confirmation', () => {
    expect(sql).toContain("new.status='confirmed'");
    expect(sql).toContain("set status='interview_scheduled'");
    expect(sql).toContain("error_code='interview_booked'");
    expect(sql).toContain("'Interview Scheduled',10,false,'interview_scheduled'");
  });
});
