import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting for SMS - 2 seconds between messages
const SMS_DELAY_MS = 2000;
// Email delay - shorter since HelpScout handles rate limiting
const EMAIL_DELAY_MS = 200;

// RingCentral and HelpScout API interfaces
interface RingCentralTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface HelpScoutTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface StepLogToProcess {
  id: string;
  enrollment_id: string;
  step_id: string;
  tenant_id: string;
  client_id: string;
  scheduled_for: string;
  channel: 'email' | 'sms';
}

interface CampaignStep {
  id: string;
  campaign_id: string;
  step_order: number;
  delay_days: number;
  delay_hours: number;
  channel: 'email' | 'sms';
  email_subject: string | null;
  email_body_html: string | null;
  sms_body_text: string | null;
  is_active: boolean;
}

interface CampaignEnrollment {
  id: string;
  campaign_id: string;
  client_id: string;
  current_step: number;
  status: string;
}

interface Campaign {
  id: string;
  name: string;
  is_active: boolean;
  weekdays_only: boolean;
  send_window_start: string;
  send_window_end: string;
  default_timezone: string;
}

interface ClientData {
  id: string;
  email: string | null;
  phone: string | null;
  pat_name_f: string | null;
  pat_name_l: string | null;
  pat_name_preferred: string | null;
  pat_time_zone: string | null;
  primary_staff: {
    prov_name_f: string | null;
    prov_name_l: string | null;
    prov_name_for_clients: string | null;
  } | null;
}

// ============ PERSONALIZATION ============

function personalizeContent(content: string, client: ClientData): string {
  const firstName = client.pat_name_preferred || client.pat_name_f || 'there';
  
  let therapistName = 'your therapist';
  if (client.primary_staff) {
    if (client.primary_staff.prov_name_for_clients) {
      therapistName = client.primary_staff.prov_name_for_clients;
    } else {
      const parts = [client.primary_staff.prov_name_f, client.primary_staff.prov_name_l].filter(Boolean);
      if (parts.length > 0) {
        therapistName = parts.join(' ');
      }
    }
  }

  return content
    .replace(/\{\{first_name\}\}/gi, firstName)
    .replace(/\{\{therapist_name\}\}/gi, therapistName);
}

// ============ PHONE NORMALIZATION ============

function normalizePhoneNumber(phone: string | null): { valid: boolean; normalized: string | null } {
  if (!phone) return { valid: false, normalized: null };

  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) {
    digits = digits.substring(1);
  }

  if (digits.length !== 10) {
    return { valid: false, normalized: null };
  }

  return { valid: true, normalized: `+1${digits}` };
}

// ============ TIMEZONE HELPERS ============

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // 0 = Sunday, 6 = Saturday
}

function parseTimeString(timeStr: string): { hour: number; minute: number } {
  const [hourStr, minuteStr] = timeStr.split(':');
  return {
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
  };
}

