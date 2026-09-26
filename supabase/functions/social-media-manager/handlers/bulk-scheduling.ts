import type { AuthContext } from "../context.ts";
import type { ContentFormat, SourceType } from "../types.ts";
import { listLibrary } from "./library.ts";
import {
  approvePublication, cancelPublication, createPublication, queuePublish, validatePublication,
} from "./publications.ts";
import { getPreferredScheduleConfig, type PreferredScheduleTimes } from "./settings.ts";

export type BulkScheduleSource = {
  sourceType: SourceType;
  sourceId: string;
};

export type BulkScheduleAssignment = BulkScheduleSource & {
  contentFormat: ContentFormat;
  title: string;
  scheduledFor: string;
  localDate: string;
  localTime: string;
};

export type BulkSchedulePreview = {
  timezone: string;
  preferredScheduleTimes: PreferredScheduleTimes;
  selectedCount: number;
  availableSlotCount: number;
  assignments: BulkScheduleAssignment[];
  unassigned: Array<BulkScheduleSource & { title: string; contentFormat: ContentFormat }>;
};

type AllocatableItem = BulkScheduleSource & {
  contentFormat: ContentFormat;
  title: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 30;
const MAX_DATES = 31;
const MIN_LEAD_MS = 60_000;

function sourceKey(sourceType: SourceType, sourceId: string) {
  return `${sourceType}:${sourceId}`;
}

function parseDateKey(key: string): Date {
  if (!DATE_PATTERN.test(key)) throw new Error(`Invalid calendar date: ${key}`);
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== key) throw new Error(`Invalid calendar date: ${key}`);
  return date;
}

