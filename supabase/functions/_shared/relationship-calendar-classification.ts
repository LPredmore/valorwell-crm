/** Pure BTY calendar classification. A full recording is identified ONLY by the
 * StreamYard room; a pre-interview only by explicit intro/pre-interview wording
 * and the absence of that room. Anything else is not a BTY event. Completion is
 * never inferred from a calendar: a person confirms it in the CRM. */
export type BtyCalendarClassification = "bty_recording" | "bty_preinterview" | null;

const PREINTERVIEW = /\b(intro|introductory|introduction|pre[- ]?interview|discovery call)\b/i;

export function classifyBtyCalendarEvent(input: {
  streamyardPresent: boolean;
  summary?: string | null;
  description?: string | null;
}): BtyCalendarClassification {
  if (input.streamyardPresent) return "bty_recording";
  const text = `${input.summary ?? ""}\n${input.description ?? ""}`;
  return PREINTERVIEW.test(text) ? "bty_preinterview" : null;
}
