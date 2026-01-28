import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
} | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// HelpScout API base URL
const HELPSCOUT_API_BASE = "https://api.helpscout.net/v2";

interface HelpScoutTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// Get HelpScout access token using client credentials
async function getAccessToken(): Promise<string> {
  const appId = Deno.env.get("HELPSCOUT_APP_ID");
  const appSecret = Deno.env.get("HELPSCOUT_APP_SECRET");

  if (!appId || !appSecret) {
    throw new Error("HelpScout credentials not configured");
  }

  const response = await fetch("https://api.helpscout.net/v2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("HelpScout token error:", error);
    throw new Error(`Failed to get HelpScout token: ${response.status}`);
  }

  const data: HelpScoutTokenResponse = await response.json();
  return data.access_token;
}

// Make authenticated request to HelpScout API
async function helpscoutRequest(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<Response> {
  const token = await getAccessToken();

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${HELPSCOUT_API_BASE}${endpoint}`, options);
  return response;
}

// Handle bulk sending of emails
async function handleBulkSend(
  bulkSendId: string,
  supabase: SupabaseClient,
  mailboxId: string
): Promise<void> {
  console.log(`Starting bulk send for job: ${bulkSendId}`);

  try {
    // Fetch bulk send log
    const { data: bulkSendLog, error: logError } = await supabase
      .from("crm_bulk_send_logs")
      .select("*")
      .eq("id", bulkSendId)
      .single();

    if (logError || !bulkSendLog) {
      console.error("Failed to fetch bulk send log:", logError);
      return;
    }

    // Update status to 'sending'
    await supabase
      .from("crm_bulk_send_logs")
      .update({ status: "sending" })
      .eq("id", bulkSendId);

    // Fetch recipients with client email data
    const { data: recipients, error: recipientsError } = await supabase
      .from("crm_bulk_send_recipients")
      .select(`
        id,
        client_id,
        status,
        clients!inner (
          id,
          email,
          pat_name_f,
          pat_name_l
        )
      `)
      .eq("bulk_send_id", bulkSendId)
      .eq("status", "pending");

    if (recipientsError) {
      console.error("Failed to fetch recipients:", recipientsError);
      await supabase
        .from("crm_bulk_send_logs")
        .update({ status: "failed" })
        .eq("id", bulkSendId);
      return;
    }

    let sentCount = 0;
    let failedCount = 0;

    // Process each recipient
    for (const recipient of recipients || []) {
      // Supabase returns joined data - clients is the joined row
      const clientData = recipient.clients as unknown as {
        id: string;
        email: string | null;
        pat_name_f: string | null;
        pat_name_l: string | null;
      };
      const clientEmail = clientData?.email;
      const clientName = [clientData?.pat_name_f, clientData?.pat_name_l]
        .filter(Boolean)
        .join(" ");

      // Skip if no email
      if (!clientEmail) {
        console.log(`Skipping client ${recipient.client_id}: no email`);
        await supabase
          .from("crm_bulk_send_recipients")
          .update({
            status: "failed",
            error_message: "No email address",
            sent_at: new Date().toISOString(),
          })
          .eq("id", recipient.id);
        failedCount++;
        continue;
      }

      try {
        // Create HelpScout conversation
        const conversationBody = {
          subject: bulkSendLog.subject,
          customer: {
            email: clientEmail,
            firstName: clientData?.pat_name_f || "",
            lastName: clientData?.pat_name_l || "",
          },
          mailboxId: parseInt(mailboxId || "0"),
          type: "email",
          status: "active",
          threads: [
            {
              type: "reply",
              customer: {
                email: clientEmail,
              },
              text: bulkSendLog.body_html,
            },
          ],
        };

        const response = await helpscoutRequest(
          "POST",
          "/conversations",
          conversationBody
        );

        if (response.ok || response.status === 201) {
          console.log(`Email sent to ${clientEmail}`);
          await supabase
            .from("crm_bulk_send_recipients")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
            })
            .eq("id", recipient.id);
          sentCount++;
        } else {
          const errorText = await response.text();
          console.error(`Failed to send to ${clientEmail}:`, errorText);
          await supabase
            .from("crm_bulk_send_recipients")
            .update({
              status: "failed",
              error_message: `API error: ${response.status}`,
              sent_at: new Date().toISOString(),
            })
            .eq("id", recipient.id);
          failedCount++;
        }

        // Rate limiting: wait 150ms between requests
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (error) {
        console.error(`Error sending to ${clientEmail}:`, error);
        await supabase
          .from("crm_bulk_send_recipients")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown error",
            sent_at: new Date().toISOString(),
          })
          .eq("id", recipient.id);
        failedCount++;
      }
    }

    // Update final counts and status
    const finalStatus = failedCount === (recipients?.length || 0) ? "failed" : "completed";
    await supabase
      .from("crm_bulk_send_logs")
      .update({
        status: finalStatus,
        sent_count: sentCount,
        failed_count: failedCount,
        completed_at: new Date().toISOString(),
      })
      .eq("id", bulkSendId);

    console.log(`Bulk send complete: ${sentCount} sent, ${failedCount} failed`);
  } catch (error) {
    console.error("Bulk send error:", error);
    await supabase
      .from("crm_bulk_send_logs")
      .update({ status: "failed" })
      .eq("id", bulkSendId);
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims(token);

    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;
    console.log("Authenticated user:", userId);

    // Parse request
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const mailboxId = Deno.env.get("HELPSCOUT_MAILBOX_ID");

    let result: unknown;

    switch (action) {
      case "list-conversations": {
        const status = url.searchParams.get("status") || "all";
        const direction = url.searchParams.get("direction") || "all";
        const page = url.searchParams.get("page") || "1";
        
        // Get user's tenant_id
        const { data: membership, error: membershipError } = await supabase
          .from("tenant_memberships")
          .select("tenant_id")
          .eq("profile_id", userId)
          .maybeSingle();
        
        if (membershipError || !membership) {
          console.error("Membership lookup error:", membershipError);
          throw new Error("Could not determine tenant");
        }
        
        let endpoint = `/conversations?mailbox=${mailboxId}&page=${page}`;
        if (status !== "all") {
          endpoint += `&status=${status}`;
        }
        
        const response = await helpscoutRequest("GET", endpoint);
        if (!response.ok) {
          const error = await response.text();
          console.error("HelpScout list error:", error);
          throw new Error(`HelpScout API error: ${response.status}`);
        }
        
        const hsData = await response.json();
        const conversations = hsData._embedded?.conversations || [];
        
        // Extract all customer emails from conversations
        const customerEmails = conversations
          .map((c: { primaryCustomer?: { email?: string } }) => c.primaryCustomer?.email?.toLowerCase())
          .filter(Boolean) as string[];
        
        if (customerEmails.length === 0) {
          result = {
            conversations: [],
            page: hsData.page || { size: 0, totalElements: 0, totalPages: 0, number: 1 },
          };
          break;
        }
        
        // Find matching clients in database (case-insensitive)
        const { data: clients, error: clientsError } = await supabase
          .from("clients")
          .select("id, email")
          .eq("tenant_id", membership.tenant_id)
          .in("email", customerEmails);
        
        if (clientsError) {
          console.error("Clients lookup error:", clientsError);
          throw new Error("Could not fetch clients");
        }
        
        // Create email -> client_id lookup (lowercase for case-insensitive matching)
        const emailToClientId = new Map<string, string>(
          (clients || []).map((c: { id: string; email: string }) => [c.email.toLowerCase(), c.id])
        );
        
        // Filter and enrich conversations
        interface HelpScoutConversationRaw {
          primaryCustomer?: { email?: string };
          source?: { via?: string };
        }
        
        let filteredConversations = conversations
          .filter((c: HelpScoutConversationRaw) => {
            const email = c.primaryCustomer?.email?.toLowerCase();
            return email && emailToClientId.has(email);
          })
          .map((c: HelpScoutConversationRaw) => ({
            ...c,
            client_id: emailToClientId.get(c.primaryCustomer?.email?.toLowerCase() || ""),
          }));
        
        // Apply direction filter based on source.via
        // "customer" = received from client, "user" = sent by staff
        if (direction === "received") {
          filteredConversations = filteredConversations.filter(
            (c: { source?: { via?: string } }) => c.source?.via !== "user"
          );
        } else if (direction === "sent") {
          filteredConversations = filteredConversations.filter(
            (c: { source?: { via?: string } }) => c.source?.via === "user"
          );
        }
        
        result = {
          conversations: filteredConversations,
          page: hsData.page || { size: 0, totalElements: 0, totalPages: 0, number: 1 },
        };
        break;
      }

      case "get-conversation": {
        const conversationId = url.searchParams.get("id");
        if (!conversationId) {
          return new Response(
            JSON.stringify({ error: "Conversation ID required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const response = await helpscoutRequest(
          "GET",
          `/conversations/${conversationId}?embed=threads`
        );
        if (!response.ok) {
          const error = await response.text();
          console.error("HelpScout get error:", error);
          throw new Error(`HelpScout API error: ${response.status}`);
        }
        result = await response.json();
        break;
      }

      case "reply": {
        const conversationId = url.searchParams.get("id");
        if (!conversationId) {
          return new Response(
            JSON.stringify({ error: "Conversation ID required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const body = await req.json();
        const { text, status } = body;

        if (!text) {
          return new Response(JSON.stringify({ error: "Text is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const replyBody = {
          text,
          status: status || "active",
        };

        const response = await helpscoutRequest(
          "POST",
          `/conversations/${conversationId}/reply`,
          replyBody
        );

        if (!response.ok && response.status !== 201) {
          const error = await response.text();
          console.error("HelpScout reply error:", error);
          throw new Error(`HelpScout API error: ${response.status}`);
        }

        result = { success: true, conversationId };
        break;
      }

      case "create-conversation": {
        const body = await req.json();
        const { subject, customerEmail, customerName, text } = body;

        if (!subject || !customerEmail || !text) {
          return new Response(
            JSON.stringify({
              error: "Subject, customerEmail, and text are required",
            }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const conversationBody = {
          subject,
          customer: {
            email: customerEmail,
            firstName: customerName?.split(" ")[0] || "",
            lastName: customerName?.split(" ").slice(1).join(" ") || "",
          },
          mailboxId: parseInt(mailboxId || "0"),
          type: "email",
          status: "active",
          threads: [
            {
              type: "customer",
              customer: {
                email: customerEmail,
              },
              text,
            },
          ],
        };

        const response = await helpscoutRequest(
          "POST",
          "/conversations",
          conversationBody
        );

        if (!response.ok && response.status !== 201) {
          const error = await response.text();
          console.error("HelpScout create error:", error);
          throw new Error(`HelpScout API error: ${response.status}`);
        }

        // Get the conversation ID from the Location header
        const location = response.headers.get("Location");
        const newConversationId = location?.split("/").pop();

        result = { success: true, conversationId: newConversationId };
        break;
      }

      case "search-customers": {
        const email = url.searchParams.get("email");
        if (!email) {
          return new Response(JSON.stringify({ error: "Email is required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const response = await helpscoutRequest(
          "GET",
          `/customers?email=${encodeURIComponent(email)}`
        );
        if (!response.ok) {
          const error = await response.text();
          console.error("HelpScout search error:", error);
          throw new Error(`HelpScout API error: ${response.status}`);
        }
        result = await response.json();
        break;
      }

      case "bulk-send": {
        const bulkSendId = url.searchParams.get("bulkSendId");
        if (!bulkSendId) {
          return new Response(
            JSON.stringify({ error: "bulkSendId is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Use background task for bulk sending
        const bulkSendPromise = handleBulkSend(bulkSendId, supabase, mailboxId || "");
        
        // Use EdgeRuntime.waitUntil if available (Supabase edge functions)
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
          EdgeRuntime.waitUntil(bulkSendPromise);
          result = { started: true, bulkSendId };
        } else {
          // Fallback: wait for completion (less ideal but works)
          await bulkSendPromise;
          result = { completed: true, bulkSendId };
        }
        break;
      }

      case "test-connection": {
        // Simple test to verify credentials work
        const response = await helpscoutRequest("GET", `/mailboxes/${mailboxId}`);
        if (!response.ok) {
          throw new Error("Connection test failed");
        }
        const mailbox = await response.json();
        result = {
          connected: true,
          mailboxName: mailbox.name,
          mailboxEmail: mailbox.email,
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("HelpScout proxy error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
