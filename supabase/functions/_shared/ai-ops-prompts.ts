// Versioned prompt + response-schema registry for AI Operations work items.
// Prompts never request or accept free-text clinical narrative.

export type WorkTypeSpec = {
  workType: string;
  promptVersion: string;
  schemaVersion: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  /** When true, the result array must cover exactly the requested entity keys. */
  requiresEntityCoverage: boolean;
};

const severityEnum = ["critical", "high", "medium", "low"];

const findingArraySchema = (extraProperties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          entityKey: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          severity: { type: "string", enum: severityEnum },
          confidence: { type: "number" },
          recommendedAction: { type: "string" },
          ...extraProperties,
        },
        required: ["entityKey", "title", "severity", ...required],
      },
    },
  },
  required: ["results"],
});

export const WORK_TYPE_SPECS: Record<string, WorkTypeSpec> = {
  system_integrity_triage: {
    workType: "system_integrity_triage",
    promptVersion: "1",
    schemaVersion: "1",
    requiresEntityCoverage: false,
    systemInstruction: [
      "You are an operations reliability analyst for a healthcare practice platform.",
      "You are given deterministic monitoring results that have already been computed. Do not invent facts.",
      "Cluster related failures, judge operational impact, and rank what a human should look at first.",
      "If evidence is insufficient to judge an item, report severity 'low' and say the evidence was insufficient.",
      "Never recommend automatic remediation; recommendations are for humans.",
      "Return JSON only, matching the provided schema. Keep every field under 400 characters.",
    ].join(" "),
    responseSchema: {
      type: "object",
      properties: {
        clusters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              clusterKey: { type: "string" },
              title: { type: "string" },
              summary: { type: "string" },
              severity: { type: "string", enum: severityEnum },
              likelyCommonCause: { type: "string" },
              recommendedAction: { type: "string" },
              memberKeys: { type: "array", items: { type: "string" } },
            },
            required: ["clusterKey", "title", "severity", "memberKeys"],
          },
        },
      },
      required: ["clusters"],
    },
  },

  client_journey_review: {
    workType: "client_journey_review",
    promptVersion: "1",
    schemaVersion: "1",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You review structured client-journey operational data for a mental-health practice.",
      "Each entity is identified only by an opaque entityKey. You never receive names or clinical narrative.",
      "Judge only operational progression: stalled intake, missing next appointment, unassigned clinician,",
      "overdue documentation, insurance not verified, and long gaps since last contact.",
      "Do not infer clinical severity or make clinical judgements.",
      "Return exactly one result object per requested entityKey, in the same order.",
      "If nothing is wrong for an entity, return it with severity 'low' and title 'No operational concern'.",
      "Return JSON only, matching the provided schema.",
    ].join(" "),
    responseSchema: findingArraySchema(
      { concernType: { type: "string" }, noConcern: { type: "boolean" } },
      ["concernType"],
    ),
  },

  communications_qa_review: {
    workType: "communications_qa_review",
    promptVersion: "1",
    schemaVersion: "1",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You review inbound message threads for a healthcare practice to decide whether a staff response is required.",
      "Each thread is identified only by an opaque entityKey.",
      "Decide: does the latest inbound message require a human response, and how urgent is the intent?",
      "Do not decide whether a service-level deadline was missed; that is computed deterministically elsewhere.",
      "Flag any message that indicates safety risk as severity 'critical'.",
      "Return exactly one result object per requested entityKey.",
      "Return JSON only, matching the provided schema.",
    ].join(" "),
    responseSchema: findingArraySchema(
      {
        responseRequired: { type: "boolean" },
        intent: { type: "string" },
        safetyRisk: { type: "boolean" },
      },
      ["responseRequired"],
    ),
  },

  youtube_comment_review: {
    workType: "youtube_comment_review",
    promptVersion: "1",
    schemaVersion: "1",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You triage public YouTube comments for a veteran-focused nonprofit.",
      "Classify each comment and draft a short, warm, non-clinical suggested reply a human will review before posting.",
      "Never give medical advice. If a comment suggests crisis or self-harm, classify it as 'crisis',",
      "set severity 'critical', and draft a reply that points to emergency resources only.",
      "Return exactly one result object per requested entityKey. Return JSON only.",
    ].join(" "),
    responseSchema: findingArraySchema(
      {
        classification: {
          type: "string",
          enum: ["crisis", "support_request", "question", "praise", "criticism", "spam", "other"],
        },
        suggestedReply: { type: "string" },
      },
      ["classification"],
    ),
  },

  executive_brief_synthesis: {
    workType: "executive_brief_synthesis",
    promptVersion: "1",
    schemaVersion: "1",
    requiresEntityCoverage: false,
    systemInstruction: [
      "You write a concise daily executive brief for the leadership of a mental-health practice.",
      "You receive only aggregated, de-identified module output. Never invent numbers or names.",
      "State what needs a decision today, what is trending, and what is normal.",
      "If a module's data is missing, say so explicitly instead of implying everything is fine.",
      "Return JSON only, matching the provided schema.",
    ].join(" "),
    responseSchema: {
      type: "object",
      properties: {
        headline: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              heading: { type: "string" },
              body: { type: "string" },
              severity: { type: "string", enum: severityEnum },
              itemCount: { type: "integer" },
            },
            required: ["key", "heading", "body"],
          },
        },
        everythingNormal: { type: "array", items: { type: "string" } },
        gaps: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "sections"],
    },
  },
};

export function specFor(workType: string): WorkTypeSpec {
  const spec = WORK_TYPE_SPECS[workType];
  if (!spec) throw new Error(`Unknown AI Operations work type: ${workType}`);
  return spec;
}