function addDaysToKey(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function wallClockParts(instantMs: number, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function utcMinusWallMs(instantMs: number, timezone: string): number {
  const parts = wallClockParts(instantMs, timezone);
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return instantMs - wallAsUtc;
}

/** Converts a configured local wall-clock date/time to UTC without relying on the server's own timezone. */
export function zonedDateTimeToIso(dateKey: string, time: string, timezone: string): string {
  parseDateKey(dateKey);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Invalid preferred time: ${time}`);
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = guess + utcMinusWallMs(guess, timezone);
  const resolved = guess + utcMinusWallMs(firstPass, timezone);
  const check = wallClockParts(resolved, timezone);
  const roundTrip = `${String(check.year).padStart(4, "0")}-${String(check.month).padStart(2, "0")}-${String(check.day).padStart(2, "0")}|${String(check.hour).padStart(2, "0")}:${String(check.minute).padStart(2, "0")}`;
  if (roundTrip !== `${dateKey}|${time}`) throw new Error(`The local time ${dateKey} ${time} does not exist in ${timezone}.`);
  return new Date(resolved).toISOString();
}

function isoToLocalSlot(iso: string, timezone: string): { date: string; time: string } {
  const parts = wallClockParts(Date.parse(iso), timezone);
  return {
    date: `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

function slotKey(date: string, time: string) {
  return `${date}|${time}`;
}

function scheduleClass(format: ContentFormat): "short" | "longForm" {
  return format === "short" ? "short" : "longForm";
}

export function allocatePreferredSlots(
  items: AllocatableItem[],
  dates: string[],
  preferred: PreferredScheduleTimes,
  occupiedSlots: ReadonlySet<string>,
  timezone: string,
  nowMs = Date.now(),
): Pick<BulkSchedulePreview, "assignments" | "unassigned" | "availableSlotCount"> {
  const reserved = new Set(occupiedSlots);
  const assignmentsByKey = new Map<string, BulkScheduleAssignment>();
  const classes = new Set(items.map((item) => scheduleClass(item.contentFormat)));
  let availableSlotCount = 0;

  for (const group of ["short", "longForm"] as const) {
    if (!classes.has(group)) continue;
    const times = group === "short" ? preferred.short : preferred.longForm;
    const candidates: Array<{ date: string; time: string; scheduledFor: string }> = [];

    // Time is the outer loop by design: first slot across every selected day,
    // then the second slot across every selected day, so releases stay evenly spread.
    for (const time of times) {
      for (const date of dates) {
        const key = slotKey(date, time);
        if (reserved.has(key)) continue;
        const scheduledFor = zonedDateTimeToIso(date, time, timezone);
        if (Date.parse(scheduledFor) < nowMs + MIN_LEAD_MS) continue;
        candidates.push({ date, time, scheduledFor });
      }
    }

    availableSlotCount += candidates.length;
    const groupItems = items.filter((item) => scheduleClass(item.contentFormat) === group);
    for (let index = 0; index < groupItems.length && index < candidates.length; index += 1) {
      const item = groupItems[index];
      const candidate = candidates[index];
      const assignment: BulkScheduleAssignment = {
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        contentFormat: item.contentFormat,
        title: item.title,
        scheduledFor: candidate.scheduledFor,
        localDate: candidate.date,
        localTime: candidate.time,
      };
      assignmentsByKey.set(sourceKey(item.sourceType, item.sourceId), assignment);
      reserved.add(slotKey(candidate.date, candidate.time));
    }
  }

  const assignments = items
    .map((item) => assignmentsByKey.get(sourceKey(item.sourceType, item.sourceId)))
    .filter((assignment): assignment is BulkScheduleAssignment => Boolean(assignment));
  const unassigned = items
    .filter((item) => !assignmentsByKey.has(sourceKey(item.sourceType, item.sourceId)))
    .map((item) => ({ ...item }));

  return { assignments, unassigned, availableSlotCount };
}

function normalizeRequest(params: { items?: BulkScheduleSource[]; dates?: string[] }) {
  if (!Array.isArray(params.items) || params.items.length === 0) throw new Error("Select at least one video.");
  if (params.items.length > MAX_ITEMS) throw new Error(`Bulk scheduling is limited to ${MAX_ITEMS} videos at a time.`);
  if (!Array.isArray(params.dates) || params.dates.length === 0) throw new Error("Select at least one calendar day.");
  if (params.dates.length > MAX_DATES) throw new Error(`Select no more than ${MAX_DATES} calendar days at a time.`);

  const seen = new Set<string>();
  const items = params.items.map((item) => {
    if (!item || (item.sourceType !== "clip" && item.sourceType !== "project") || typeof item.sourceId !== "string") {
      throw new Error("One or more selected videos are invalid.");
    }
    const key = sourceKey(item.sourceType, item.sourceId);
    if (seen.has(key)) throw new Error("The same video was selected more than once.");
    seen.add(key);
    return { sourceType: item.sourceType, sourceId: item.sourceId };
  });

  const dates = [...new Set(params.dates.map((date) => {
    parseDateKey(date);
    return date;
  }))].sort();
  return { items, dates };
}

export async function previewBulkSchedule(
  auth: AuthContext,
  params: { items?: BulkScheduleSource[]; dates?: string[] },
  nowMs = Date.now(),
): Promise<BulkSchedulePreview> {
  const normalized = normalizeRequest(params);
  const [{ timezone, preferredScheduleTimes }, library] = await Promise.all([
    getPreferredScheduleConfig(auth),
    listLibrary(auth, {}),
  ]);

  const libraryByKey = new Map(library.map((item) => [sourceKey(item.sourceType, item.sourceId), item]));
  const resolved: AllocatableItem[] = normalized.items.map((requested) => {
    const item = libraryByKey.get(sourceKey(requested.sourceType, requested.sourceId));
    if (!item) throw new Error("One or more selected videos could not be found in your library.");
    if (!item.readiness.ready) throw new Error(`${item.title ?? item.guestName ?? "Selected video"} is not publish-ready: ${item.readiness.reasons[0] ?? "readiness check failed"}`);
    if (item.activePublication) throw new Error(`${item.title ?? item.guestName ?? "Selected video"} already has an active publication. Schedule or finish that publication individually.`);
    if (item.failedPublication) throw new Error(`${item.title ?? item.guestName ?? "Selected video"} has a failed publication. Use Retry instead of creating another publication.`);
    if (item.publishedPublication) throw new Error(`${item.title ?? item.guestName ?? "Selected video"} has already been published.`);
    if (!item.title?.trim()) throw new Error(`${item.guestName ?? "Selected video"} needs a title before it can be bulk scheduled.`);
    if (item.contentFormat === "short" && !item.thumbnailFileId) {
      throw new Error(`${item.title} needs a thumbnail before it can be scheduled.`);
    }
    return {
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      contentFormat: item.contentFormat,
      title: item.title.trim(),
    };
  });

  const rangeStart = zonedDateTimeToIso(normalized.dates[0], "00:00", timezone);
  const rangeEnd = zonedDateTimeToIso(addDaysToKey(normalized.dates[normalized.dates.length - 1], 1), "00:00", timezone);
  const { data: scheduledRows, error: scheduleError } = await auth.db
    .from("ai_operations_social_publications")
    .select("scheduled_for,status")
    .eq("tenant_id", auth.tenantId)
    .not("scheduled_for", "is", null)
    .gte("scheduled_for", rangeStart)
    .lt("scheduled_for", rangeEnd);
  if (scheduleError) throw new Error(scheduleError.message);

  const occupied = new Set<string>();
  for (const row of scheduledRows ?? []) {
    if (row.status === "cancelled" || row.status === "failed" || !row.scheduled_for) continue;
    const local = isoToLocalSlot(String(row.scheduled_for), timezone);
    occupied.add(slotKey(local.date, local.time));
  }

  const allocated = allocatePreferredSlots(
    resolved,
    normalized.dates,
    preferredScheduleTimes,
    occupied,
    timezone,
    nowMs,
  );

  return {
    timezone,
    preferredScheduleTimes,
    selectedCount: resolved.length,
    ...allocated,
  };
}

export async function bulkSchedulePublications(
  auth: AuthContext,
  params: { items?: BulkScheduleSource[]; dates?: string[] },
) {
  // Recompute immediately before writing so a stale browser preview cannot reserve an
  // already-used slot or use library state that changed after the preview was shown.
  const preview = await previewBulkSchedule(auth, params);
  if (preview.unassigned.length) {
    throw new Error(`Only ${preview.assignments.length} preferred slots are available for ${preview.selectedCount} selected videos. Select more days.`);
  }

  const created: Array<{ id: string; assignment: BulkScheduleAssignment }> = [];
  try {
    for (const assignment of preview.assignments) {
      const publication = await createPublication(auth, {
        sourceType: assignment.sourceType,
        ...(assignment.sourceType === "clip" ? { clipId: assignment.sourceId } : { projectId: assignment.sourceId }),
        deliveryMode: "scheduled",
        scheduledFor: assignment.scheduledFor,
      });
      created.push({ id: publication.id, assignment });
    }

    for (const entry of created) {
      const validation = await validatePublication(auth, { id: entry.id });
      if (!validation.ok) {
        throw new Error(`${entry.assignment.title} is not ready to schedule: ${validation.errors.join(" ")}`);
      }
    }

    for (const entry of created) await approvePublication(auth, { id: entry.id });

    const scheduled = [];
    for (const entry of created) {
      const queued = await queuePublish(auth, { id: entry.id });
      scheduled.push({
        sourceType: entry.assignment.sourceType,
        sourceId: entry.assignment.sourceId,
        title: entry.assignment.title,
        publicationId: entry.id,
        jobId: queued.jobId,
        scheduledFor: entry.assignment.scheduledFor,
      });
    }

    return { ...preview, scheduled };
  } catch (error) {
    // Nothing is intentionally deleted: cancelled rows preserve the audit trail. Best-effort
    // cleanup is safe only while a publication has not reached YouTube; cancelPublication
    // enforces that boundary.
    for (const entry of [...created].reverse()) {
      try {
        await cancelPublication(auth, { id: entry.id });
      } catch {
        // A worker may already have claimed a queued job. Do not mask the original failure.
      }
    }
    throw error;
  }
}
