import { createClient, type User } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const allowedOrigins = new Set([
  "https://valorwell.org",
  "https://www.valorwell.org",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;

  try {
    const url = new URL(origin);
    return url.protocol === "https:" && url.hostname.endsWith(".netlify.app");
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin)
      ? origin!
      : "https://valorwell.org",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(origin: string | null, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 255) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function createTemporaryPassword(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}-A9!`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<User | null> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );
    if (match) return match;
    if (data.users.length < 1000) return null;
  }

  throw new Error("auth_user_lookup_limit_exceeded");
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (request.method !== "POST") {
    return json(origin, { ok: false }, 405);
  }

  if (!isAllowedOrigin(origin)) {
    return json(origin, { ok: false }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(
      origin,
      { ok: false, message: "Please check the form and try again." },
      400,
    );
  }

  if (typeof body.company === "string" && body.company.trim() !== "") {
    return json(origin, { ok: true });
  }

  const firstName = normalizeText(body.firstName, 100);
  const lastName = normalizeText(body.lastName, 100);
  const email = normalizeEmail(body.email);
  const consent = body.communicationConsent === true;
  const submissionKey = normalizeText(body.submissionKey, 150);

  if (!firstName || !lastName || !email || !consent || !submissionKey) {
    return json(
      origin,
      { ok: false, message: "Please complete every required field." },
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Clinician interest provisioning is missing Supabase configuration.",
    );
    return json(
      origin,
      { ok: false, message: "Something went wrong. Please try again." },
      500,
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  let createdUserId: string | null = null;

  try {
    let authUser = await findUserByEmail(admin, email);

    if (!authUser) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: createTemporaryPassword(),
        email_confirm: true,
        user_metadata: {
          first_name: firstName,
          last_name: lastName,
          source: "website_clinician_interest",
        },
      });
      if (error || !data.user) {
        throw error ?? new Error("auth_user_creation_failed");
      }
      authUser = data.user;
      createdUserId = authUser.id;
    }

    const requestIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("cf-connecting-ip")?.trim() ||
      "unknown";
    const requestIpHash = await sha256(
      `${requestIp}:valorwell-clinician-interest`,
    );

    const { data, error } = await admin.rpc(
      "provision_website_clinician_interest",
      {
        p_auth_user_id: authUser.id,
        p_payload: {
          submission_key: submissionKey,
          first_name: firstName,
          last_name: lastName,
          email,
          communication_consent: true,
          source_page: "/clinicians",
          user_agent: request.headers.get("user-agent"),
          request_ip_hash: requestIpHash,
        },
      },
    );

    if (error) throw error;

    return json(origin, {
      ok: true,
      lifecycle: data?.recruiting_lifecycle ?? "invite_sent",
    });
  } catch (error) {
    if (createdUserId) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(
        createdUserId,
      );
      if (cleanupError) {
        console.error("Unable to clean up failed clinician auth provisioning.");
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("rate_limited")) {
      return json(
        origin,
        { ok: false, message: "Please try again later." },
        429,
      );
    }

    console.error("Clinician interest provisioning failed:", message);
    return json(
      origin,
      { ok: false, message: "Something went wrong. Please try again." },
      500,
    );
  }
});
