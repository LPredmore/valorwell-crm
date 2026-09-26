import { type AuthContext, requireMutate } from "./context.ts";

/** View actions: any authenticated CRM user with a resolved tenant (including crm_readonly).
 * None of these write -- validate_publication and get_youtube_connection_status are reads. */
export const VIEW_ACTIONS: ReadonlySet<string> = new Set([
  "bootstrap", "list_library", "list_publications", "get_publication",
  "list_publication_events", "get_settings", "get_youtube_connection_status",
  "get_thumbnail_url", "validate_publication",
]);

/** Mutation actions: require capabilities.mutate (crm_admin/crm_operator today). */
export const MUTATE_ACTIONS: ReadonlySet<string> = new Set([
  "create_publication", "update_publication", "approve_publication",
  "set_publication_playlists", "queue_publish", "reschedule_publication",
  "cancel_publication", "retry_publication", "replace_thumbnail", "mark_thumbnail_manual_done",
  "verify_youtube_connection", "preview_bulk_schedule", "bulk_schedule",
]);

/** Rejects unknown actions and mutations by callers without the mutate capability. */
export function authorizeAction(auth: Pick<AuthContext, "capabilities">, action: string) {
  if (MUTATE_ACTIONS.has(action)) {
    requireMutate(auth);
    return;
  }
  if (!VIEW_ACTIONS.has(action)) throw new Error(`Invalid action: ${action}`);
}
