import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Rate limiting config - 2 seconds between messages (30/min, well under 40/min limit)
const MESSAGE_DELAY_MS = 2000;
const RATE_LIMIT_RETRY_DELAY_MS = 30000; // 30 second cooldown on 429

interface RingCentralTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SMSRecipient {
  id: string;
  phone: string | null;
  name: string;
}

// Normalize phone number to E.164 format (+1XXXXXXXXXX)
function normalizePhoneNumber(phone: string | null): { valid: boolean; normalized: string | null; error?: string } {
  if (!phone) {
    return { valid: false, normalized: null, error: 'No phone number' };
  }

  // Strip all non-numeric characters
  let digits = phone.replace(/\D/g, '');

  // If starts with 1 and has 11 digits, remove leading 1
  if (digits.startsWith('1') && digits.length === 11) {
    digits = digits.substring(1);
  }

  // Must have exactly 10 digits for US number
  if (digits.length !== 10) {
    return { valid: false, normalized: null, error: `Invalid phone format: ${phone}` };
  }

  // Prepend +1 for E.164 format
  return { valid: true, normalized: `+1${digits}` };
}

// Exchange JWT for access token
async function getAccessToken(): Promise<string> {
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

// Send SMS via RingCentral API
async function sendSms(
  accessToken: string,
  toPhone: string,
  messageText: string
): Promise<{ success: boolean; error?: string; rateLimited?: boolean }> {
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

    if (response.status === 429) {
      console.warn('Rate limited by RingCentral');
      return { success: false, error: 'Rate limited', rateLimited: true };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('RingCentral SMS failed:', response.status, errorText);
      return { success: false, error: `RingCentral error: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('SMS send error:', error);
    return { success: false, error: `Request failed: ${error.message}` };
  }
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main processing function (runs in background)
async function processBulkSms(bulkSmsId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log(`Starting bulk SMS processing for: ${bulkSmsId}`);

  // Get the bulk SMS log
  const { data: smsLog, error: logError } = await supabase
    .from('crm_bulk_sms_logs')
    .select('*')
    .eq('id', bulkSmsId)
    .single();

  if (logError || !smsLog) {
    console.error('Failed to fetch SMS log:', logError);
    return;
  }

  // Update status to sending
  await supabase
    .from('crm_bulk_sms_logs')
    .update({ status: 'sending' })
    .eq('id', bulkSmsId);

  // Get RingCentral access token
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
    console.log('Successfully obtained RingCentral access token');
  } catch (error) {
    console.error('Failed to get access token:', error);
    await supabase
      .from('crm_bulk_sms_logs')
      .update({ 
        status: 'failed', 
        completed_at: new Date().toISOString() 
      })
      .eq('id', bulkSmsId);
    return;
  }

  // Fetch recipients based on type
  let recipients: SMSRecipient[] = [];
  
  if (smsLog.recipient_type === 'staff') {
    // Fetch staff recipients with phone numbers
    const { data: staffRecipients, error: staffError } = await supabase
      .from('crm_bulk_sms_staff_recipients')
      .select(`
        id,
        staff:staff_id (
          id,
          prov_phone,
          prov_name_f,
          prov_name_l
        )
      `)
      .eq('bulk_sms_id', bulkSmsId)
      .eq('status', 'pending');

    if (staffError) {
      console.error('Failed to fetch staff recipients:', staffError);
    } else {
      recipients = (staffRecipients || []).map(r => ({
        id: r.id,
        phone: (r.staff as any)?.prov_phone || null,
        name: `${(r.staff as any)?.prov_name_f || ''} ${(r.staff as any)?.prov_name_l || ''}`.trim() || 'Unknown',
      }));
    }
  } else {
    // Fetch client recipients with phone numbers
    const { data: clientRecipients, error: clientError } = await supabase
      .from('crm_bulk_sms_recipients')
      .select(`
        id,
        client:client_id (
          id,
          phone,
          pat_name_f,
          pat_name_l
        )
      `)
      .eq('bulk_sms_id', bulkSmsId)
      .eq('status', 'pending');

    if (clientError) {
      console.error('Failed to fetch client recipients:', clientError);
    } else {
      recipients = (clientRecipients || []).map(r => ({
        id: r.id,
        phone: (r.client as any)?.phone || null,
        name: `${(r.client as any)?.pat_name_f || ''} ${(r.client as any)?.pat_name_l || ''}`.trim() || 'Unknown',
      }));
    }
  }

  console.log(`Processing ${recipients.length} recipients`);

  const recipientTable = smsLog.recipient_type === 'staff' 
    ? 'crm_bulk_sms_staff_recipients' 
    : 'crm_bulk_sms_recipients';

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    console.log(`Processing recipient ${i + 1}/${recipients.length}: ${recipient.name}`);

    // Normalize phone number
    const phoneResult = normalizePhoneNumber(recipient.phone);

    if (!phoneResult.valid) {
      console.log(`Skipping ${recipient.name}: ${phoneResult.error}`);
      await supabase
        .from(recipientTable)
        .update({ 
          status: 'failed', 
          error_message: phoneResult.error 
        })
        .eq('id', recipient.id);
      failedCount++;
      continue;
    }

    // Send SMS
    let result = await sendSms(accessToken, phoneResult.normalized!, smsLog.body_text);

    // Handle rate limiting with retry
    if (result.rateLimited) {
      console.log(`Rate limited, waiting ${RATE_LIMIT_RETRY_DELAY_MS}ms before retry...`);
      await sleep(RATE_LIMIT_RETRY_DELAY_MS);
      result = await sendSms(accessToken, phoneResult.normalized!, smsLog.body_text);
    }

    if (result.success) {
      console.log(`SMS sent successfully to ${recipient.name}`);
      await supabase
        .from(recipientTable)
        .update({ 
          status: 'sent', 
          sent_at: new Date().toISOString() 
        })
        .eq('id', recipient.id);
      sentCount++;
    } else {
      console.error(`Failed to send to ${recipient.name}: ${result.error}`);
      await supabase
        .from(recipientTable)
        .update({ 
          status: 'failed', 
          error_message: result.error 
        })
        .eq('id', recipient.id);
      failedCount++;
    }

    // Update counts on log periodically
    if ((i + 1) % 5 === 0 || i === recipients.length - 1) {
      await supabase
        .from('crm_bulk_sms_logs')
        .update({ sent_count: sentCount, failed_count: failedCount })
        .eq('id', bulkSmsId);
    }

    // Wait before next message (rate limiting)
    if (i < recipients.length - 1) {
      await sleep(MESSAGE_DELAY_MS);
    }
  }

  // Final update
  const finalStatus = failedCount === recipients.length ? 'failed' : 'completed';
  await supabase
    .from('crm_bulk_sms_logs')
    .update({ 
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', bulkSmsId);

  console.log(`Bulk SMS completed: ${sentCount} sent, ${failedCount} failed`);
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claims?.claims) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { bulkSmsId } = await req.json();

    if (!bulkSmsId) {
      return new Response(
        JSON.stringify({ error: 'Missing bulkSmsId parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Received bulk SMS request for: ${bulkSmsId}`);

    // Start background processing
    EdgeRuntime.waitUntil(processBulkSms(bulkSmsId));

    // Return immediate response
    return new Response(
      JSON.stringify({ success: true, message: 'SMS processing started' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ringcentral-sms function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
