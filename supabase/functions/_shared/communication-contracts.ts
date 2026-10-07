export const MESSAGE_CLASSES = [
  "ordinary_promotional",
  "ordinary_campaign_follow_up",
  "wait_path_ordinary",
  "necessary_scheduling",
  "active_care",
  "billing_insurance",
  "clinical_safety_legal",
  "transactional_account",
] as const;

export type MessageClass = (typeof MESSAGE_CLASSES)[number];

export function isMessageClass(value: unknown): value is MessageClass {
  return typeof value === "string"
    && (MESSAGE_CLASSES as readonly string[]).includes(value);
}

/**
 * Individual CRM SMS defaults only when the caller omits messageClass.
 * An explicit invalid value, including null, returns null so the HTTP
 * boundary can reject it instead of silently reclassifying the message.
 */
export function parseIndividualSmsMessageClass(value: unknown): MessageClass | null {
  if (value === undefined) return "necessary_scheduling";
  return isMessageClass(value) ? value : null;
}
