import type { SupabaseClient } from "npm:@supabase/supabase-js@2.93.1";
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

async function processGmailMessage(
  admin: SupabaseClient,
  accessToken: string,
  messageId: string,
) {
  const metadata = await googleJson(metadataUrl(messageId, "metadata"), accessToken);
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
  if (decision.observationEnabled !== true || decision.matched !== true) {
    if (decision.ambiguous === true || decision.likelyRelationship === true) {
      const { error } = await admin.rpc("ingest_relationship_gmail_message", {
        p_tenant_id: TENANT_ID,
        p_gmail_message_id: messageId,
        p_gmail_thread_id: String(metadata.threadId ?? ""),
        p_headers: headers,
        p_from_email: from,
        p_to_emails: to,
        p_subject: subject,
        p_body: "",
        p_occurred_at: new Date(Number(metadata.internalDate ?? Date.now())).toISOString(),
        p_label_ids: Array.isArray(metadata.labelIds) ? metadata.labelIds : [],
      });
      if (error) throw new Error(error.message);
    }
    return { messageId, matched: false, ambiguous: decision.ambiguous === true };
  }
  const full = await googleJson(metadataUrl(messageId, "full"), accessToken);
  const fullPayload = (full.payload ?? {}) as Record<string, unknown>;
  const { data, error } = await admin.rpc("ingest_relationship_gmail_message", {
    p_tenant_id: TENANT_ID,
    p_gmail_message_id: messageId,
    p_gmail_thread_id: String(full.threadId ?? metadata.threadId ?? ""),
    p_headers: headerMap(fullPayload),
    p_from_email: from,
    p_to_emails: to,
    p_subject: subject,
    p_body: gmailBody(fullPayload),
    p_occurred_at: new Date(Number(full.internalDate ?? metadata.internalDate ?? Date.now())).toISOString(),
    p_label_ids: Array.isArray(full.labelIds) ? full.labelIds : [],
  });
  if (error) throw new Error(error.message);
  return { messageId, matched: true, result: data };
}

async function fullGmailReconciliation(
  admin: SupabaseClient,
  runtime: GoogleRuntime,
  accessToken: string,
) {
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ q: "newer_than:90d", maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      accessToken,
    );
    for (const item of (page.messages ?? []) as Array<{ id?: string }>) {
      if (item.id) messageIds.push(item.id);
      if (messageIds.length >= 500) break;
    }
    pageToken = messageIds.length < 500 && typeof page.nextPageToken === "string" ? page.nextPageToken : undefined;
  } while (pageToken);
  const results: unknown[] = [];
  for (const id of messageIds) results.push(await processGmailMessage(admin, accessToken, id));
  const profile = await googleJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken);
  if (String(profile.emailAddress ?? "").toLowerCase() !== GMAIL_MAILBOX) {
    throw new Error("Connected Gmail mailbox no longer matches info@valorwell.org.");
  }
  await updateState(admin, {
    p_connection_id: runtime.id,
    p_gmail_history_id: String(profile.historyId ?? ""),
    p_success: true,
    p_full_reconciliation: true,
  });
  return { mode: "full", processed: results.length, results };
}

export async function syncGmail(
  admin: SupabaseClient,
  notificationHistoryId?: string,
) {
  const runtime = await connectionRuntime(admin, "gmail");
  if (!runtime) return { skipped: true, reason: "gmail_not_connected" };
  if (runtime.googleAccountEmail.toLowerCase() !== GMAIL_MAILBOX) throw new Error("Gmail mailbox restriction failed.");
  const accessToken = await refreshGoogleAccessToken(runtime);
  const state = await syncState(admin, runtime.id);
  if (!state.gmailHistoryId) return fullGmailReconciliation(admin, runtime, accessToken);
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latestHistoryId = notificationHistoryId ?? state.gmailHistoryId;
  try {
    do {
      const params = new URLSearchParams({ startHistoryId: state.gmailHistoryId, historyTypes: "messageAdded", maxResults: "500" });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await googleJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`,
        accessToken,
      );
      for (const history of (page.history ?? []) as Array<Record<string, unknown>>) {
        for (const added of (history.messagesAdded ?? []) as Array<{ message?: { id?: string } }>) {
          if (added.message?.id) ids.add(added.message.id);
        }
      }
      latestHistoryId = String(page.historyId ?? latestHistoryId);
      pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : undefined;
    } while (pageToken);
  } catch (error) {
    if ((error as Error & { status?: number }).status === 404) {
      return fullGmailReconciliation(admin, runtime, accessToken);
    }
    throw error;
  }
  const results: unknown[] = [];
  for (const id of ids) results.push(await processGmailMessage(admin, accessToken, id));
  await updateState(admin, {
    p_connection_id: runtime.id,
    p_gmail_history_id: latestHistoryId,
    p_notification: Boolean(notificationHistoryId),
    p_success: true,
  });
  return { mode: "history", processed: results.length, historyId: latestHistoryId, results };
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
    p_gmail_history_id: String(watch.historyId ?? ""),
    p_gmail_watch_expiration: new Date(Number(watch.expiration)).toISOString(),
    p_success: true,
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

