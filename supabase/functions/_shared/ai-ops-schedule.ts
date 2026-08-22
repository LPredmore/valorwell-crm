export type DispatcherAction = "initialize" | "rebuild" | "collect" | "integrity" | "youtube" | "reconcile" | "brief" | "retry" | "finalize";

/**
 * Resolve the dispatcher action for an America/Chicago HH:mm clock value.
 * Exact daily phases take precedence. Outside those phases, System Integrity
 * refreshes every 15 minutes beginning at 03:30.
 */
export function dispatcherActionFor(localTime: string): DispatcherAction | null {
  switch (localTime) {
    case "03:15": return "initialize";
    case "03:20": return "collect";
    case "04:10": return "youtube";
    case "04:30": return "reconcile";
    case "04:35": return "brief";
    case "04:45": return "retry";
    case "04:50": return "finalize";
  }

  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 3 || (hour === 3 && minute < 30)) return null;
  return minute % 15 === 0 ? "integrity" : null;
}
