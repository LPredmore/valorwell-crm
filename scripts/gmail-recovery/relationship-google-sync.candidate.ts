import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
import { classifyBtyCalendarEvent } from "./relationship-calendar-classification.ts";
import {
  CALENDAR_WEBHOOK_URL,
  connectionRuntime,
  emailList,
  firstEmail,
  GMAIL_MAILBOX,
  gmailBody,
  googleJson,
  headerMap,
  randomToken,
  refreshGoogleAccessToken,
  STREAMYARD_URL,
  TENANT_ID,
  type GoogleRuntime,
} from "./relationship-google.ts";

type SyncState = {
  gmailHistoryId?: string;
  gmailWatchExpiration?: string;
  lastSuccessfulSyncAt?: string;
  calendarSyncToken?: string;
};

async function syncState(admin: SupabaseClient, connectionId: string): Promise<SyncState> {
  const { data, error } = await admin.rpc("get_relationship_google_sync_state", {
    p_connection_id: connectionId,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as SyncState;
}

async function updateState(admin: SupabaseClient, input: Record<string, unknown>) {
  const { data, error } = await admin.rpc("update_relationship_google_sync_state", input);
  if (error) throw new Error(error.message);
  return data;
}

function metadataUrl(messageId: string, format: "metadata" | "full") {
  const params = new URLSearchParams({ format });
  if (format === "metadata") {
    for (const header of [
      "From", "To", "Cc", "Subject", "Date", "Message-ID", "In-Reply-To", "References",
      "Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond", "X-Auto-Response-Suppress",
      "X-Relationship-Communication-ID",
    ]) params.append("metadataHeaders", header);
  }
  return `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?${params}`;
}

async function assertGmailRuntimeContract(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("get_relationship_gmail_runtime_contract");
  if (error || data?.contractVersion !== 1 || data?.ready !== true) {
    throw Object.assign(new Error("Required Gmail database contract unavailable; reviewed database release required."), {
      code: "gmail_contract_missing", contractErrorCode: error?.code ?? "contract_not_ready",
    });
  }
}

async function recordGmailRetrievalFailure(admin: SupabaseClient, messageId: string, providerError: Error & { status?: number }) {
  const { error } = await admin.rpc("record_relationship_gmail_retrieval_failure", {
    p_message_id: messageId,
    p_status: providerError.status === 404 ? "NOT_FOUND" : providerError.status === 403 ? "FORBIDDEN" : "UNAVAILABLE",
  });
  if (error) {
    throw Object.assign(new Error(`Gmail retrieval failed (HTTP ${providerError.status ?? "unknown"}); failure recording failed (${error.code ?? "database_error"}); cursor preserved.`), {
      status: providerError.status, code: error.code === "PGRST202" ? "gmail_contract_missing" : "gmail_failure_recording_failed",
    });
  }
}

async function processGmailMessage(
  admin: SupabaseClient,
  accessToken: string,
  messageId: string,
) {
  // A 404 means unavailable to this request, not proof of deletion/non-delivery.
  // A missing single message must not strand the mailbox's recovery cursor.
  const metadata = await googleJson(metadataUrl(messageId, "metadata"), accessToken)
    .catch(async (error: Error & { status?: number }) => {
      await recordGmailRetrievalFailure(admin, messageId, error);
      if (error.status === 404) return null;
      throw error;
    });
  if (!metadata) return { messageId, matched: false, skipped: "message_not_found" };
  if (metadata.id !== messageId) {
    const { error } = await admin.rpc("record_relationship_gmail_retrieval_failure", { p_message_id: messageId, p_status: "MISMATCH" });
    if (error) throw new Error(error.message);
    throw new Error("Gmail metadata message identity mismatch.");
  }
  // Drafts can share a thread/RFC anchor with sent mail, but are not delivery evidence.
  if (Array.isArray(metadata.labelIds) && metadata.labelIds.includes("DRAFT")) {
    return { messageId, matched: false, skipped: "draft_message" };
  }
  const payload = (metadata.payload ?? {}) as Record<string, unknown>;
  const headers = headerMap(payload);
  const from = firstEmail(headers.from ?? "");
  const to = emailList(`${headers.to ?? ""},${headers.cc ?? ""}`);
  const subject = headers.subject ?? "";
  const { data: match, error: matchError } = await admin.rpc("match_relationship_gmail_message", {
    p_tenant_id: TENANT_ID,
    p_gmail_message_id: messageId,
    p_gmail_thread_id: String(metadata.threadId ?? ""),
    p_headers: headers,
    p_from_email: from,
    p_to_emails: to,
    p_subject: subject,
  });
  if (matchError) throw new Error(matchError.message);
  const decision = (match ?? {}) as Record<string, unknown>;
  // Ambiguous/relevant messages need full RFC headers and body for the
  // authoritative ingestion path; metadata-only placeholders can lose evidence.
  // Do not fetch unrelated messages or advance their lifecycle.
  if (decision.observationEnabled !== true) {
    return { messageId, matched: false, skipped: "observation_disabled" };
  }
  const shouldFetchFull = decision.matched === true ||
    decision.unanchoredCandidate === true ||
    decision.ambiguous === true ||
    decision.likelyRelationship === true;
  if (!shouldFetchFull) {
    return { messageId, matched: false, skipped: "unrelated_message" };
  }
  const full = await googleJson(metadataUrl(messageId, "full"), accessToken)
    .catch(async (error: Error & { status?: number }) => {
      await recordGmailRetrievalFailure(admin, messageId, error);
      if (error.status === 404) return null;
      throw error;
    });
  if (!full) return { messageId, matched: false, skipped: "message_not_found" };
  if (full.id !== messageId || !full.threadId || full.threadId !== metadata.threadId) {
    const { error } = await admin.rpc("record_relationship_gmail_retrieval_failure", { p_message_id: messageId, p_status: "MISMATCH" });
    if (error) throw new Error(error.message);
    throw new Error("Gmail full message identity mismatch.");
  }
  if (Array.isArray(full.labelIds) && full.labelIds.includes("DRAFT")) {
    return { messageId, matched: false, skipped: "draft_message" };
  }
  const fullPayload = (full.payload ?? {}) as Record<string, unknown>;
  const rfcIds = ((fullPayload.headers ?? []) as Array<{ name: string; value: string }>)
    .filter(header => header.name.toLowerCase() === "message-id").map(header => header.value.trim());
  if (new Set(rfcIds).size > 1) {
    const { error } = await admin.rpc("record_relationship_gmail_retrieval_failure", { p_message_id: messageId, p_status: "MISMATCH" });
    if (error) throw new Error(error.message);
    throw new Error("Conflicting Gmail RFC Message-ID headers.");
  }
  const fullHeaders = headerMap(fullPayload);
  // Persist independent retrieval provenance before ingestion. Never manufacture
  // these receipts from a CRM communication or a matching thread/subject.
  const { error: receiptError } = await admin.rpc("record_relationship_gmail_source_receipt", {
    p_tenant_id: TENANT_ID, p_message_id: full.id, p_thread_id: full.threadId,
    p_mailbox: GMAIL_MAILBOX, p_headers: fullHeaders,
    p_label_ids: Array.isArray(full.labelIds) ? full.labelIds : [],
  });
  if (receiptError) throw new Error(receiptError.message);
  const fullFrom = firstEmail(fullHeaders.from ?? "") || from;
  const fullTo = emailList(`${fullHeaders.to ?? ""},${fullHeaders.cc ?? ""}`);
  const { data, error } = await admin.rpc("ingest_relationship_gmail_message", {
    p_tenant_id: TENANT_ID,
    p_gmail_message_id: messageId,
    p_gmail_thread_id: String(full.threadId ?? metadata.threadId ?? ""),
    p_headers: fullHeaders,
    p_from_email: fullFrom,
    p_to_emails: fullTo.length ? fullTo : to,
    p_subject: fullHeaders.subject ?? subject,
    p_body: gmailBody(fullPayload),
    p_occurred_at: new Date(Number(full.internalDate ?? metadata.internalDate ?? Date.now())).toISOString(),
    p_label_ids: Array.isArray(full.labelIds) ? full.labelIds : [],
  });
  if (error) throw new Error(error.message);
  // A successful RPC transport does not establish that a communication was
  // persisted. Ingestion can reject a false thread anchor and return matched:false.
  const ingested = (data ?? {}) as Record<string, unknown>;
  const captured = ingested.observed === true || ingested.matched === true;
  return { messageId, matched: captured, ambiguous: ingested.ambiguous === true, result: data };
}

async function fullGmailReconciliation(
  admin: SupabaseClient,
  runtime: GoogleRuntime,
  accessToken: string,
  state: SyncState,
) {
  // Snapshot the history cursor BEFORE scanning. Mail added during the scan
  // remains visible in the next incremental history call.
  const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken);
  if (String(profile.emailAddress ?? "").toLowerCase() !== GMAIL_MAILBOX) {
    throw new Error("Connected Gmail mailbox no longer matches info@valorwell.org.");
  }
  const baselineHistoryId = String(profile.historyId ?? "");
  if (!baselineHistoryId) throw new Error("Gmail profile did not return a recovery history cursor.");

  // Overlap the previous verified sync by one day to avoid timezone and
  // mid-processing boundaries. Initial onboarding uses the original 90-day scope.
  const lastSuccess = state.lastSuccessfulSyncAt ? Date.parse(state.lastSuccessfulSyncAt) : NaN;
  const startingAt = Number.isFinite(lastSuccess)
    ? new Date(lastSuccess - 86_400_000)
    : new Date(Date.now() - 90 * 86_400_000);
  const day = startingAt.toISOString().slice(0, 10).replaceAll("-", "/");
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: `after:${day}`, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      accessToken,
    );
    for (const item of (page.messages ?? []) as Array<{ id?: string }>) {
      if (item.id) messageIds.push(item.id);
    }
    // Never advance the cursor after a silent limit/truncation. Larger historical
    // mailboxes require an explicit paginated backfill, not an incomplete "success".
    if (messageIds.length > 1200) {
      throw new Error("Gmail recovery exceeds the safe 1200-message batch; cursor preserved for historical backfill.");
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : undefined;
  } while (pageToken);

  const results: Array<{ matched?: boolean; skipped?: string }> = [];
  // Gmail lists newest first. Process older messages first so references to
  // earlier outbound conversations are available for subsequent reply matching.
  for (let end = messageIds.length; end > 0; end -= 8) {
    const batch = messageIds.slice(Math.max(0, end - 8), end).reverse();
    const observed = await Promise.all(batch.map((id) => processGmailMessage(admin, accessToken, id)));
    results.push(...observed);
  }
  await updateState(admin, {
    p_connection_id: runtime.id,
    p_gmail_history_id: baselineHistoryId,
    p_success: true,
    p_full_reconciliation: true,
  });
  return {
    mode: "full",
    scanned: messageIds.length,
    processed: results.filter((item) => !item.skipped).length,
    skippedUnavailable: results.filter((item) => item.skipped === "message_not_found").length,
    matched: results.filter((item) => item.matched === true).length,
    historyId: baselineHistoryId,
  };
}