function isWithinSendWindow(
  clientTimezone: string,
  windowStart: string,
  windowEnd: string
): boolean {
  try {
    // Get current time in client's timezone
    const now = new Date();
    const clientTimeStr = now.toLocaleTimeString('en-US', {
      timeZone: clientTimezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    
    const [currentHour, currentMinute] = clientTimeStr.split(':').map(Number);
    const currentMinutes = currentHour * 60 + currentMinute;
    
    const start = parseTimeString(windowStart);
    const end = parseTimeString(windowEnd);
    const startMinutes = start.hour * 60 + start.minute;
    const endMinutes = end.hour * 60 + end.minute;
    
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch (error) {
    console.error('Error checking send window:', error);
    return true; // Default to allowing send on error
  }
}

function isValidSendTime(
  clientTimezone: string,
  campaign: Campaign
): boolean {
  try {
    const now = new Date();
    
    // Get the date in client's timezone
    const clientDateStr = now.toLocaleDateString('en-US', {
      timeZone: clientTimezone,
      weekday: 'short',
    });
    
    // Check weekday constraint
    if (campaign.weekdays_only) {
      const dayAbbr = clientDateStr.substring(0, 3);
      if (dayAbbr === 'Sat' || dayAbbr === 'Sun') {
        console.log(`Skipping: ${clientTimezone} is weekend (${dayAbbr})`);
        return false;
      }
    }
    
    // Check send window
    if (!isWithinSendWindow(clientTimezone, campaign.send_window_start, campaign.send_window_end)) {
      console.log(`Skipping: ${clientTimezone} outside send window`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error checking valid send time:', error);
    return true; // Default to allowing send on error
  }
}

// ============ RINGCENTRAL SMS ============

async function getRingCentralAccessToken(): Promise<string> {
  const clientId = Deno.env.get('RINGCENTRAL_CLIENT_ID');
  const clientSecret = Deno.env.get('RINGCENTRAL_CLIENT_SECRET');
  const jwtToken = Deno.env.get('RINGCENTRAL_JWT_TOKEN');
  const serverUrl = Deno.env.get('RINGCENTRAL_SERVER_URL') || 'https://platform.ringcentral.com';

  if (!clientId || !clientSecret || !jwtToken) {
    throw new Error('Missing RingCentral credentials');
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(`${serverUrl}/restapi/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'assertion': jwtToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('RingCentral auth failed:', response.status, errorText);
    throw new Error(`RingCentral authentication failed: ${response.status}`);
  }

  const data: RingCentralTokenResponse = await response.json();
  return data.access_token;
}

async function sendSms(
  accessToken: string,
  toPhone: string,
  messageText: string
): Promise<{ success: boolean; error?: string }> {
  const serverUrl = Deno.env.get('RINGCENTRAL_SERVER_URL') || 'https://platform.ringcentral.com';
  const fromNumber = Deno.env.get('RINGCENTRAL_FROM_NUMBER');

  if (!fromNumber) {
    return { success: false, error: 'Missing sender phone number configuration' };
  }

  try {
    const response = await fetch(`${serverUrl}/restapi/v1.0/account/~/extension/~/sms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { phoneNumber: fromNumber },
        to: [{ phoneNumber: toPhone }],
        text: messageText,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('RingCentral SMS failed:', response.status, errorText);
      return { success: false, error: `RingCentral error: ${response.status}` };
    }

    await response.text(); // Consume response body
    return { success: true };
  } catch (error) {
    console.error('SMS send error:', error);
    return { success: false, error: `Request failed: ${error.message}` };
  }
}

// ============ HELPSCOUT EMAIL ============

async function getHelpScoutAccessToken(): Promise<string> {
  const appId = Deno.env.get('HELPSCOUT_APP_ID');
  const appSecret = Deno.env.get('HELPSCOUT_APP_SECRET');

  if (!appId || !appSecret) {
    throw new Error('HelpScout credentials not configured');
  }

  const response = await fetch('https://api.helpscout.net/v2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('HelpScout token error:', error);
    throw new Error(`Failed to get HelpScout token: ${response.status}`);
  }

  const data: HelpScoutTokenResponse = await response.json();
  return data.access_token;
}

async function sendEmail(
  accessToken: string,
  mailboxId: string,
  toEmail: string,
  subject: string,
  bodyHtml: string,
  firstName: string,
  lastName: string
): Promise<{ success: boolean; conversationId?: string; error?: string }> {
  try {
    // Create conversation with a "message" thread (staff-initiated outbound email)
    // This sends the email directly without creating a fake customer message to reply to
    const createResponse = await fetch('https://api.helpscout.net/v2/conversations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject,
        customer: {
          email: toEmail,
          firstName,
          lastName,
        },
        mailboxId: parseInt(mailboxId),
        type: 'email',
        status: 'active',
        threads: [
          {
            type: 'message',
            customer: { email: toEmail },
            text: bodyHtml,
          },
        ],
      }),
    });

    if (!createResponse.ok && createResponse.status !== 201) {
      const errorText = await createResponse.text();
      console.error('HelpScout create conversation failed:', createResponse.status, errorText);
      return { success: false, error: `Create conversation failed: ${createResponse.status}` };
    }

    // Extract conversation ID from Location header
    const locationHeader = createResponse.headers.get('Location') || createResponse.headers.get('Resource-ID');
    const conversationId = locationHeader?.split('/').pop();

    if (!conversationId) {
      console.warn('No conversation ID returned from HelpScout, but email was sent');
    }

    await createResponse.text(); // Consume response body
    return { success: true, conversationId };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: `Request failed: ${error.message}` };
  }
}

// ============ STEP SCHEDULING ============

function calculateNextScheduledTime(
  delayDays: number,
  delayHours: number,
  fromTime: Date = new Date()
): Date {
  const nextTime = new Date(fromTime);
  nextTime.setDate(nextTime.getDate() + delayDays);
  nextTime.setHours(nextTime.getHours() + delayHours);
  return nextTime;
}

// ============ MAIN PROCESSING ============

async function processCampaignMessages() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const mailboxId = Deno.env.get('HELPSCOUT_MAILBOX_ID');

  console.log('Campaign scheduler starting...');

  // Query step logs that are scheduled to send now or earlier
  const { data: pendingStepLogs, error: stepLogsError } = await supabase
    .from('crm_campaign_step_logs')
    .select('id, enrollment_id, step_id, tenant_id, client_id, scheduled_for, channel')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(50); // Process in batches

  if (stepLogsError) {
    console.error('Failed to fetch pending step logs:', stepLogsError);
    return { processed: 0, errors: [stepLogsError.message] };
  }

  if (!pendingStepLogs || pendingStepLogs.length === 0) {
    console.log('No pending messages to process');
    return { processed: 0, errors: [] };
  }

  console.log(`Processing ${pendingStepLogs.length} pending messages`);

  // Get tokens once for batch processing
  let ringCentralToken: string | null = null;
  let helpScoutToken: string | null = null;

  const errors: string[] = [];
  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const stepLog of pendingStepLogs as StepLogToProcess[]) {
    try {
      console.log(`Processing step log: ${stepLog.id}`);

      // Fetch enrollment with campaign info
      const { data: enrollment, error: enrollmentError } = await supabase
        .from('crm_campaign_enrollments')
        .select(`
          id, campaign_id, client_id, current_step, status,
          campaign:crm_campaigns (
            id, name, is_active, weekdays_only, 
            send_window_start, send_window_end, default_timezone
          )
        `)
        .eq('id', stepLog.enrollment_id)
        .single();

      if (enrollmentError || !enrollment) {
        console.error(`Enrollment not found for step log ${stepLog.id}`);
        await supabase
          .from('crm_campaign_step_logs')
          .update({ status: 'skipped', skip_reason: 'enrollment_not_found' })
          .eq('id', stepLog.id);
        skipped++;
        continue;
      }

      // Check enrollment is still active
      if (enrollment.status !== 'active') {
        console.log(`Enrollment ${enrollment.id} is ${enrollment.status}, skipping`);
        await supabase
          .from('crm_campaign_step_logs')
          .update({ status: 'skipped', skip_reason: `enrollment_${enrollment.status}` })
          .eq('id', stepLog.id);
        skipped++;
        continue;
      }

      const campaign = enrollment.campaign as unknown as Campaign;
      if (!campaign || !campaign.is_active) {
        console.log(`Campaign is inactive, skipping`);
        await supabase
          .from('crm_campaign_step_logs')
          .update({ status: 'skipped', skip_reason: 'campaign_inactive' })
          .eq('id', stepLog.id);
        skipped++;
        continue;
      }

      // Fetch client data
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select(`
          id, email, phone, pat_name_f, pat_name_l, pat_name_preferred, pat_time_zone,
          primary_staff:staff!clients_primary_staff_id_fkey (
            prov_name_f, prov_name_l, prov_name_for_clients
          )
        `)
        .eq('id', stepLog.client_id)
        .single();

      if (clientError || !client) {
        console.error(`Client not found for step log ${stepLog.id}`);
        await supabase
          .from('crm_campaign_step_logs')
          .update({ status: 'skipped', skip_reason: 'client_not_found' })
          .eq('id', stepLog.id);
        skipped++;
        continue;
      }

      // Determine timezone (client's or campaign default)
      const clientTimezone = client.pat_time_zone || campaign.default_timezone || 'America/Chicago';

      // Check if valid send time (weekday + window)
      if (!isValidSendTime(clientTimezone, campaign)) {
        // Reschedule for next valid window (next run will try again)
        console.log(`Not within valid send time for ${client.id}, will retry on next run`);
        continue; // Leave as scheduled, next cron run will check again
      }

      // Fetch step details
      const { data: step, error: stepError } = await supabase
        .from('crm_campaign_steps')
        .select('*')
        .eq('id', stepLog.step_id)
        .single();

      if (stepError || !step) {
        console.error(`Step not found for step log ${stepLog.id}`);
        await supabase
          .from('crm_campaign_step_logs')
          .update({ status: 'skipped', skip_reason: 'step_not_found' })
          .eq('id', stepLog.id);
        skipped++;
        continue;
      }

      const typedStep = step as CampaignStep;
      const typedClient = client as unknown as ClientData;

      // Check if step is active
      if (!typedStep.is_active) {
        console.log(`Step ${typedStep.id} is disabled, skipping`);
        await supabase
          .from('crm_campaign_step_logs')
          .update({ status: 'skipped', skip_reason: 'step_disabled' })
          .eq('id', stepLog.id);
        skipped++;
        
      // Still schedule next step
      await scheduleNextStep(supabase, enrollment as unknown as CampaignEnrollment, typedStep, campaign, stepLog.tenant_id);
        continue;
      }

      // Check contact info for channel
      if (stepLog.channel === 'email' && !typedClient.email) {
        console.log(`Client ${typedClient.id} has no email, skipping email step`);
        await supabase
          .from('crm_campaign_step_logs')
          .update({ status: 'skipped', skip_reason: 'missing_email' })
          .eq('id', stepLog.id);
        skipped++;
        
        // Still schedule next step
        await scheduleNextStep(supabase, enrollment as unknown as CampaignEnrollment, typedStep, campaign, stepLog.tenant_id);
        continue;
      }

      if (stepLog.channel === 'sms') {
        const phoneResult = normalizePhoneNumber(typedClient.phone);
        if (!phoneResult.valid) {
          console.log(`Client ${typedClient.id} has no valid phone, skipping SMS step`);
          await supabase
            .from('crm_campaign_step_logs')
            .update({ status: 'skipped', skip_reason: 'missing_phone' })
            .eq('id', stepLog.id);
          skipped++;
          
          // Still schedule next step
          await scheduleNextStep(supabase, enrollment as unknown as CampaignEnrollment, typedStep, campaign, stepLog.tenant_id);
          continue;
        }
      }

      // Send the message!
      if (stepLog.channel === 'email') {
        // Get HelpScout token if not already
        if (!helpScoutToken) {
          try {
            helpScoutToken = await getHelpScoutAccessToken();
          } catch (error) {
            console.error('Failed to get HelpScout token:', error);
            errors.push(`HelpScout auth failed: ${error.message}`);
            continue;
          }
        }

        if (!mailboxId) {
          console.error('HELPSCOUT_MAILBOX_ID not configured');
          await supabase
            .from('crm_campaign_step_logs')
            .update({ status: 'failed', error_message: 'Mailbox not configured' })
            .eq('id', stepLog.id);
          failed++;
          continue;
        }

        const subject = personalizeContent(typedStep.email_subject || 'Message from your care team', typedClient);
        const body = personalizeContent(typedStep.email_body_html || '', typedClient);
        const firstName = typedClient.pat_name_preferred || typedClient.pat_name_f || '';
        const lastName = typedClient.pat_name_l || '';

        const result = await sendEmail(
          helpScoutToken,
          mailboxId,
          typedClient.email!,
          subject,
          body,
          firstName,
          lastName
        );

        if (result.success) {
          console.log(`Email sent to ${typedClient.email}`);
          await supabase
            .from('crm_campaign_step_logs')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              helpscout_conversation_id: result.conversationId,
            })
            .eq('id', stepLog.id);
          sent++;
        } else {
          console.error(`Failed to send email: ${result.error}`);
          await supabase
            .from('crm_campaign_step_logs')
            .update({ status: 'failed', error_message: result.error })
            .eq('id', stepLog.id);
          failed++;
        }

        await new Promise(resolve => setTimeout(resolve, EMAIL_DELAY_MS));
      } else if (stepLog.channel === 'sms') {
        // Get RingCentral token if not already
        if (!ringCentralToken) {
          try {
            ringCentralToken = await getRingCentralAccessToken();
          } catch (error) {
            console.error('Failed to get RingCentral token:', error);
            errors.push(`RingCentral auth failed: ${error.message}`);
            continue;
          }
        }

        const phoneResult = normalizePhoneNumber(typedClient.phone);
        const messageText = personalizeContent(typedStep.sms_body_text || '', typedClient);

        const result = await sendSms(ringCentralToken, phoneResult.normalized!, messageText);

        if (result.success) {
          console.log(`SMS sent to ${typedClient.phone}`);
          await supabase
            .from('crm_campaign_step_logs')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', stepLog.id);
          sent++;
        } else {
          console.error(`Failed to send SMS: ${result.error}`);
          await supabase
            .from('crm_campaign_step_logs')
            .update({ status: 'failed', error_message: result.error })
            .eq('id', stepLog.id);
          failed++;
        }

        await new Promise(resolve => setTimeout(resolve, SMS_DELAY_MS));
      }

      // Schedule next step
      await scheduleNextStep(supabase, enrollment as unknown as CampaignEnrollment, typedStep, campaign, stepLog.tenant_id);
      processed++;
    } catch (error) {
      console.error(`Error processing step log ${stepLog.id}:`, error);
      errors.push(`Step ${stepLog.id}: ${error.message}`);
      
      await supabase
        .from('crm_campaign_step_logs')
        .update({ status: 'failed', error_message: error.message })
        .eq('id', stepLog.id);
      failed++;
    }
  }

  console.log(`Campaign scheduler complete: ${processed} processed, ${sent} sent, ${skipped} skipped, ${failed} failed`);
  return { processed, sent, skipped, failed, errors };
}

