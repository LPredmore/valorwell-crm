import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  BTY_GEMINI_MODEL,
  BTY_TENANT_ID,
  buildContactPrompt,
  callGemini,
  centralBusinessDate,
  CONTACT_SCHEMA,
} from "../_shared/bty.ts";
import { adminClient, authorizeWorker, json, logEvent, safeError } from "../_shared/bty-runtime.ts";
import { awaitGeminiSlot } from "../_shared/gemini-rate-limit.ts";

type ContactResult = {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  title?: string;
  email?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
  other_contact_method?: string | null;
  why_this_person?: string;
  evidence_urls?: string[];
  confidence?: number;
  verified?: boolean;
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = adminClient();
  if (!await authorizeWorker(request, admin)) {
    return json({ error: "BTY worker authorization is required." }, 403);
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const tenantId = typeof body.tenantId === "string" ? body.tenantId : BTY_TENANT_ID;
  const businessDate = typeof body.businessDate === "string" ? body.businessDate : centralBusinessDate();

  const targets = await admin.rpc("bty_contact_enrichment_targets", {
    p_tenant_id: tenantId,
    p_business_date: businessDate,
  });
  if (targets.error) return json({ error: targets.error.message }, 500);
  const payload = targets.data as Record<string, unknown>;
  if (payload.eligible !== true) {
    logEvent("bty-contact-enrichment", "skipped", { reason: payload.reason, businessDate });
    return json({ skipped: true, reason: payload.reason });
  }

  const runId = String(payload.runId);
  const organizations = (payload.organizations as Record<string, unknown>[]) ?? [];
  const results: Record<string, unknown>[] = [];

  for (const organization of organizations) {
    const organizationId = String(organization.organizationId);
    try {
      // Shared automated Gemini rate limit (8 starts / rolling 60s across all automation jobs).
      await awaitGeminiSlot(admin, { label: "bty-contact-enrichment", maxWaitMs: 120_000 });
      const contact = await callGemini<ContactResult>({
        prompt: buildContactPrompt({
          organizationName: String(organization.name ?? ""),
          website: (organization.website as string) ?? null,
          state: (organization.headquartersState as string) ?? null,
          directServices: (organization.directServices as string) ?? null,
        }),
        schema: CONTACT_SCHEMA,
      });

      const identified = Boolean(
        (contact.full_name ?? "").trim() || (contact.first_name ?? "").trim() || (contact.email ?? "").trim(),
      );
      const evidence = Array.isArray(contact.evidence_urls) ? contact.evidence_urls : [];
      if (!identified || evidence.length === 0) {
        await admin.rpc("bty_record_contact_enrichment", {
          p_run_id: runId,
          p_organization_id: organizationId,
          p_status: "no_verified_contact",
          p_model: BTY_GEMINI_MODEL,
          p_error: { reason: "no_verifiable_person_found" },
        });
        results.push({ organizationId, status: "no_verified_contact" });
        continue;
      }

      const applied = await admin.rpc("bty_apply_contact_enrichment", {
        p_tenant_id: tenantId,
        p_run_id: runId,
        p_organization_id: organizationId,
        p_model: BTY_GEMINI_MODEL,
        p_contact: {
          first_name: contact.first_name ?? null,
          last_name: contact.last_name ?? null,
          full_name: contact.full_name ?? null,
          title: contact.title ?? null,
          email: contact.email ?? null,
          linkedin_url: contact.linkedin_url ?? null,
          phone: contact.phone ?? null,
          other_contact_method: contact.other_contact_method ?? null,
          why_this_person: contact.why_this_person ?? null,
          evidence_urls: evidence,
          confidence: contact.confidence ?? null,
        },
      });
      if (applied.error) throw new Error(applied.error.message);
      results.push({ organizationId, status: "success", ...(applied.data as Record<string, unknown>) });
    } catch (error) {
      const detail = safeError(error);
      await admin.rpc("bty_record_contact_enrichment", {
        p_run_id: runId,
        p_organization_id: organizationId,
        p_status: "failed",
        p_model: BTY_GEMINI_MODEL,
        p_error: { message: detail.message, kind: detail.kind ?? "workflow_error" },
      });
      results.push({ organizationId, status: "failed", error: detail.message });
      logEvent("bty-contact-enrichment", "organization_failed", { organizationId, error: detail.message });
    }
  }

  logEvent("bty-contact-enrichment", "complete", { runId, organizations: results.length });
  return json({ runId, businessDate, results });
});