/**
 * Gmail history IDs can expire or accumulate a large unread backlog. A full mailbox scan cannot always
 * complete in a single webhook/HTTP invocation. Before establishing a fresh
 * live cursor, durably record the outstanding historical interval for a
 * separate paginated backfill. This prevents losing the gap silently.
 */
async function checkpointExpiredGmailHistory(
  admin: SupabaseClient,
  runtime: GoogleRuntime,
  accessToken: string,
  state: SyncState,
) {
  const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken);
  if (String(profile.emailAddress ?? "").toLowerCase() !== GMAIL_MAILBOX) {
    throw new Error("Connected Gmail mailbox no longer matches info@valorwell.org.");
  }
  const freshHistoryId = String(profile.historyId ?? "");
  if (!freshHistoryId) throw new Error("Gmail recovery cannot establish a valid history cursor.");

  // Durability order is intentional: record the unprocessed historical interval
  // before advancing the live history cursor. A failed issue write must fail
  // the cutover rather than silently discarding mail from the prior interval.
  const gapKey = `gmail-history-gap:${runtime.id}:${state.gmailHistoryId ?? "initial"}`;
  const { error: gapError } = await admin.from("relationship_reconciliation_issues").insert({
    tenant_id: TENANT_ID,
    issue_type: "sync_error",
    severity: "critical",
    status: "open",
    source: "gmail",
    external_event_id: gapKey,
    summary: "Gmail historical messages remain unprocessed after a stale or expired history cursor; paginated backfill required.",
    details: {
      recovery_kind: "stale_or_expired_gmail_history",
      gmail_connection_id: runtime.id,
      last_verified_sync_at: state.lastSuccessfulSyncAt ?? null,
      previous_history_id: state.gmailHistoryId ?? null,
      recovery_baseline_history_id: freshHistoryId,
      requires_historical_backfill: true,
    },
  });
  if (gapError && gapError.code !== "23505") {
    throw new Error(`Could not preserve Gmail historical-backfill obligation: ${gapError.message}`);
  }

  await updateState(admin, {
    p_connection_id: runtime.id,
    p_gmail_history_id: freshHistoryId,
    p_error_code: "historical_backfill_pending",
    p_error_reason: "Stale or expired Gmail history; live cursor restored with a durable pending reconciliation issue.",
  });
  console.warn(JSON.stringify({
    component: "relationship-google-sync",
    event: "history_gap_checkpointed",
    pendingFrom: state.lastSuccessfulSyncAt ?? null,
    historicalBackfillPending: true,
  }));
  return {
    mode: "live_cursor_restored",
    historicalBackfillPending: true,
    pendingFrom: state.lastSuccessfulSyncAt ?? null,
    historyId: freshHistoryId,
  };
}

