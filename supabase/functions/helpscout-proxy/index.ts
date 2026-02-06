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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function maskEmail(email: string) {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "(invalid-email)";

  const first = local[0] ?? "*";
  const last = local.length > 1 ? local[local.length - 1] : "*";
  return `${first}***${last}@${domain}`;
}

// Handle bulk sending of emails
async function handleBulkSend(
  bulkSendId: string,
  supabase: SupabaseClient,
  mailboxId: string
): Promise<void> {
  console.log(`Starting bulk send for job: ${bulkSendId}`);

  try {
    // Fetch bulk send log with recipient_type
    const { data: bulkSendLog, error: logError } = await supabase
      .from("crm_bulk_send_logs")
      .select("*, recipient_type")
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

    const recipientType = bulkSendLog.recipient_type || 'client';
    console.log(`Processing bulk send for recipient type: ${recipientType}`);

    // Fetch recipients based on type
    interface RecipientData {
      id: string;
      email: string | null;
      firstName: string;
      lastName: string;
      recipientTable: string;
    }

    let recipientsToProcess: RecipientData[] = [];

    if (recipientType === 'staff') {
      // Fetch staff recipients
      const { data: staffRecipients, error: staffRecipientsError } = await supabase
        .from("crm_bulk_send_staff_recipients")
        .select(`
          id,
          staff_id,
          status,
          staff!inner (
            id,
            prov_name_f,
            prov_name_l,
            profiles!inner (
              email
            )
          )
        `)
        .eq("bulk_send_id", bulkSendId)
        .eq("status", "pending");

      if (staffRecipientsError) {
        console.error("Failed to fetch staff recipients:", staffRecipientsError);
        await supabase
          .from("crm_bulk_send_logs")
          .update({ status: "failed" })
          .eq("id", bulkSendId);
        return;
      }

      recipientsToProcess = (staffRecipients || []).map(r => {
        const staffData = r.staff as unknown as {
          id: string;
          prov_name_f: string | null;
          prov_name_l: string | null;
          profiles: { email: string | null } | null;
        };
        return {
          id: r.id,
          email: staffData?.profiles?.email ?? null,
          firstName: staffData?.prov_name_f || '',
          lastName: staffData?.prov_name_l || '',
          recipientTable: 'crm_bulk_send_staff_recipients',
        };
      });
    } else {
      // Fetch client recipients (existing logic)
      const { data: clientRecipients, error: recipientsError } = await supabase
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

      recipientsToProcess = (clientRecipients || []).map(r => {
        const clientData = r.clients as unknown as {
          id: string;
          email: string | null;
          pat_name_f: string | null;
          pat_name_l: string | null;
        };
        return {
          id: r.id,
          email: clientData?.email ?? null,
          firstName: clientData?.pat_name_f || '',
          lastName: clientData?.pat_name_l || '',
          recipientTable: 'crm_bulk_send_recipients',
        };
      });
    }

    console.log(`Processing ${recipientsToProcess.length} recipients`);

    let sentCount = 0;
    let failedCount = 0;

    // Process each recipient
    for (const recipient of recipientsToProcess) {
      // Skip if no email
      if (!recipient.email) {
        console.log(`Skipping recipient ${recipient.id}: no email`);
        await supabase
          .from(recipient.recipientTable)
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
            email: recipient.email,
            firstName: recipient.firstName,
            lastName: recipient.lastName,
          },
          mailboxId: parseInt(mailboxId || "0"),
          type: "email",
          status: "active",
          threads: [
            {
              type: "reply",
              customer: {
                email: recipient.email,
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
          console.log(`Email sent to ${maskEmail(recipient.email)}`);
          await supabase
            .from(recipient.recipientTable)
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
            })
            .eq("id", recipient.id);
          sentCount++;
        } else {
          const errorText = await response.text();
          console.error(`Failed to send to ${maskEmail(recipient.email)}:`, errorText);
          await supabase
            .from(recipient.recipientTable)
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
        console.error(`Error sending to ${maskEmail(recipient.email)}:`, error);
        await supabase
          .from(recipient.recipientTable)
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
    const finalStatus = failedCount === recipientsToProcess.length ? "failed" : "completed";
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
        const requestedPage = parseInt(url.searchParams.get("page") || "1", 10);
        
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
        
        // Thread type interface
        interface HelpScoutThread {
          type: string;
          createdAt?: string;
        }
        
        interface HelpScoutConversationRaw {
          id?: number;
          primaryCustomer?: { email?: string };
          source?: { via?: string };
          status?: string;
          _embedded?: {
            threads?: HelpScoutThread[];
          };
        }
        
        interface EnrichedConversation extends Omit<HelpScoutConversationRaw, '_embedded'> {
          client_id?: string;
          lastMessageBy: 'customer' | 'staff';
          needsReply: boolean;
        }
        
        // Configuration for multi-page aggregation
        const targetCount = 25; // Target conversations per virtual page
        const maxHelpScoutPages = 10; // Safety limit to prevent infinite loops
        const allMatchingConversations: EnrichedConversation[] = [];
        let hsPage = 1;
        let totalHelpScoutPages = 1;
        let totalHelpScoutElements = 0;
        let pagesScanned = 0;
        
        console.log(`Starting multi-page scan for direction=${direction}, status=${status}`);
        
        // Scan HelpScout pages until we have enough matching conversations
        while (allMatchingConversations.length < targetCount && hsPage <= maxHelpScoutPages) {
          let endpoint = `/conversations?mailbox=${mailboxId}&page=${hsPage}&embed=threads`;
          if (status !== "all") {
            endpoint += `&status=${status}`;
          }
          
          console.log(`Fetching HelpScout page ${hsPage}: ${endpoint}`);
          const response = await helpscoutRequest("GET", endpoint);
          
          if (!response.ok) {
            const error = await response.text();
            console.error("HelpScout list error:", error);
            throw new Error(`HelpScout API error: ${response.status}`);
          }
          
          const hsData = await response.json();
          const conversations: HelpScoutConversationRaw[] = hsData._embedded?.conversations || [];
          pagesScanned++;
          
          // Track pagination info from first page
          if (hsPage === 1) {
            totalHelpScoutPages = hsData.page?.totalPages || 1;
            totalHelpScoutElements = hsData.page?.totalElements || 0;
          }
          
          console.log(`Page ${hsPage}: got ${conversations.length} conversations`);
          
          if (conversations.length === 0) {
            break;
          }
          
          // Extract customer emails from this page
          const customerEmails = Array.from(
            new Set(
              conversations
                .map((c) => {
                  const raw = c.primaryCustomer?.email;
                  return raw ? normalizeEmail(raw) : null;
                })
                .filter(Boolean) as string[]
            )
          );
          
          if (customerEmails.length > 0) {
            // Find matching clients for this batch
            const { data: clients, error: clientsError } = await supabase
              .rpc("find_clients_by_emails_insensitive", {
                p_tenant_id: membership.tenant_id,
                p_emails: customerEmails,
              });
            
            if (clientsError) {
              console.error("Clients lookup error:", clientsError);
              throw new Error("Could not fetch clients");
            }
            
            // Create email -> client_id lookup
            const emailToClientId = new Map<string, string>(
              (clients || [])
                .filter((c: { id: string; email: string | null }) => Boolean(c.email))
                .map((c: { id: string; email: string | null }) => [normalizeEmail(c.email as string), c.id])
            );
            
            console.log(`Page ${hsPage}: ${customerEmails.length} unique emails, ${emailToClientId.size} matched clients`);
            
            // Filter to client-matching conversations and enrich
            for (const c of conversations) {
              const email = c.primaryCustomer?.email ? normalizeEmail(c.primaryCustomer.email) : undefined;
              
              if (!email || !emailToClientId.has(email)) {
                continue;
              }
              
              // Determine lastMessageBy from embedded threads
              const threads = c._embedded?.threads || [];
              const lastRelevantThread = threads.find((t) => 
                t.type === 'customer' || t.type === 'reply' || t.type === 'message'
              );
              
              let lastMessageBy: 'customer' | 'staff' = 'customer';
              if (lastRelevantThread) {
                lastMessageBy = lastRelevantThread.type === 'customer' ? 'customer' : 'staff';
              }
              
              const needsReply = c.status === 'active' && lastMessageBy === 'customer';
              
              // Apply direction filter during accumulation
              if (direction === "received" || direction === "inbox") {
                if (lastMessageBy !== "customer") continue;
              } else if (direction === "sent") {
                if (lastMessageBy !== "staff") continue;
              }
              
              // Create enriched conversation without embedded threads
              const { _embedded: _, ...conversationWithoutEmbedded } = c;
              const enriched: EnrichedConversation = {
                ...conversationWithoutEmbedded,
                client_id: emailToClientId.get(email),
                lastMessageBy,
                needsReply,
              };
              
              allMatchingConversations.push(enriched);
            }
          }
          
          console.log(`After page ${hsPage}: ${allMatchingConversations.length} matching conversations accumulated`);
          
          // Check if we've exhausted HelpScout pages
          if (hsPage >= totalHelpScoutPages) {
            console.log(`Reached last HelpScout page (${hsPage}/${totalHelpScoutPages})`);
            break;
          }
          
          hsPage++;
          
          // Small delay to respect rate limits
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        
        console.log(`Multi-page scan complete: scanned ${pagesScanned} pages, found ${allMatchingConversations.length} matching conversations`);
        
        // Virtual pagination: slice results based on requested page
        const pageSize = 25;
        const startIndex = (requestedPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageConversations = allMatchingConversations.slice(startIndex, endIndex);
        const totalMatchingPages = Math.ceil(allMatchingConversations.length / pageSize) || 1;
        
        const debugInfo = {
          hs_total_elements: totalHelpScoutElements,
          hs_pages_scanned: pagesScanned,
          total_matching_conversations: allMatchingConversations.length,
          direction_filter: direction,
          requested_page: requestedPage,
        };

        result = {
          conversations: pageConversations,
          page: {
            size: pageSize,
            totalElements: allMatchingConversations.length,
            totalPages: totalMatchingPages,
            number: requestedPage,
          },
          ...(pageConversations.length === 0 ? { _debug: debugInfo } : {}),
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
