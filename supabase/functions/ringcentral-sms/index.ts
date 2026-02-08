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

// ============ INBOUND SMS WEBHOOK HANDLER ============
// Handles incoming SMS messages from RingCentral to auto-pause campaigns
// and log them to crm_inbound_sms_logs for visibility in the Communications UI

async function handleInboundSms(req: Request): Promise<Response> {
  // Check for RingCentral webhook validation request FIRST (before parsing JSON)
  const validationToken = req.headers.get('Validation-Token');
  
  if (validationToken) {
    console.log('RingCentral webhook validation - echoing token');
    return new Response('', {
      status: 200,
      headers: { 
        ...corsHeaders, 
        'Validation-Token': validationToken 
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const payload = await req.json();
    console.log('RingCentral inbound SMS webhook:', JSON.stringify(payload).substring(0, 500));

    // RingCentral webhook validation request
    if (payload.event === '/restapi/v1.0/subscription/~?threshold=60&interval=15') {
      // This is a subscription validation request
      console.log('RingCentral subscription validation');
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract SMS details from the webhook payload
    // RingCentral webhook structure for SMS varies
    const fromNumber = 
      payload.body?.from?.phoneNumber ||
      payload.from?.phoneNumber ||
      payload.body?.message?.from?.phoneNumber ||
      payload.message?.from?.phoneNumber;

    const toNumber = 
      payload.body?.to?.[0]?.phoneNumber ||
      payload.to?.[0]?.phoneNumber ||
      payload.body?.message?.to?.[0]?.phoneNumber ||
      payload.message?.to?.[0]?.phoneNumber ||
      Deno.env.get('RINGCENTRAL_FROM_NUMBER');

    const messageBody = 
      payload.body?.subject ||
      payload.subject ||
      payload.body?.message?.subject ||
      payload.message?.subject ||
      null;

    const messageId = 
      payload.body?.id?.toString() ||
      payload.id?.toString() ||
      payload.body?.message?.id?.toString() ||
      payload.message?.id?.toString() ||
      null;

    if (!fromNumber) {
      console.log('No from phone number in webhook payload');
      return new Response(JSON.stringify({ received: true, noPhone: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize the incoming phone number
    const phoneResult = normalizePhoneNumber(fromNumber);
    if (!phoneResult.valid) {
      console.log(`Invalid phone format: ${fromNumber}`);
      return new Response(JSON.stringify({ received: true, invalidPhone: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing SMS response from: ${phoneResult.normalized}`);

    // Look up client by phone - need to search for various formats
    // The phone in DB might be stored differently (with dashes, spaces, etc.)
    const normalizedDigits = phoneResult.normalized!.replace(/\D/g, '');
    const last10Digits = normalizedDigits.slice(-10);
    
    // Search for clients with matching phone (flexible matching)
    const { data: clients, error: clientError } = await supabase
      .from('clients')
      .select('id, tenant_id, phone')
      .not('phone', 'is', null);

    if (clientError) {
      console.error('Error looking up clients:', clientError);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find matching clients by comparing normalized phone numbers
    const matchingClients = (clients || []).filter(client => {
      if (!client.phone) return false;
      const clientDigits = client.phone.replace(/\D/g, '');
      const clientLast10 = clientDigits.slice(-10);
      return clientLast10 === last10Digits;
    });

    // Log the inbound SMS to the database for visibility in Communications UI
    // ALWAYS log, even if no client match (for audit trail and manual association later)
    let loggedSmsId: string | null = null;
    const matchedClient = matchingClients.length > 0 ? matchingClients[0] : null;

    // Determine tenant_id: use matched client's tenant, or fall back to default
    const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
    const tenantIdForLog = matchedClient?.tenant_id || DEFAULT_TENANT_ID;

    const { data: insertedLog, error: logError } = await supabase
      .from('crm_inbound_sms_logs')
      .insert({
        tenant_id: tenantIdForLog,
        client_id: matchedClient?.id || null,
        from_phone: phoneResult.normalized!,
        to_phone: toNumber || '',
        message_body: messageBody,
        ringcentral_message_id: messageId,
        received_at: new Date().toISOString(),
        is_read: false,
      })
      .select('id')
      .single();

    if (logError) {
      // Don't fail the webhook, just log the error
      console.error('Failed to log inbound SMS:', logError);
    } else {
      loggedSmsId = insertedLog?.id || null;
      console.log(`Logged inbound SMS with id: ${loggedSmsId}, client_id: ${matchedClient?.id || 'null'}`);
    }

    // Check for active campaign enrollments for any matching client
    let pausedCount = 0;
    for (const client of matchingClients) {
      const { data: enrollments, error: enrollmentError } = await supabase
        .from('crm_campaign_enrollments')
        .select('id, campaign_id')
        .eq('client_id', client.id)
        .eq('status', 'active');

      if (enrollmentError) {
        console.error('Error checking enrollments:', enrollmentError);
        continue;
      }

      if (!enrollments || enrollments.length === 0) {
        continue;
      }

      // Pause the enrollment(s)
      for (const enrollment of enrollments) {
        const { error: updateError } = await supabase
          .from('crm_campaign_enrollments')
          .update({
            status: 'responded',
            paused_at: new Date().toISOString(),
            pause_reason: 'sms_response',
          })
          .eq('id', enrollment.id);

        if (updateError) {
          console.error(`Failed to pause enrollment ${enrollment.id}:`, updateError);
        } else {
          console.log(`Paused enrollment ${enrollment.id} due to SMS response`);
          pausedCount++;
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        received: true, 
        enrollmentsPaused: pausedCount,
        logged: !!loggedSmsId,
        clientFound: matchingClients.length > 0,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Inbound SMS processing error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
}

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Parse URL to check for inbound action
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // Handle inbound SMS webhook (no auth required)
  if (action === 'inbound') {
    console.log('Processing inbound SMS webhook');
    return handleInboundSms(req);
  }

  try {
    // Verify authentication for all other actions
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
