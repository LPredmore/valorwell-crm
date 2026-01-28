import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        const page = url.searchParams.get("page") || "1";
        
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
        result = await response.json();
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
