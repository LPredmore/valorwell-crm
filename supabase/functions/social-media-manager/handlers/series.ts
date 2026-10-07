import type { AuthContext } from "../context.ts";
import { requireMutate } from "../context.ts";
import type { SocialMediaLibraryItem } from "../types.ts";
import { isoToLocalSlot, zonedDateTimeToIso, addDaysToKey } from "./bulk-scheduling.ts";
import { listLibrary } from "./library.ts";
import {
  approvePublication, createPublication, getPublication, queuePublish, updatePublication, validatePublication,
} from "./publications.ts";
import { getPreferredScheduleConfig, type PreferredScheduleTimes } from "./settings.ts";
import {
  aggregateSeriesStatus, buildSeriesPlan, currentCentralWeekStart, isMondayKey, SERIES_ACTIVE_STATUSES,
  SERIES_EDITABLE_STATUSES, SERIES_TIMEZONE, seriesDispatchAt, seriesReadinessCutoff, trackedItemStatus,
  type SeriesItemStatus, type SeriesPlan, type SeriesProject, type SeriesStatus, type TrackedPublication,
} from "./series-core.ts";

const SCHEDULES = "ai_operations_video_series_schedules";
const ITEMS = "ai_operations_video_series_schedule_items";
const MAX_WEEKS = 26;
export const SERIES_CHUNK_SIZE = 6;
export const SERIES_ITEM_MAX_ATTEMPTS = 5;
const BLOCKED_RETRY_MS = 15 * 60_000;
const TRACK_INTERVAL_MS = 10 * 60_000;
const VERIFIED_TRACK_INTERVAL_MS = 30 * 60_000;
const ITEM_RETRY_MS = 2 * 60_000;

export type SeriesScheduleRow = {
  id: string; tenant_id: string; project_id: string; week_start: string; timezone: string;
  dispatch_at: string; status: SeriesStatus; attempt_count: number; lease_id: string | null;
  lease_expires_at: string | null; next_attempt_at: string | null; blocked_reasons: string[];
  last_error_code: string | null; last_error: string | null; unrecoverable: boolean;
  dispatch_started_at: string | null; queued_at: string | null; youtube_scheduled_at: string | null;
  completed_at: string | null; created_by: string | null; created_at: string; updated_at: string;
  last_checked_at: string | null;
};

export type SeriesItemRow = {
  id: string; schedule_id: string; tenant_id: string; source_type: "clip" | "project"; source_id: string;
  content_format: string; part_number: number | null; sequence: number; title: string | null;
  scheduled_for: string | null; local_date: string | null; local_time: string | null;
  publication_id: string | null; status: SeriesItemStatus; attempt_count: number; last_error: string | null;
  youtube_publish_at: string | null;
};

function friendlyDbError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") {
    if (error.message.includes("one_project_per_week")) return new Error("That week already has a project assigned.");
    if (error.message.includes("project_once")) return new Error("That project is already assigned to another week.");
  }
  return new Error(error.message);
}

async function loadProject(auth: AuthContext, projectId: string): Promise<SeriesProject> {
  if (typeof projectId !== "string" || !projectId) throw new Error("projectId is required.");
  const { data, error } = await auth.db.from("ai_operations_video_projects")
    .select("id, tenant_id, organization_name, guest_name, expected_part_count, expected_short_count")
    .eq("id", projectId).eq("tenant_id", auth.tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.tenant_id !== auth.tenantId) throw new Error("Project not found.");
  return {
    id: data.id, organizationName: data.organization_name, guestName: data.guest_name,
    expectedPartCount: data.expected_part_count ?? null, expectedShortCount: data.expected_short_count ?? null,
  };
}