export async function syncGmail(
  admin: SupabaseClient,
  notificationHistoryId?: string,
) {
  const runtime = await connectionRuntime(admin, "gmail");
  if (!runtime) return { skipped: true, reason: "gmail_not_connected" };
  if (runtime.googleAccountEmail.toLowerCase() !== GMAIL_MAILBOX) throw new Error("Gmail mailbox restriction failed.");
  try {
    await assertGmailRuntimeContract(admin);
    const accessToken = await refreshGoogleAccessToken(runtime);
    const state = await syncState(admin, runtime.id);
    if (!state.gmailHistoryId) return await fullGmailReconciliation(admin, runtime, accessToken, state);

    // A single bounded Gmail history page fits scheduled HTTP invocations. Do
    // NOT use page.historyId as the next cursor when more pages exist: it reflects
    // the current mailbox, not necessarily the last fully processed page.
    const params = new URLSearchParams({
      startHistoryId: state.gmailHistoryId,
      historyTypes: "messageAdded",
      maxResults: "25",
    });
    let page: Record<string, unknown>;
    try {
      page = await googleJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`,
        accessToken,
      );
    } catch (error) {
      if ((error as Error & { status?: number }).status === 404) {
        return await checkpointExpiredGmailHistory(admin, runtime, accessToken, state);
      }
      throw error;
    }

    const history = (page.history ?? []) as Array<Record<string, unknown>>;
    const hasMore = typeof page.nextPageToken === "string";
    const lastSynced = state.lastSuccessfulSyncAt ? Date.parse(state.lastSuccessfulSyncAt) : NaN;
    // A long-running backlog cannot block the live mailbox or be silently
    // truncated. Preserve its evidence and recover historical messages via the
    // dedicated paginated reconciliation process.
    if (hasMore && (!Number.isFinite(lastSynced) || Date.now() - lastSynced > 48 * 3600_000)) {
      return await checkpointExpiredGmailHistory(admin, runtime, accessToken, state);
    }

    const ids = new Set<string>();
    for (const item of history) {
      for (const added of (item.messagesAdded ?? []) as Array<{ message?: { id?: string } }>) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    const messageIds = [...ids];
    const results: Array<{ matched?: boolean; skipped?: string }> = [];
    for (let i = 0; i < messageIds.length; i += 6) {
      results.push(...await Promise.all(
        messageIds.slice(i, i + 6).map((id) => processGmailMessage(admin, accessToken, id)),
      ));
    }
    const lastHistoryRecordId = history.length
      ? String(history[history.length - 1].id ?? "")
      : "";
    const nextHistoryId = hasMore
      ? lastHistoryRecordId
      : String(page.historyId ?? notificationHistoryId ?? state.gmailHistoryId);
    if (!nextHistoryId || (hasMore && nextHistoryId === state.gmailHistoryId)) {
      throw new Error("Gmail history page cannot be checkpointed without losing messages.");
    }
    await updateState(admin, {
      p_connection_id: runtime.id,
      p_gmail_history_id: nextHistoryId,
      p_notification: Boolean(notificationHistoryId),
      p_success: true,
    });
    return {
      mode: "history",
      processed: results.filter((row) => !row.skipped).length,
      skippedUnavailable: results.filter((row) => row.skipped === "message_not_found").length,
      skipped: results.filter((row) => row.skipped).length,
      matched: results.filter((row) => row.matched === true).length,
      hasMore,
      historyId: nextHistoryId,
    };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    await updateState(admin, {
      p_connection_id: runtime.id, p_notification: Boolean(notificationHistoryId),
      p_error_code: (error as Error & { code?: string }).code === "gmail_contract_missing"
        ? "gmail_contract_missing" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "gmail_sync_failed",
      p_error_reason: error instanceof Error ? error.message : "Gmail synchronization failed.",
    });
    throw error;
  }
}


/**
 * Handle exactly one bounded page of the historical Gmail gap. The row-level
 * lease and checkpoints are durable SQL RPCs, independent from the LIVE history
 * cursor. Failed pages are retried without skipping messages.
 */
export async function backfillGmailBatch(admin: SupabaseClient) {
  await assertGmailRuntimeContract(admin);
  const { data: candidates, error: listError } = await admin
    .from("relationship_reconciliation_issues")
    .select("id,details,created_at")
    .eq("tenant_id", TENANT_ID)
    .eq("source", "gmail")
    .eq("issue_type", "sync_error")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(50);
  if (listError) throw new Error(`Gmail backfill issue discovery failed: ${listError.message}`);
  const issue = (candidates ?? []).find((row) => row.details?.requires_historical_backfill === true);
  if (!issue) return { skipped: true, reason: "no_pending_gmail_history_gap" };

  const runtime = await connectionRuntime(admin, "gmail");
  if (!runtime || runtime.googleAccountEmail.toLowerCase() !== GMAIL_MAILBOX) {
    throw new Error("Gmail backfill has no authorized canonical mailbox.");
  }
  if (issue.details?.gmail_connection_id !== runtime.id) {
    throw new Error("Gmail historical gap is not associated with the active mailbox.");
  }

  const { data: claimed, error: claimError } = await admin.rpc("claim_relationship_gmail_backfill", {
    p_tenant_id: TENANT_ID,
    p_issue_id: issue.id,
    p_lease_seconds: 90,
  });
  if (claimError) throw new Error(`Gmail backfill lease acquisition failed: ${claimError.message}`);
  if (claimed?.acquired !== true) {
    return { skipped: true, reason: String(claimed?.reason ?? "not_acquired") };
  }

  const leaseToken = String(claimed.leaseToken ?? "");
  const details = claimed.details as Record<string, unknown>;
  const createdAt = String(claimed.issueCreatedAt ?? issue.created_at ?? "");
  try {
    const fromTime = Date.parse(String(details.last_verified_sync_at ?? ""));
    const throughTime = Date.parse(createdAt);
    if (!Number.isFinite(fromTime) || !Number.isFinite(throughTime) || fromTime > throughTime) {
      throw new Error("Gmail historical-backfill interval cannot be verified.");
    }
    const gmailDay = (ms: number) => new Date(ms).toISOString().slice(0,10).replaceAll("-", "/");
    const query = `after:${gmailDay(fromTime - 86_400_000)} before:${gmailDay(throughTime + 2 * 86_400_000)}`;
    const accessToken = await refreshGoogleAccessToken(runtime);
    const params = new URLSearchParams({ q: query, maxResults: "20" });
    const pageToken = typeof details.backfill_page_token === "string" ? details.backfill_page_token : "";
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      accessToken,
    );
    const ids = ((page.messages ?? []) as Array<{ id?: string }>)
      .map((item) => item.id).filter((value): value is string => Boolean(value));
    if (ids.length > 20) throw new Error("Gmail API returned more than the bounded twenty-message batch.");
    const nextPageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : null;
    // Retry-safe ingestion is idempotent using the provider message ID. Keep the
    // rate below Google quota limits and the execution within the pg_net timeout.
    const results: Array<{ matched?: boolean; ambiguous?: boolean; skipped?: string }> = [];
    for (let i = 0; i < ids.length; i += 4) {
      results.push(...await Promise.all(
        ids.slice(i, i + 4).map((id) => processGmailMessage(admin, accessToken, id)),
      ));
    }
    const counts = {
      scanned: ids.length,
      matched: results.filter((row) => row.matched === true).length,
      ambiguous: results.filter((row) => row.ambiguous === true).length,
      unavailable: results.filter((row) => row.skipped === "message_not_found").length,
    };
    const { data: checkpoint, error: checkpointError } = await admin.rpc(
      "checkpoint_relationship_gmail_backfill", {
        p_tenant_id: TENANT_ID,
        p_issue_id: issue.id,
        p_lease_token: leaseToken,
        p_next_page_token: nextPageToken,
        p_has_more: Boolean(nextPageToken),
        p_scanned: counts.scanned,
        p_matched: counts.matched,
        p_ambiguous: counts.ambiguous,
        p_unavailable: counts.unavailable,
      },
    );
    if (checkpointError) throw new Error(`Gmail backfill checkpoint failed: ${checkpointError.message}`);
    console.log(JSON.stringify({
      component: "relationship-gmail-backfill",
      event: checkpoint.complete ? "scanned_interval_complete" : "batch_checkpointed",
      issueId: issue.id,
      ...counts,
      cumulativeScanned: checkpoint.scanned,
      remainingPages: Boolean(nextPageToken),
    }));
    return {
      mode: "historical_backfill",
      complete: checkpoint.complete,
      issueId: issue.id,
      batch: counts,
      total: checkpoint,
    };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const errorCode = status ? `google_http_${status}` : "backfill_processing_error";
    const { error: releaseError } = await admin.rpc("release_relationship_gmail_backfill", {
      p_tenant_id: TENANT_ID, p_issue_id: issue.id,
      p_lease_token: leaseToken, p_error_code: errorCode,
    });
    if (releaseError) {
      console.error(JSON.stringify({
        component: "relationship-gmail-backfill",
        event: "lease_release_failed",
        issueId: issue.id,
        errorCode: releaseError.code,
      }));
    }
    throw new Error(`Gmail backfill page failed (${errorCode}); retry is safe; cursor unchanged.`);
  }
}


/**
 * Targeted replay of historically ambiguous messages that have a unique
 * exact-sender, organization and primary-contact BTY opportunity. Everything
 * else stays in the human review queue. No outbound messages are sent.
 */
export async function replayExactBtyGmailCandidates(admin: SupabaseClient) {
  await assertGmailRuntimeContract(admin);
  const runtime = await connectionRuntime(admin, "gmail");
  if (!runtime || runtime.googleAccountEmail.toLowerCase() !== GMAIL_MAILBOX) {
    throw new Error("Authorized canonical Gmail mailbox unavailable for exact replay.");
  }
  const { data, error } = await admin.rpc("list_pending_exact_bty_gmail_message_ids", {
    p_limit: 6,
  });
  if (error) throw new Error(`Exact BTY replay discovery failed: ${error.message}`);
  if (!Array.isArray(data)) throw new Error("Exact BTY replay did not return a message list.");
  const ids = data.filter((id): id is string => typeof id === "string" && Boolean(id));
  if (ids.length === 0) return { complete: true, replayed: 0, captured: 0 };
  const accessToken = await refreshGoogleAccessToken(runtime);
  const results = [];
  for (let i = 0; i < ids.length; i += 2) {
    results.push(...await Promise.all(ids.slice(i, i + 2)
      .map((id) => processGmailMessage(admin, accessToken, id))));
  }
  const captured = results.filter((row) => row.matched).length;
  const unavailable = results.filter((row) => row.skipped === "message_not_found").length;
  console.log(JSON.stringify({
    component: "relationship-google-sync",
    event: "exact_bty_replay_batch",
    scanned: ids.length,
    captured,
    unavailable,
    requiresMoreReconciliation: true,
  }));
  return { complete: false, replayed: ids.length, captured, unavailable };
}

export async function renewGmailWatch(admin: SupabaseClient) {
  const runtime = await connectionRuntime(admin, "gmail");
  if (!runtime) return { skipped: true, reason: "gmail_not_connected" };
  const accessToken = await refreshGoogleAccessToken(runtime);
  const topicName = Deno.env.get("GOOGLE_RELATIONSHIPS_GMAIL_TOPIC") ?? "";
  if (!topicName) throw new Error("Gmail Pub/Sub topic is not configured.");
  const watch = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/watch", accessToken, {
    method: "POST",
    body: JSON.stringify({ topicName }),
  });
  await updateState(admin, {
    p_connection_id: runtime.id,
    // A watch's current history ID must never overwrite an unprocessed cursor.
    // The reconciliation path alone advances gmail_history_id on verified completion.
    p_gmail_watch_expiration: new Date(Number(watch.expiration)).toISOString(),
    // Renewal does not establish that any messages were successfully synchronized.
  });
  return { historyId: watch.historyId, expiration: watch.expiration };
}

function eventTime(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const raw = row.dateTime ?? row.date;
  return typeof raw === "string" ? new Date(raw).toISOString() : null;
}

async function processCalendarEvent(
  admin: SupabaseClient,
  runtime: GoogleRuntime,
  event: Record<string, unknown>,
) {
  const attendees = ((event.attendees ?? []) as Array<{ email?: string }>).map((item) => item.email?.toLowerCase()).filter(Boolean);
  const serialized = JSON.stringify({
    description: event.description,
    location: event.location,
    conferenceData: event.conferenceData,
    hangoutLink: event.hangoutLink,
  });
  const streamyard = serialized.includes(STREAMYARD_URL) ? STREAMYARD_URL : null;
  const { data, error } = await admin.rpc("ingest_relationship_calendar_event", {
    p_tenant_id: TENANT_ID,
    p_connection_id: runtime.id,
    p_calendar_id: runtime.calendarId,
    p_external_event_id: String(event.id ?? ""),
    p_ical_uid: typeof event.iCalUID === "string" ? event.iCalUID : null,
    p_event_status: String(event.status ?? "confirmed"),
    p_starts_at: eventTime(event.start),
    p_ends_at: eventTime(event.end),
    p_attendee_emails: attendees,
    p_streamyard_url: streamyard,
    p_summary: typeof event.summary === "string" ? event.summary : null,
    p_updated_at: typeof event.updated === "string" ? event.updated : new Date().toISOString(),
    p_metadata: {
      bty_classification: classifyBtyCalendarEvent({
        streamyardPresent: Boolean(streamyard),
        summary: typeof event.summary === "string" ? event.summary : null,
        description: typeof event.description === "string" ? event.description : null,
      }),
      organizer: event.organizer,
      attendees: event.attendees,
      htmlLink: event.htmlLink,
      recurringEventId: event.recurringEventId,
    },
  });
  if (error) throw new Error(error.message);
  return data;
}

async function fullCalendarSync(admin: SupabaseClient, runtime: GoogleRuntime, accessToken: string) {
  const results: unknown[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const params = new URLSearchParams({
      showDeleted: "true",
      singleEvents: "true",
      maxResults: "2500",
      timeMin: new Date(Date.now() - 365 * 86_400_000).toISOString(),
      timeMax: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleJson(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(runtime.calendarId ?? "primary")}/events?${params}`,
      accessToken,
    );
    for (const event of (page.items ?? []) as Record<string, unknown>[]) {
      results.push(await processCalendarEvent(admin, runtime, event));
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : undefined;
    nextSyncToken = typeof page.nextSyncToken === "string" ? page.nextSyncToken : nextSyncToken;
  } while (pageToken);
  await updateState(admin, {
    p_connection_id: runtime.id,
    p_calendar_sync_token: nextSyncToken,
    p_success: true,
    p_full_reconciliation: true,
  });
  return { mode: "full", processed: results.length, results };
}

export async function syncCalendar(admin: SupabaseClient, connectionId?: string) {
  const runtime = await connectionRuntime(admin, "calendar", connectionId);
  if (!runtime) return { skipped: true, reason: "calendar_not_connected" };
  const accessToken = await refreshGoogleAccessToken(runtime);
  const state = await syncState(admin, runtime.id);
  if (!state.calendarSyncToken) return fullCalendarSync(admin, runtime, accessToken);
  const results: unknown[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  try {
    do {
      const params = new URLSearchParams({
        showDeleted: "true",
        singleEvents: "true",
        syncToken: state.calendarSyncToken,
        maxResults: "2500",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await googleJson(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(runtime.calendarId ?? "primary")}/events?${params}`,
        accessToken,
      );
      for (const event of (page.items ?? []) as Record<string, unknown>[]) {
        results.push(await processCalendarEvent(admin, runtime, event));
      }
      pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : undefined;
      nextSyncToken = typeof page.nextSyncToken === "string" ? page.nextSyncToken : nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if ((error as Error & { status?: number }).status === 410) {
      await updateState(admin, { p_connection_id: runtime.id, p_calendar_sync_token: "", p_error_code: "sync_token_expired" });
      return fullCalendarSync(admin, runtime, accessToken);
    }
    throw error;
  }
  await updateState(admin, {
    p_connection_id: runtime.id,
    p_calendar_sync_token: nextSyncToken,
    p_notification: true,
    p_success: true,
  });
  return { mode: "incremental", processed: results.length, results };
}

export async function renewCalendarWatch(admin: SupabaseClient) {
  const runtime = await connectionRuntime(admin, "calendar");
  if (!runtime) return { skipped: true, reason: "calendar_not_connected" };
  const accessToken = await refreshGoogleAccessToken(runtime);
  const channelId = crypto.randomUUID();
  const channelToken = randomToken(48);
  const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
  const response = await googleJson(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(runtime.calendarId ?? "primary")}/events/watch`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: CALENDAR_WEBHOOK_URL,
        token: channelToken,
        expiration: String(expiration),
      }),
    },
  );
  const { data, error } = await admin.rpc("store_relationship_calendar_channel", {
    p_connection_id: runtime.id,
    p_channel_id: channelId,
    p_channel_token: channelToken,
    p_resource_id: String(response.resourceId ?? ""),
    p_expiration: new Date(Number(response.expiration ?? expiration)).toISOString(),
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function observationFlags(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("get_relationship_observation_flags", { p_tenant_id: TENANT_ID });
  if (error) throw new Error(error.message);
  return (data ?? { gmail: false, calendar: false }) as { gmail: boolean; calendar: boolean };
}

