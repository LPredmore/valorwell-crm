/**
 * Pure planning rules for "Schedule Series": one Beyond The Yellow project per
 * Monday-Sunday week (America/Chicago), dispatched at 16:00 Central on the Friday before.
 * No I/O here so the rules are unit-testable; series.ts wires them to the database.
 */
import type { SocialMediaLibraryItem } from "../types.ts";
import {
  addDaysToKey, allocatePreferredSlots, isReusableBulkPublication, zonedDateTimeToIso,
} from "./bulk-scheduling.ts";
import type { PreferredScheduleTimes } from "./settings.ts";

export const SERIES_TIMEZONE = "America/Chicago";
/** Blocked series keep retrying readiness until this Monday-morning cutoff. */
export const SERIES_READINESS_CUTOFF_TIME = "06:00";
/** Series lifts the bulk scheduler's manual 30-video cap; a week has 35 preferred slots by default. */
export const SERIES_MAX_ITEMS = 60;

export type SeriesStatus =
  | "assigned" | "blocked" | "dispatching" | "queued" | "partially_scheduled"
  | "youtube_scheduled" | "complete" | "failed" | "cancelled";
export type SeriesItemStatus =
  | "planned" | "prepared" | "queued" | "youtube_scheduled" | "published" | "already_published" | "failed";

/** Week can still be changed/removed only before dispatch begins. */
export const SERIES_EDITABLE_STATUSES: readonly SeriesStatus[] = ["assigned", "blocked"];
export const SERIES_ACTIVE_STATUSES: readonly SeriesStatus[] = [
  "assigned", "blocked", "dispatching", "queued", "partially_scheduled", "youtube_scheduled",
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dayOfWeek(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isValidDateKey(key: unknown): key is string {
  if (typeof key !== "string" || !DATE_PATTERN.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === key;
}

export function isMondayKey(key: string): boolean {
  return isValidDateKey(key) && dayOfWeek(key) === 1;
}

/** Monday of the Monday-Sunday week containing a calendar date key. */
export function mondayWeekStart(key: string): string {
  const day = dayOfWeek(key);
  return addDaysToKey(key, day === 0 ? -6 : 1 - day);
}

/** Central calendar date of an instant. */
export function centralDateKeyOf(instantMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SERIES_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(instantMs));
}

export function currentCentralWeekStart(nowMs = Date.now()): string {
  return mondayWeekStart(centralDateKeyOf(nowMs));
}

/** 16:00 America/Chicago on the Friday before the assigned Monday (DST aware). */
export function seriesDispatchAt(weekStart: string): string {
  if (!isMondayKey(weekStart)) throw new Error(`Series week must start on a Monday: ${weekStart}`);
  return zonedDateTimeToIso(addDaysToKey(weekStart, -3), "16:00", SERIES_TIMEZONE);
}

export const SERIES_CUTOFF_MESSAGE = "Cutoff passed: this week can only be changed before 4:00 PM Central on the Friday before it.";

/** HARD cutoff: assign/change/remove only strictly before the week's Friday 16:00 Central dispatch_at. */
export function isPastSeriesCutoff(dispatchAt: string, nowMs: number): boolean {
  return nowMs >= Date.parse(dispatchAt);
}

/** The first Monday week whose Friday 4:00 PM cutoff is still in the future. */
export function firstAssignableWeekStart(nowMs: number): string {
  let week = currentCentralWeekStart(nowMs);
  while (isPastSeriesCutoff(seriesDispatchAt(week), nowMs)) week = addDaysToKey(week, 7);
  return week;
}

export function seriesReadinessCutoff(weekStart: string): string {
  return zonedDateTimeToIso(weekStart, SERIES_READINESS_CUTOFF_TIME, SERIES_TIMEZONE);
}

export function seriesWeekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(weekStart, index));
}

export function isSeriesDue(weekStart: string, nowMs: number): boolean {
  return nowMs >= Date.parse(seriesDispatchAt(weekStart));
}

export type SeriesProject = {
  id: string;
  organizationName: string | null;
  guestName: string | null;
  expectedPartCount: number | null;
  expectedShortCount: number | null;
};

