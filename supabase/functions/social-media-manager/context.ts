import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";

export type CrmCapabilities = {
  mutate: boolean;
  communicate: boolean;
  manage_campaigns: boolean;
  report: boolean;
};

/**
 * The authenticated CRM operating context. tenantId and capabilities are resolved
 * server-side by authenticate() and are never taken from the request body; db is the
 * service-role client, so every handler must scope its own reads and writes to tenantId.
 */
export type AuthContext = {
  userId: string;
  tenantId: string;
  crmRole: string;
  capabilities: CrmCapabilities;
  db: SupabaseClient;
};

export function requireMutate(auth: Pick<AuthContext, "capabilities">) {
  if (!auth.capabilities?.mutate) throw new Error("FORBIDDEN");
}
