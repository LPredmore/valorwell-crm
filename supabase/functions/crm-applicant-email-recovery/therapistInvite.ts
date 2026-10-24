// Shared initial-invitation email for new clinician interest registrations.
// Used by register-clinician-interest (immediate send) and therapist-application
// (cron retry sweep). Sending is idempotent: the invite row id is the Resend
// idempotency key, so retries never produce a second email.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const APPLICATION_URL = "https://valorwell.org/therapistapplication";

export type InviteRow = {
  id: string;
  email: string;
  status: "pending" | "sent" | "failed";
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export function inviteEmailHtml(firstName: string | null): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";
  return `<div style="font-family: Trebuchet MS, Verdana, sans-serif; color: #111814; line-height: 1.6; max-width: 560px;">
<p>${greeting}</p>
<p>Thank you for raising your hand to explore practicing with ValorWell. We received your interest and wanted to follow up while it's fresh.</p>
<p>Your first step is a short license and NPI qualification form. You'll then be able to continue through the professional application, including relevant disclosures and optional work history. Your progress is saved along the way; a completed application is reviewed before interview invitations are offered.</p>
<p style="margin: 28px 0;"><a href="${APPLICATION_URL}" style="background: #3B5147; color: #F4F1E8; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: bold;">Continue your application</a></p>
<p style="font-size: 13px; color: #4a554f;">When you open the form, enter the same email address you used to register. We'll email you a one-time code to confirm it's you — no password needed.</p>
<p>Questions? Just reply to this email and a real person will get back to you.</p>
<p>— The ValorWell team</p>
</div>`;
}

/**
 * Sends the initial invitation for one outbox row and records the outcome.
 * Never throws: email delivery problems must not change the applicant's result.
 */
export async function sendTherapistInvite(
  admin: SupabaseClient,
  invite: InviteRow,
  firstName: string | null,
): Promise<"sent" | "failed"> {
  // This immediate interest-form email is part of the recruiter campaign.
  // Respect the same production kill switch as scheduled follow-ups.
  // Fail CLOSED if the switch cannot be read (e.g. database outage).
  const { data: campaign, error: campaignError } = await admin
    .from("therapist_application_followup_campaign_control")
    .select("enabled")
    .eq("tenant_id", "00000000-0000-0000-0000-000000000001")
    .maybeSingle();
  if (campaignError || campaign?.enabled !== true) {
    // Do not mark pending invitations as failed when explicitly paused:
    // manual resumption should be intentional and independently reviewed.
    return "failed";
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error(JSON.stringify({ fn: "therapist-invite", inviteId: invite.id, result: "failed", reason: "missing_resend_key" }));
    await admin.from("therapist_application_invites")
      .update({ status: "failed", last_error: "missing_resend_key" }).eq("id", invite.id);
    return "failed";
  }
  try {
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": invite.id,
      },
      body: JSON.stringify({
        from: "ValorWell <noreply@valorwell.org>",
        reply_to: "info@valorwell.org",
        to: [invite.email],
        subject: "Your next step with ValorWell",
        html: inviteEmailHtml(firstName),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await result.json().catch(() => ({})) as { id?: string };
    if (result.ok) {
      await admin.from("therapist_application_invites")
        .update({ status: "sent", resend_id: body.id ?? null, sent_at: new Date().toISOString(), last_error: null })
        .eq("id", invite.id);
      return "sent";
    }
    console.error(JSON.stringify({ fn: "therapist-invite", inviteId: invite.id, result: "failed", httpStatus: result.status }));
    await admin.from("therapist_application_invites")
      .update({ status: "failed", last_error: `http_${result.status}` }).eq("id", invite.id);
    return "failed";
  } catch (error) {
    console.error(JSON.stringify({
      fn: "therapist-invite", inviteId: invite.id, result: "failed",
      reason: error instanceof Error ? error.name : "unknown",
    }));
    await admin.from("therapist_application_invites")
      .update({ status: "failed", last_error: "send_exception" }).eq("id", invite.id);
    return "failed";
  }
}