export type SeriesPlanItem = {
  sourceType: "clip" | "project";
  sourceId: string;
  contentFormat: SocialMediaLibraryItem["contentFormat"];
  partNumber: number | null;
  title: string;
  sequence: number;
  /** schedule: create/reuse+queue. adopt: already in the YouTube pipeline, only tracked. */
  kind: "schedule" | "adopt" | "already_published";
  publicationId: string | null;
  scheduledFor: string | null;
  localDate: string | null;
  localTime: string | null;
};

export type SeriesPlan = {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  items: SeriesPlanItem[];
  counts: { shorts: number; parts: number; fullEpisode: number; toSchedule: number };
};

const IN_PIPELINE = new Set(["upload_queued", "uploading", "uploaded", "scheduled"]);

function label(item: SocialMediaLibraryItem) {
  if (item.contentFormat === "full_episode") return "Full episode";
  if (item.contentFormat === "long_form") return item.partNumber ? `Part ${item.partNumber}` : (item.title ?? "Long-form part");
  return item.title ? `Short "${item.title}"` : "A Short";
}

/**
 * Builds the complete, all-or-nothing plan for one project's week. Every current-revision,
 * non-superseded Part and Short (listLibrary already filters those) plus the full episode
 * when viable must be either already published, already in the YouTube pipeline, or
 * schedulable -- otherwise the whole series is blocked. Nothing is silently dropped.
 */