async function scheduleNextStep(
  supabase: ReturnType<typeof createClient>,
  enrollment: CampaignEnrollment,
  currentStep: CampaignStep,
  campaign: Campaign,
  tenantId: string
) {
  // Get all steps for this campaign
  const { data: steps, error: stepsError } = await supabase
    .from('crm_campaign_steps')
    .select('*')
    .eq('campaign_id', enrollment.campaign_id)
    .eq('is_active', true)
    .order('step_order', { ascending: true });

  if (stepsError || !steps) {
    console.error('Failed to fetch campaign steps:', stepsError);
    return;
  }

  // Find next step
  const currentIndex = steps.findIndex((s: CampaignStep) => s.id === currentStep.id);
  const nextStep = steps[currentIndex + 1] as CampaignStep | undefined;

  if (!nextStep) {
    // No more steps - mark enrollment as completed
    console.log(`Enrollment ${enrollment.id} completed all steps`);
    await supabase
      .from('crm_campaign_enrollments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_step: currentStep.step_order,
      })
      .eq('id', enrollment.id);
    return;
  }

  // Calculate next scheduled time
  const nextScheduledFor = calculateNextScheduledTime(nextStep.delay_days, nextStep.delay_hours);

  // Create step log for next step
  const { error: insertError } = await supabase
    .from('crm_campaign_step_logs')
    .insert({
      enrollment_id: enrollment.id,
      step_id: nextStep.id,
      tenant_id: tenantId,
      client_id: enrollment.client_id,
      scheduled_for: nextScheduledFor.toISOString(),
      status: 'scheduled',
      channel: nextStep.channel,
    });

  if (insertError) {
    console.error('Failed to schedule next step:', insertError);
    return;
  }

  // Update enrollment current step
  await supabase
    .from('crm_campaign_enrollments')
    .update({ current_step: nextStep.step_order })
    .eq('id', enrollment.id);

  console.log(`Scheduled next step ${nextStep.step_order} for enrollment ${enrollment.id} at ${nextScheduledFor.toISOString()}`);
}

// ============ HTTP HANDLER ============

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('Campaign scheduler triggered');

    // This is a cron job - no auth required, but we should validate it's coming from cron
    // For now, we'll allow any request but log it
    const url = new URL(req.url);
    const isCron = url.searchParams.get('source') === 'cron' || 
                   req.headers.get('user-agent')?.includes('Supabase');

    if (!isCron) {
      console.log('Request may not be from cron, processing anyway');
    }

    const result = await processCampaignMessages();

    return new Response(
      JSON.stringify({ 
        success: true, 
        ...result,
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Campaign scheduler error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
