// Versioned prompt + response-schema registry for AI Operations work items.
// Prompts never request or accept free-text clinical narrative.
import type { ThinkingLevel } from "./ai-ops-types.ts";

export type WorkTypeSpec = {
  workType: string;
  promptVersion: string;
  schemaVersion: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  /** Reasoning effort requested from Gemini Flash for this work type. */
  thinkingLevel: ThinkingLevel;
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
    thinkingLevel: "medium",
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
    promptVersion: "2",
    schemaVersion: "1",
    thinkingLevel: "high",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You are reviewing structured operational state plus deterministic warning signals for clients of a mental-health practice.",
      "Each entity is identified only by an opaque entityKey. You never receive names or clinical narrative.",
      "The signals in 'derivedSignals' have already been calculated from ValorWell's source-of-truth data.",
      "Do not re-calculate them, do not second-guess them, and do not invent additional facts.",
      "Determine whether the combination of structured state and signals represents a meaningful operational problem.",
      "Identify the PRIMARY operational concern rather than listing every minor issue separately;",
      "when several signals share one underlying problem, describe that single problem and name the supporting signals.",
      "Use the signals as evidence but consider the full structured state.",
      "Do not make clinical judgements and do not compare clients against one another.",
      "If there is no meaningful operational concern, return that entity with noConcern=true, severity 'low',",
      "and title 'No operational concern'.",
      "Return exactly one result object per requested entityKey, in the same order. Return JSON only.",
    ].join(" "),
    responseSchema: findingArraySchema(
      {
        concernType: { type: "string" },
        noConcern: { type: "boolean" },
        supportingSignals: { type: "array", items: { type: "string" } },
      },
      ["concernType", "noConcern"],
    ),
  },

  communications_qa_review: {
    workType: "communications_qa_review",
    promptVersion: "2",
    schemaVersion: "1",
    thinkingLevel: "medium",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You review inbound client communications for a healthcare practice to decide whether a staff response is required.",
      "Each thread is identified only by an opaque entityKey.",
      "Deterministic code has already established response evidence, threading, business-day deadlines, deadline breach,",
      "and client linkage; those values are given to you in the payload and in 'derivedSignals'.",
      "Do not decide whether a service-level deadline was missed and do not guess whether an unrelated outbound message",
      "counts as a response.",
      "Decide only: does the latest inbound message reasonably require a human response, what is the intent,",
      "and does the wording indicate a service-quality problem worth a human's attention.",
      "If the wording appears urgent or safety-related, set safetyRisk=true, severity 'critical', and say",
      "'Requires urgent human review.' Never diagnose, never assign clinical risk level, never decide treatment,",
      "and never treat yourself as the safety mechanism.",
      "Return exactly one result object per requested entityKey. Return JSON only.",
    ].join(" "),
    responseSchema: findingArraySchema(
      {
        responseRequired: { type: "boolean" },
        intent: { type: "string" },
        safetyRisk: { type: "boolean" },
        serviceQualityPattern: { type: "string" },
      },
      ["responseRequired"],
    ),
  },


  youtube_comment_review: {
    workType: "youtube_comment_review",
    promptVersion: "1",
    schemaVersion: "1",
    thinkingLevel: "medium",
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
    promptVersion: "2",
    schemaVersion: "1",
    thinkingLevel: "high",
    requiresEntityCoverage: false,
    systemInstruction: [
      "You write a concise daily executive brief for the leadership of a mental-health practice.",
      "You are synthesizing already-computed operational findings and coverage information, ranked deterministically.",
      "Do not discover new findings, do not change severity, and do not invent causes, names, or numbers.",
      "Tell leadership: (1) what most needs attention today, (2) what changed since the prior business day,",
      "(3) which important issues remain unresolved, (4) which areas were explicitly checked and were normal,",
      "and (5) which areas had incomplete or unavailable data.",
      "Prioritize the supplied critical and high findings; treat 'topFindings' as the authoritative detail.",
      "List an area under everythingNormal only when the payload explicitly reports that module or check as healthy.",
      "Never infer that an area is normal merely because no findings were supplied; unavailable or partial modules",
      "belong in gaps instead.",
      "Keep the brief concise and actionable. Return JSON only, matching the provided schema.",
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