export function buildSeriesPlan(input: {
  project: SeriesProject;
  libraryItems: SocialMediaLibraryItem[];
  weekStart: string;
  preferred: PreferredScheduleTimes;
  occupiedSlots: ReadonlySet<string>;
  nowMs: number;
}): SeriesPlan {
  const { project, weekStart, preferred, occupiedSlots, nowMs } = input;
  const items = input.libraryItems.filter((item) => item.projectId === project.id);
  const blockers: string[] = [];
  const warnings: string[] = [];

  const full = items.find((item) => item.contentFormat === "full_episode") ?? null;
  const parts = items.filter((item) => item.contentFormat === "long_form")
    .sort((a, b) => (a.partNumber ?? Number.MAX_SAFE_INTEGER) - (b.partNumber ?? Number.MAX_SAFE_INTEGER));
  const shorts = items.filter((item) => item.contentFormat === "short");

  if (!parts.length && !shorts.length) blockers.push("This project has no current Parts or Shorts yet.");
  if (project.expectedPartCount !== null && parts.length < project.expectedPartCount) {
    blockers.push(`Only ${parts.length} of ${project.expectedPartCount} expected Parts are in the current revision; the video pipeline is not finished.`);
  }
  if (project.expectedShortCount !== null && shorts.length < project.expectedShortCount) {
    blockers.push(`Only ${shorts.length} of ${project.expectedShortCount} expected Shorts are in the current revision; the video pipeline is not finished.`);
  }
  const partNumbers = parts.map((part) => part.partNumber);
  if (partNumbers.some((n) => !Number.isInteger(n) || Number(n) <= 0)) blockers.push("Every Part needs a part number to keep chronological order.");
  if (new Set(partNumbers).size !== partNumbers.length) blockers.push("Two current Parts share the same part number.");

  const ordered: SocialMediaLibraryItem[] = [];
  if (full) {
    if (full.publishedPublication || full.activePublication || full.sourceFileId) ordered.push(full);
    else warnings.push("Full episode has no source file, so it is not part of this series.");
  }
  ordered.push(...parts, ...shorts);

  const planItems: SeriesPlanItem[] = [];
  ordered.forEach((item, index) => {
    const base = {
      sourceType: item.sourceType, sourceId: item.sourceId, contentFormat: item.contentFormat,
      partNumber: item.partNumber ?? null, title: (item.title ?? "").trim(), sequence: index,
    };
    if (item.publishedPublication && !item.activePublication) {
      planItems.push({ ...base, kind: "already_published", publicationId: item.publishedPublication.id,
        scheduledFor: item.publishedPublication.scheduledFor, localDate: null, localTime: null });
      return;
    }
    if (item.failedPublication) {
      blockers.push(`${label(item)} has a failed publication. Use Retry on it first.`);
      return;
    }
    const active = item.activePublication;
    if (active && IN_PIPELINE.has(active.status)) {
      planItems.push({ ...base, kind: "adopt", publicationId: active.id, scheduledFor: active.scheduledFor, localDate: null, localTime: null });
      return;
    }
    if (active && !isReusableBulkPublication(active)) {
      blockers.push(`${label(item)} is already being processed.`);
      return;
    }
    if (!item.readiness.ready) blockers.push(`${label(item)} is not ready: ${item.readiness.reasons[0] ?? "readiness check failed"}`);
    if (!base.title) blockers.push(`${label(item)} needs a title.`);
    if (item.sourceType === "clip" && !(item.description ?? "").trim()) blockers.push(`${label(item)} needs its YouTube description.`);
    if (!item.thumbnailFileId) blockers.push(`${label(item)} needs a thumbnail.`);
    if (!item.sourceFileId) blockers.push(`${label(item)} has no source video file.`);
    planItems.push({ ...base, kind: "schedule", publicationId: active?.id ?? null, scheduledFor: null, localDate: null, localTime: null });
  });

  const toSchedule = planItems.filter((item) => item.kind === "schedule");
  if (toSchedule.length > SERIES_MAX_ITEMS) blockers.push(`A series can schedule at most ${SERIES_MAX_ITEMS} videos.`);

  if (toSchedule.length && toSchedule.length <= SERIES_MAX_ITEMS) {
    // Full episode is first in item order, so it takes the earliest long-form slot (Monday morning).
    const allocated = allocatePreferredSlots(
      toSchedule.map((item) => ({
        sourceType: item.sourceType, sourceId: item.sourceId, projectId: project.id,
        contentFormat: item.contentFormat, partNumber: item.partNumber, title: item.title || item.sourceId,
      })),
      seriesWeekDates(weekStart), preferred, occupiedSlots, SERIES_TIMEZONE, nowMs,
    );
    if (allocated.unassigned.length) {
      blockers.push(`Only ${allocated.assignments.length} preferred time slots are free this week for ${toSchedule.length} videos. Add preferred times or free slots.`);
    }
    const byKey = new Map(allocated.assignments.map((a) => [`${a.sourceType}:${a.sourceId}`, a]));
    for (const item of toSchedule) {
      const slot = byKey.get(`${item.sourceType}:${item.sourceId}`);
      if (!slot) continue;
      item.scheduledFor = slot.scheduledFor;
      item.localDate = slot.localDate;
      item.localTime = slot.localTime;
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    items: planItems,
    counts: {
      shorts: shorts.length, parts: parts.length,
      fullEpisode: planItems.some((item) => item.contentFormat === "full_episode") ? 1 : 0,
      toSchedule: toSchedule.length,
    },
  };
}

export type TrackedPublication = {
  id: string;
  status: string;
  scheduledFor: string | null;
  errorMessage: string | null;
  youtubeSchedule: { apiStatus?: string; privacyStatus?: string | null; youtubePublishAt?: string | null } | null;
};

/** YouTube-verified means private on YouTube with publishAt equal to the intended time. */
export function isYoutubeVerifiedSchedule(publication: TrackedPublication): boolean {
  const schedule = publication.youtubeSchedule;
  if (publication.status !== "scheduled" || !schedule || schedule.apiStatus !== "verified") return false;
  if (schedule.privacyStatus !== "private" || !schedule.youtubePublishAt || !publication.scheduledFor) return false;
  return Math.abs(Date.parse(schedule.youtubePublishAt) - Date.parse(publication.scheduledFor)) < 60_000;
}

export function trackedItemStatus(publication: TrackedPublication | null | undefined): SeriesItemStatus {
  if (!publication) return "failed";
  if (publication.status === "published") return "published";
  if (publication.status === "failed" || publication.status === "cancelled") return "failed";
  if (isYoutubeVerifiedSchedule(publication)) return "youtube_scheduled";
  return "queued";
}

/** Aggregate series status after dispatch, from per-item statuses. */
export function aggregateSeriesStatus(statuses: SeriesItemStatus[]): SeriesStatus {
  if (!statuses.length) return "failed";
  const done = (s: SeriesItemStatus) => s === "published" || s === "already_published";
  if (statuses.every(done)) return "complete";
  if (statuses.every((s) => done(s) || s === "youtube_scheduled")) return "youtube_scheduled";
  if (statuses.some((s) => s === "failed" || s === "youtube_scheduled" || s === "published")) return "partially_scheduled";
  return "queued";
}
