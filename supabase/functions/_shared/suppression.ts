import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MessageClass =
  | "ordinary_promotional"
  | "ordinary_campaign_follow_up"
  | "wait_path_ordinary"
  | "necessary_scheduling"
  | "active_care"
  | "billing_insurance"
  | "clinical_safety_legal"
  | "transactional_account";

export type Channel = "email" | "sms";

export interface SuppressionDecision {
  allowed: boolean;
  reason_code:
    | "ok"
    | "contact_policy_dnc"
    | "service_policy_blocked"
    | "unknown_canonical_state"
    | "class_never_permitted"
    | "lifecycle_closed_no_active_care";
  policy_version: string;
  contact_policy: string | null;
  service_policy: string | null;
}

interface SuppressionArgs {
  tenantId: string;
  clientId: string;
  channel: Channel;
  messageClass: MessageClass;
  workflow: string;
  correlationId?: string | null;
  campaignId?: string | null;
  stepId?: string | null;
}

const deny = (): SuppressionDecision => ({
  allowed: false,
  reason_code: "unknown_canonical_state",
  policy_version: "unknown",
  contact_policy: null,
  service_policy: null,
});

export async function checkSuppression(
  supabaseUrl: string,
  serviceRoleKey: string,
  args: SuppressionArgs,
): Promise<SuppressionDecision> {
  const client = createClient(supabaseUrl, serviceRoleKey);

  const { data: target, error: targetError } = await client
    .from("clients")
    .select("tenant_id")
    .eq("id", args.clientId)
    .maybeSingle();

  if (targetError || !target || target.tenant_id !== args.tenantId) {
    return deny();
  }

  const { data, error } = await client.rpc("crm_evaluate_communication_policy", {
    p_client_id: args.clientId,
    p_channel: args.channel,
    p_message_class: args.messageClass,
  });

  if (error || !data) {
    console.warn("[suppression] policy RPC failed:", error?.message);
    return deny();
  }

  const decision = data as SuppressionDecision;
  if (!decision.allowed) {
    const { error: auditError } = await client.from("crm_activity_events").insert({
      tenant_id: args.tenantId,
      client_id: args.clientId,
      event_type: args.channel === "email" ? "email_suppressed" : "sms_suppressed",
      created_by_profile_id: null,
      metadata: {
        reason_code: decision.reason_code,
        policy_version: decision.policy_version,
        channel: args.channel,
        message_class: args.messageClass,
        workflow: args.workflow,
        correlation_id: args.correlationId ?? null,
        campaign_id: args.campaignId ?? null,
        step_id: args.stepId ?? null,
      },
    });
    if (auditError) {
      console.error("[suppression] failed to write suppression audit:", auditError.message);
    }
  }

  return decision;
}

const REMOVE_TOKENS = new Set(["remove", "stop", "unsubscribe", "quit", "end", "cancel"]);

export function isRemoveMessage(body: string | null | undefined): boolean {
  if (!body) return false;
  const normalized = body.trim().toLowerCase().replace(/[^a-z]/g, "");
  return REMOVE_TOKENS.has(normalized);
}

export async function applyRemove(
  supabaseUrl: string,
  serviceRoleKey: string,
  args: {
    tenantId: string;
    clientId: string;
    source: string;
    correlationId?: string | null;
  },
): Promise<{ ok: boolean; error_code?: string; message?: string }> {
  const client = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await client.rpc("crm_apply_remove", {
    p_tenant_id: args.tenantId,
    p_client_id: args.clientId,
    p_source: args.source,
    p_correlation_id: args.correlationId ?? crypto.randomUUID(),
  });

  if (error || !data) {
    return { ok: false, error_code: "rpc_failed", message: error?.message };
  }
  return data as { ok: boolean; error_code?: string; message?: string };
}
