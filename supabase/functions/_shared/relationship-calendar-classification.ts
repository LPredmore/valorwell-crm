/** Pure BTY calendar classification (server-side, authoritative for ingest).
 * 1. Explicitly BTY ("Beyond The Yellow" / "BTY") AND explicit intro /
 *    introductory / pre-interview wording in title or description
 *    => pre-interview, EVEN WHEN the StreamYard room is present (intro calls use it).
 * 2. Otherwise the official StreamYard room => full recording.
 * 3. Otherwise not a BTY event. Generic "intro" without BTY is never classified.
 * Completion is never inferred from a calendar: a person confirms it in the CRM. */
export type BtyCalendarClassification = "bty_recording" | "bty_preinterview" | null;

const BTY = /\b(beyond\s+the\s+yellow|bty)\b/i;
const PREINTERVIEW =
  /\b(intro|introductory|introduction|pre[\s-]?interview|initial\s+discussion)\b/i;

export function classifyBtyCalendarEvent(input: {
  streamyardPresent: boolean;
  summary?: string | null;
  description?: string | null;
}): BtyCalendarClassification {
  const text = `${input.summary ?? ""}\n${input.description ?? ""}`;
  if (BTY.test(text) && PREINTERVIEW.test(text)) return "bty_preinterview";
  if (input.streamyardPresent) return "bty_recording";
  return null;
}
