import type { PublicationStatus } from "./types.ts";

/**
 * Single source of truth for the publication state machine. The CRM handlers, the
 * YouTube worker, and the reconciliation pass must only move a publication along an
 * edge listed here.
 *
 *   draft/ready --approve--> approved --queue--> upload_queued --claim--> uploading
 *   uploading --finalize--> uploaded (private) | scheduled (publishAt verified) | published
 *   scheduled --YouTube reports public--> published
 *   approved --metadata edit--> ready
 *   draft/ready/approved/upload_queued --cancel--> cancelled
 *   upload_queued/uploading --permanent failure--> failed --retry--> approved
 *   failed (never reached YouTube) --metadata edit--> ready
 */
export const PUBLICATION_TRANSITIONS: Record<PublicationStatus, readonly PublicationStatus[]> = {
  draft: ["approved", "cancelled"],
  ready: ["approved", "cancelled"],
  approved: ["ready", "upload_queued", "cancelled"],
  upload_queued: ["uploading", "failed", "cancelled"],
  uploading: ["uploaded", "scheduled", "published", "failed"],
  uploaded: [],
  scheduled: ["published"],
  published: [],
  failed: ["approved", "ready"],
  cancelled: [],
};

/** Statuses that hold a source's single active publication slot (mirrors the partial unique indexes). */
export const ACTIVE_STATUSES: readonly PublicationStatus[] = [
  "draft", "ready", "approved", "upload_queued", "uploading", "uploaded", "scheduled",
];

/** The worker (or YouTube) owns the metadata snapshot from here on. */
export const LOCKED_STATUSES: ReadonlySet<PublicationStatus> = new Set([
  "upload_queued", "uploading", "uploaded", "scheduled", "published",
]);

/** Nothing exists on YouTube yet in these states, so a CRM-only cancel is truthful. */
export const CANCELLABLE_STATUSES: readonly PublicationStatus[] = ["draft", "ready", "approved", "upload_queued"];

/** Schedule edits that never need a YouTube call because nothing has been uploaded. */
export const PRE_UPLOAD_RESCHEDULE_STATUSES: readonly PublicationStatus[] = ["draft", "ready", "approved"];

export function canTransition(from: PublicationStatus, to: PublicationStatus): boolean {
  return PUBLICATION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: PublicationStatus) {
  if (!canTransition(from as PublicationStatus, to)) {
    throw new Error(`Invalid publication transition: ${from} -> ${to}`);
  }
}