async function loadSchedule(auth: AuthContext, id: string): Promise<SeriesScheduleRow> {
  if (typeof id !== "string" || !id) throw new Error("id is required.");
  const { data, error } = await auth.db.from(SCHEDULES).select("*").eq("id", id).eq("tenant_id", auth.tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Series schedule not found.");
  return data as SeriesScheduleRow;
}

async function occupiedSlotsForWeek(auth: AuthContext, weekStart: string, excludeProjectId?: string) {
  const start = zonedDateTimeToIso(weekStart, "00:00", SERIES_TIMEZONE);
  const end = zonedDateTimeToIso(addDaysToKey(weekStart, 7), "00:00", SERIES_TIMEZONE);
  const { data, error } = await auth.db.from("ai_operations_social_publications")
    .select("scheduled_for,status,project_id").eq("tenant_id", auth.tenantId)
    .not("scheduled_for", "is", null).gte("scheduled_for", start).lt("scheduled_for", end);
  if (error) throw new Error(error.message);
  const occupied = new Set<string>();
  for (const row of data ?? []) {
    if (row.status === "cancelled" || row.status === "failed" || !row.scheduled_for) continue;
    // A project's own pre-upload drafts are about to be rescheduled by the series itself.
    if (excludeProjectId && row.project_id === excludeProjectId && ["draft", "ready", "approved"].includes(row.status)) continue;
    const local = isoToLocalSlot(String(row.scheduled_for), SERIES_TIMEZONE);
    occupied.add(`${local.date}|${local.time}`);
  }
  return occupied;
}

/** Dry-run readiness plan (no writes). */
export async function computeSeriesPlan(auth: AuthContext, projectId: string, weekStart: string, nowMs = Date.now()): Promise<SeriesPlan & { preferredScheduleTimes: PreferredScheduleTimes }> {
  if (!isMondayKey(weekStart)) throw new Error("weekStart must be a Monday (YYYY-MM-DD).");
  const project = await loadProject(auth, projectId);
  const [{ preferredScheduleTimes }, library, occupied] = await Promise.all([
    getPreferredScheduleConfig(auth), listLibrary(auth, {}), occupiedSlotsForWeek(auth, weekStart, projectId),
  ]);
  const plan = buildSeriesPlan({ project, libraryItems: library, weekStart, preferred: preferredScheduleTimes, occupiedSlots: occupied, nowMs });
  return { ...plan, preferredScheduleTimes };
}

function summarizeSchedule(row: SeriesScheduleRow, project: { organization_name?: string | null; guest_name?: string | null } | undefined, items?: SeriesItemRow[]) {
  return {
    id: row.id, projectId: row.project_id, weekStart: row.week_start, timezone: row.timezone,
    dispatchAt: row.dispatch_at, status: row.status, organizationName: project?.organization_name ?? null,
    guestName: project?.guest_name ?? null, blockedReasons: row.blocked_reasons ?? [],
    lastError: row.last_error, lastErrorCode: row.last_error_code, unrecoverable: row.unrecoverable,
    dispatchStartedAt: row.dispatch_started_at, queuedAt: row.queued_at, youtubeScheduledAt: row.youtube_scheduled_at,
    completedAt: row.completed_at, nextAttemptAt: row.next_attempt_at, lastCheckedAt: row.last_checked_at,
    editable: SERIES_EDITABLE_STATUSES.includes(row.status) && !row.dispatch_started_at,
    items: items?.map((item) => ({
      id: item.id, sourceType: item.source_type, sourceId: item.source_id, contentFormat: item.content_format,
      partNumber: item.part_number, sequence: item.sequence, title: item.title, scheduledFor: item.scheduled_for,
      publicationId: item.publication_id, status: item.status, lastError: item.last_error,
    })),
  };
}

export async function listSeriesSchedules(auth: AuthContext, params: { fromWeek?: unknown; weeks?: unknown }, nowMs = Date.now()) {
  const current = currentCentralWeekStart(nowMs);
  const fromWeek = typeof params.fromWeek === "string" && isMondayKey(params.fromWeek) && params.fromWeek >= current ? params.fromWeek : current;
  const weeks = Math.min(MAX_WEEKS, Math.max(1, Number(params.weeks) || 8));
  const toWeek = addDaysToKey(fromWeek, 7 * (weeks - 1));

  const [{ data: rows, error }, { data: projects, error: projectError }, { data: active, error: activeError }] = await Promise.all([
    auth.db.from(SCHEDULES).select("*").eq("tenant_id", auth.tenantId).neq("status", "cancelled")
      .gte("week_start", fromWeek).lte("week_start", toWeek),
    auth.db.from("ai_operations_video_projects").select("id, organization_name, guest_name, created_at")
      .eq("tenant_id", auth.tenantId).not("organization_name", "is", null).order("created_at", { ascending: false }).limit(500),
    auth.db.from(SCHEDULES).select("project_id").eq("tenant_id", auth.tenantId).neq("status", "cancelled"),
  ]);
  if (error) throw new Error(error.message);
  if (projectError) throw new Error(projectError.message);
  if (activeError) throw new Error(activeError.message);

  const projectById = new Map((projects ?? []).map((p) => [p.id as string, p]));
  const assigned = new Set((active ?? []).map((row) => row.project_id as string));
  const scheduleRows = (rows ?? []) as SeriesScheduleRow[];
  const ids = scheduleRows.map((row) => row.id);
  const { data: itemRows, error: itemError } = ids.length
    ? await auth.db.from(ITEMS).select("*").eq("tenant_id", auth.tenantId).in("schedule_id", ids).order("sequence")
    : { data: [], error: null };
  if (itemError) throw new Error(itemError.message);
  const itemsBySchedule = new Map<string, SeriesItemRow[]>();
  for (const item of (itemRows ?? []) as SeriesItemRow[]) {
    const list = itemsBySchedule.get(item.schedule_id) ?? [];
    list.push(item);
    itemsBySchedule.set(item.schedule_id, list);
  }
  const byWeek = new Map(scheduleRows.map((row) => [row.week_start, row]));

  return {
    timezone: SERIES_TIMEZONE,
    currentWeekStart: current,
    canMutate: Boolean(auth.capabilities?.mutate),
    weeks: Array.from({ length: weeks }, (_, index) => {
      const weekStart = addDaysToKey(fromWeek, index * 7);
      const row = byWeek.get(weekStart);
      return {
        weekStart, dispatchAt: seriesDispatchAt(weekStart),
        schedule: row ? summarizeSchedule(row, projectById.get(row.project_id), itemsBySchedule.get(row.id) ?? []) : null,
      };
    }),
    eligibleProjects: (projects ?? []).filter((p) => !assigned.has(p.id as string)).map((p) => ({
      id: p.id as string, organizationName: p.organization_name as string, guestName: (p.guest_name as string | null) ?? null,
    })),
  };
}

export async function getSeriesSchedule(auth: AuthContext, params: { id: string }) {
  const row = await loadSchedule(auth, params.id);
  const { data: project } = await auth.db.from("ai_operations_video_projects").select("organization_name, guest_name")
    .eq("id", row.project_id).eq("tenant_id", auth.tenantId).maybeSingle();
  const { data: items, error } = await auth.db.from(ITEMS).select("*").eq("schedule_id", row.id).eq("tenant_id", auth.tenantId).order("sequence");
  if (error) throw new Error(error.message);
  return summarizeSchedule(row, project ?? undefined, (items ?? []) as SeriesItemRow[]);
}

export async function getSeriesReadiness(auth: AuthContext, params: { projectId: string; weekStart: string }) {
  return computeSeriesPlan(auth, params.projectId, params.weekStart);
}

function assertAssignableWeek(weekStart: unknown, nowMs: number): string {
  if (typeof weekStart !== "string" || !isMondayKey(weekStart)) throw new Error("weekStart must be a Monday (YYYY-MM-DD).");
  if (weekStart < currentCentralWeekStart(nowMs)) throw new Error("Past weeks cannot be scheduled.");
  if (nowMs >= Date.parse(seriesReadinessCutoff(weekStart))) throw new Error("This week has already started; choose an upcoming week.");
  return weekStart;
}

export async function assignSeriesSchedule(auth: AuthContext, params: { weekStart?: unknown; projectId?: unknown; requestKey?: unknown }, nowMs = Date.now()) {
  requireMutate(auth);
  const weekStart = assertAssignableWeek(params.weekStart, nowMs);
  const project = await loadProject(auth, String(params.projectId ?? ""));
  if (!project.organizationName) throw new Error("Only Beyond The Yellow organization projects can be scheduled as a series.");
  const requestKey = typeof params.requestKey === "string" && /^[A-Za-z0-9-]{8,64}$/.test(params.requestKey) ? params.requestKey : crypto.randomUUID();
  const idempotencyKey = `${auth.tenantId}:${weekStart}:${project.id}:${requestKey}`;

  const { data: existing } = await auth.db.from(SCHEDULES).select("id").eq("idempotency_key", idempotencyKey).eq("tenant_id", auth.tenantId).maybeSingle();
  if (existing) return getSeriesSchedule(auth, { id: existing.id });

  const { data, error } = await auth.db.from(SCHEDULES).insert({
    tenant_id: auth.tenantId, project_id: project.id, week_start: weekStart, timezone: SERIES_TIMEZONE,
    dispatch_at: seriesDispatchAt(weekStart), status: "assigned", idempotency_key: idempotencyKey,
    created_by: auth.userId || null, updated_by: auth.userId || null,
    provenance: { source: "crm_schedule_series", crmRole: auth.crmRole, assignedAt: new Date(nowMs).toISOString() },
  }).select("id").single();
  if (error) throw friendlyDbError(error);
  return getSeriesSchedule(auth, { id: data.id });
}

async function guardedEdit(auth: AuthContext, id: string, patch: Record<string, unknown>, nowMs: number) {
  const row = await loadSchedule(auth, id);
  if (!SERIES_EDITABLE_STATUSES.includes(row.status) || row.dispatch_started_at) {
    throw new Error("Dispatch has already begun for this week; it can no longer be changed or removed.");
  }
  if (row.lease_expires_at && Date.parse(row.lease_expires_at) > nowMs) {
    throw new Error("This week is being checked right now. Try again in a minute.");
  }
  const { data, error } = await auth.db.from(SCHEDULES).update({ ...patch, updated_by: auth.userId || null })
    .eq("id", id).eq("tenant_id", auth.tenantId).in("status", [...SERIES_EDITABLE_STATUSES]).is("dispatch_started_at", null)
    .select("id");
  if (error) throw friendlyDbError(error);
  if (!data?.length) throw new Error("This week changed while saving; reload and try again.");
}

export async function changeSeriesSchedule(auth: AuthContext, params: { id: string; projectId?: unknown }, nowMs = Date.now()) {
  requireMutate(auth);
  const project = await loadProject(auth, String(params.projectId ?? ""));
  if (!project.organizationName) throw new Error("Only Beyond The Yellow organization projects can be scheduled as a series.");
  await guardedEdit(auth, params.id, {
    project_id: project.id, status: "assigned", blocked_reasons: [], last_error: null, last_error_code: null,
    unrecoverable: false, next_attempt_at: null, attempt_count: 0,
  }, nowMs);
  return getSeriesSchedule(auth, { id: params.id });
}

export async function removeSeriesSchedule(auth: AuthContext, params: { id: string }, nowMs = Date.now()) {
  requireMutate(auth);
  await guardedEdit(auth, params.id, { status: "cancelled", cancelled_at: new Date(nowMs).toISOString() }, nowMs);
  return { id: params.id, status: "cancelled" as const };
}

// ---------------------------------------------------------------------------------------
// Dispatch processor (run by video-series-dispatcher with an automation AuthContext).
// ---------------------------------------------------------------------------------------

export type SeriesOps = {
  plan: (row: SeriesScheduleRow, nowMs: number) => Promise<SeriesPlan>;
  library: () => Promise<SocialMediaLibraryItem[]>;
  create: (item: SeriesItemRow) => Promise<string>;
  reschedule: (publicationId: string, scheduledFor: string) => Promise<void>;
  publicationStatus: (publicationId: string) => Promise<TrackedPublication | null>;
  validate: (publicationId: string) => Promise<{ ok: boolean; errors: string[] }>;
  approve: (publicationId: string) => Promise<void>;
  queue: (publicationId: string) => Promise<void>;
};

export type SeriesStore = {
  updateSchedule: (id: string, leaseId: string, patch: Record<string, unknown>, guard?: Record<string, unknown>) => Promise<boolean>;
  loadItems: (scheduleId: string) => Promise<SeriesItemRow[]>;
  insertItems: (rows: Record<string, unknown>[]) => Promise<void>;
  updateItem: (id: string, patch: Record<string, unknown>) => Promise<void>;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);

/** Creates/reuses, validates and approves one item's publication. Idempotent across crashes. */
async function prepareItem(item: SeriesItemRow, ops: SeriesOps, store: SeriesStore, libraryByKey: Map<string, SocialMediaLibraryItem>) {
  let publicationId = item.publication_id;
  if (!publicationId) {
    const libraryItem = libraryByKey.get(`${item.source_type}:${item.source_id}`);
    if (libraryItem?.publishedPublication && !libraryItem.activePublication) {
      await store.updateItem(item.id, { status: "already_published", publication_id: libraryItem.publishedPublication.id, last_error: null });
      return;
    }
    publicationId = libraryItem?.activePublication?.id ?? null;
    if (!publicationId) publicationId = await ops.create(item);
    await store.updateItem(item.id, { publication_id: publicationId });
  }
  const current = await ops.publicationStatus(publicationId);
  if (!current) throw new Error("Publication disappeared.");
  if (["upload_queued", "uploading", "uploaded", "scheduled", "published"].includes(current.status)) {
    await store.updateItem(item.id, { status: "queued", last_error: null });
    return;
  }
  if (current.status === "failed" || current.status === "cancelled") throw new Error(`Publication is ${current.status}.`);
  if (current.scheduledFor !== item.scheduled_for || current.status === "draft" || current.status === "ready") {
    if (current.scheduledFor !== item.scheduled_for) await ops.reschedule(publicationId, String(item.scheduled_for));
    const validation = await ops.validate(publicationId);
    if (!validation.ok) throw new Error(validation.errors.join(" "));
    await ops.approve(publicationId);
  }
  await store.updateItem(item.id, { status: "prepared", last_error: null });
}

export async function processSeriesSchedule(row: SeriesScheduleRow, leaseId: string, ops: SeriesOps, store: SeriesStore, nowMs = Date.now()) {
  const at = (ms: number) => new Date(ms).toISOString();
  const release = (patch: Record<string, unknown>, guard?: Record<string, unknown>) =>
    store.updateSchedule(row.id, leaseId, { ...patch, last_checked_at: at(nowMs), lease_id: null, lease_expires_at: null }, guard);

  if (!SERIES_ACTIVE_STATUSES.includes(row.status)) return release({});
  if (nowMs < Date.parse(row.dispatch_at)) return release({}); // Never act before the Friday-noon deadline.

  // 1) Planning: all-or-nothing readiness. Blocked weeks retry until Monday 06:00 Central.
  if (!row.dispatch_started_at) {
    let plan: SeriesPlan;
    try {
      plan = await ops.plan(row, nowMs);
    } catch (error) {
      return release({ status: "blocked", last_error: errorText(error), last_error_code: "PLAN_ERROR", next_attempt_at: at(nowMs + BLOCKED_RETRY_MS) });
    }
    if (!plan.ok) {
      const pastCutoff = nowMs >= Date.parse(seriesReadinessCutoff(row.week_start));
      return release(pastCutoff
        ? { status: "failed", unrecoverable: true, blocked_reasons: plan.blockers, last_error_code: "READINESS_DEADLINE_PASSED",
          last_error: "The series was still not ready by Monday 6:00 AM Central. Nothing was uploaded.", next_attempt_at: null }
        : { status: "blocked", blocked_reasons: plan.blockers, last_error_code: "NOT_READY",
          last_error: plan.blockers[0] ?? "Not ready", attempt_count: row.attempt_count + 1, next_attempt_at: at(nowMs + BLOCKED_RETRY_MS) });
    }
    // Freeze the plan; dispatch_started_at locks the week against edits (DB trigger enforces it).
    const started = await store.updateSchedule(row.id, leaseId,
      { status: "dispatching", dispatch_started_at: at(nowMs), blocked_reasons: [], last_error: null, last_error_code: null },
      { project_id: row.project_id, dispatch_started_at: null });
    if (!started) return release({});
    await store.insertItems(plan.items.map((item) => ({
      schedule_id: row.id, tenant_id: row.tenant_id, source_type: item.sourceType, source_id: item.sourceId,
      content_format: item.contentFormat, part_number: item.partNumber, sequence: item.sequence, title: item.title || null,
      scheduled_for: item.scheduledFor, local_date: item.localDate, local_time: item.localTime, publication_id: item.publicationId,
      status: item.kind === "already_published" ? "already_published" : item.kind === "adopt" ? "queued" : "planned",
    })));
    row = { ...row, status: "dispatching", dispatch_started_at: at(nowMs) };
  }

  const items = await store.loadItems(row.id);

  // 2) Preparation (create/reuse -> validate -> approve) in bounded chunks; nothing is queued
  //    until every item is prepared, so a bad item blocks the whole series before upload.
  if (row.status === "dispatching") {
    const planned = items.filter((item) => item.status === "planned");
    const failed = items.filter((item) => item.status === "failed");
    if (failed.length) {
      return release({ status: "failed", last_error_code: "ITEM_PREPARE_FAILED", unrecoverable: false,
        last_error: `${failed.length} video(s) could not be prepared: ${failed[0].last_error ?? ""}`, next_attempt_at: null });
    }
    if (planned.length) {
      const libraryByKey = new Map((await ops.library()).map((item) => [`${item.sourceType}:${item.sourceId}`, item]));
      for (const item of planned.slice(0, SERIES_CHUNK_SIZE)) {
        try {
          await prepareItem(item, ops, store, libraryByKey);
        } catch (error) {
          const attempts = item.attempt_count + 1;
          await store.updateItem(item.id, { attempt_count: attempts, last_error: errorText(error),
            ...(attempts >= SERIES_ITEM_MAX_ATTEMPTS ? { status: "failed" } : {}) });
        }
      }
      return release({ next_attempt_at: at(nowMs + (planned.length > SERIES_CHUNK_SIZE ? 0 : ITEM_RETRY_MS / 4)) });
    }
    const prepared = items.filter((item) => item.status === "prepared");
    for (const item of prepared.slice(0, SERIES_CHUNK_SIZE)) {
      try {
        await ops.queue(String(item.publication_id));
        await store.updateItem(item.id, { status: "queued", last_error: null });
      } catch (error) {
        const current = item.publication_id ? await ops.publicationStatus(item.publication_id).catch(() => null) : null;
        if (current && current.status !== "approved" && current.status !== "ready" && current.status !== "draft") {
          await store.updateItem(item.id, { status: "queued", last_error: null }); // queued by an earlier crashed run
          continue;
        }
        const attempts = item.attempt_count + 1;
        await store.updateItem(item.id, { attempt_count: attempts, last_error: errorText(error),
          ...(attempts >= SERIES_ITEM_MAX_ATTEMPTS ? { status: "failed" } : {}) });
      }
    }
    if (prepared.length > SERIES_CHUNK_SIZE || prepared.some((item) => item.attempt_count > 0)) {
      return release({ next_attempt_at: at(nowMs + (prepared.length > SERIES_CHUNK_SIZE ? 0 : ITEM_RETRY_MS)) });
    }
    const after = await store.loadItems(row.id);
    if (after.some((item) => item.status === "prepared" || item.status === "planned")) return release({ next_attempt_at: at(nowMs + ITEM_RETRY_MS) });
    return release({ status: "queued", queued_at: at(nowMs), next_attempt_at: at(nowMs + TRACK_INTERVAL_MS) });
  }

  // 3) Tracking: only YouTube-verified schedules count; complete when everything is live.
  const statuses: SeriesItemStatus[] = [];
  let firstError: string | null = null;
  for (const item of items) {
    if (item.status === "already_published" || item.status === "published") { statuses.push(item.status); continue; }
    const publication = item.publication_id ? await ops.publicationStatus(item.publication_id) : null;
    const status = trackedItemStatus(publication);
    const lastError = status === "failed" ? (publication?.errorMessage ?? `Publication is ${publication?.status ?? "missing"}.`) : null;
    if (lastError && !firstError) firstError = lastError;
    if (status !== item.status || lastError !== item.last_error) {
      await store.updateItem(item.id, { status, last_error: lastError,
        youtube_publish_at: publication?.youtubeSchedule?.youtubePublishAt ?? item.youtube_publish_at });
    }
    statuses.push(status);
  }
  const aggregate = aggregateSeriesStatus(statuses);
  return release({
    status: aggregate,
    last_error: firstError, last_error_code: firstError ? "ITEM_FAILED" : null,
    ...(aggregate === "youtube_scheduled" && !row.youtube_scheduled_at ? { youtube_scheduled_at: at(nowMs) } : {}),
    ...(aggregate === "complete" ? { completed_at: at(nowMs), next_attempt_at: null }
      : { next_attempt_at: at(nowMs + (aggregate === "youtube_scheduled" ? VERIFIED_TRACK_INTERVAL_MS : TRACK_INTERVAL_MS)) }),
  });
}

/** Wires the processor to the existing publication handlers for one tenant-scoped automation context. */
export function seriesOpsFor(auth: AuthContext): SeriesOps {
  return {
    plan: async (row, nowMs) => {
      if (row.tenant_id !== auth.tenantId) throw new Error("Tenant mismatch.");
      return computeSeriesPlan(auth, row.project_id, row.week_start, nowMs);
    },
    library: () => listLibrary(auth, {}),
    create: async (item) => {
      const publication = await createPublication(auth, {
        sourceType: item.source_type,
        ...(item.source_type === "clip" ? { clipId: item.source_id } : { projectId: item.source_id }),
        deliveryMode: "scheduled", scheduledFor: String(item.scheduled_for),
      });
      return publication.id;
    },
    reschedule: async (publicationId, scheduledFor) => {
      await updatePublication(auth, { id: publicationId, changes: { deliveryMode: "scheduled", scheduledFor, desiredPrivacyStatus: "public" } });
    },
    publicationStatus: async (publicationId) => {
      try {
        const publication = await getPublication(auth, { id: publicationId });
        return { id: publication.id, status: publication.status, scheduledFor: publication.scheduledFor,
          errorMessage: publication.errorMessage, youtubeSchedule: publication.youtubeSchedule };
      } catch {
        return null;
      }
    },
    validate: (publicationId) => validatePublication(auth, { id: publicationId }),
    // Automated review for THIS series only: approval is recorded against the operator who
    // assigned the week. Global require_review_before_publish is left untouched.
    approve: async (publicationId) => { await approvePublication(auth, { id: publicationId }); },
    queue: async (publicationId) => { await queuePublish(auth, { id: publicationId }); },
  };
}

export function seriesStoreFor(auth: AuthContext): SeriesStore {
  return {
    updateSchedule: async (id, leaseId, patch, guard = {}) => {
      let query = auth.db.from(SCHEDULES).update(patch).eq("id", id).eq("tenant_id", auth.tenantId).eq("lease_id", leaseId);
      for (const [key, value] of Object.entries(guard)) query = value === null ? query.is(key, null) : query.eq(key, value as string);
      const { data, error } = await query.select("id");
      if (error) throw new Error(error.message);
      return Boolean(data?.length);
    },
    loadItems: async (scheduleId) => {
      const { data, error } = await auth.db.from(ITEMS).select("*").eq("schedule_id", scheduleId).eq("tenant_id", auth.tenantId).order("sequence");
      if (error) throw new Error(error.message);
      return (data ?? []) as SeriesItemRow[];
    },
    insertItems: async (rows) => {
      if (!rows.length) return;
      const { error } = await auth.db.from(ITEMS).upsert(rows, { onConflict: "schedule_id,source_type,source_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    },
    updateItem: async (id, patch) => {
      const { error } = await auth.db.from(ITEMS).update(patch).eq("id", id).eq("tenant_id", auth.tenantId);
      if (error) throw new Error(error.message);
    },
  };
}
