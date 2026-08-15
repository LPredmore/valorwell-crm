// Versioned prompt + response-schema registry for AI Operations work items.
// Prompts never request or accept free-text clinical narrative.
import type { ThinkingLevel } from "./ai-ops-types.ts";

export type WorkTypeSpec = {
  workType: string;
  promptVersion: string;
  schemaVersion: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  thinkingLevel: ThinkingLevel;
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

const operationalConcernSchema = findingArraySchema(
  {
    concernType: { type: "string" },
    noConcern: { type: "boolean" },
    supportingSignals: { type: "array", items: { type: "string" } },
  },
  ["concernType", "noConcern"],
);

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
      "The signals in derivedSignals have already been calculated from ValorWell's source-of-truth data.",
      "Do not re-calculate them, second-guess them, or invent additional facts.",
      "Determine whether the combination of structured state and signals represents a meaningful operational problem.",
      "Identify the primary operational concern rather than listing every minor issue separately.",
      "Do not make clinical judgements and do not compare clients against one another.",
      "If there is no meaningful operational concern, return noConcern=true, severity low, and title No operational concern.",
      "Return exactly one result object per requested entityKey, in the same order. Return JSON only.",
    ].join(" "),
    responseSchema: operationalConcernSchema,
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
      "Deterministic code has already established response evidence, threading, business-day deadlines, deadline breach, and client linkage.",
      "Do not decide whether a service-level deadline was missed and do not guess whether an unrelated outbound message counts as a response.",
      "Decide only whether the latest inbound message reasonably requires a human response, what the intent is, and whether wording indicates a service-quality problem.",
      "If wording appears urgent or safety-related, set safetyRisk=true, severity critical, and say Requires urgent human review.",
      "Never diagnose, assign a clinical risk level, decide treatment, or treat yourself as the safety mechanism.",
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

  staff_service_quality_review: {
    workType: "staff_service_quality_review",
    promptVersion: "1",
    schemaVersion: "1",
    thinkingLevel: "high",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You review structured staff workflow metrics for a healthcare practice.",
      "The payload contains operational counts and deterministic warning signals only; it contains no clinical narrative and no staff names.",
      "Assess workflow and service-delivery risk, not personal worth or clinical competence.",
      "Treat derivedSignals as authoritative facts and use the surrounding counts only to understand operational context.",
      "Focus on overdue work, stale appointment state, documentation completion, and repeated service friction.",
      "Do not infer misconduct, intent, diagnosis, or employment action.",
      "If no meaningful operational issue is supported, return noConcern=true and severity low.",
      "Return exactly one result per entityKey and JSON only.",
    ].join(" "),
    responseSchema: operationalConcernSchema,
  },

  appointment_integrity_review: {
    workType: "appointment_integrity_review",
    promptVersion: "1",
    schemaVersion: "1",
    thinkingLevel: "high",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You review appointment integrity exceptions for a healthcare practice.",
      "Every derivedSignal was computed deterministically from source-of-truth appointment, note, and telehealth data.",
      "Do not dispute or recompute those signals. Determine the primary operational consequence and what a human should verify or correct.",
      "Do not make clinical judgements and do not infer that a session occurred merely because an appointment exists.",
      "Prioritize problems that can interrupt care, documentation, scheduling, or downstream billing.",
      "If no meaningful concern is supported, return noConcern=true and severity low.",
      "Return exactly one result per entityKey and JSON only.",
    ].join(" "),
    responseSchema: operationalConcernSchema,
  },

  billing_claims_review: {
    workType: "billing_claims_review",
    promptVersion: "1",
    schemaVersion: "1",
    thinkingLevel: "high",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You are an operations analyst reviewing structured billing and claim exceptions for a healthcare practice.",
      "The claim status, age, status-event count, reconciliation count, and derivedSignals are authoritative source data.",
      "Do not invent payer responses, denial reasons, payment amounts, or missing records.",
      "Identify the primary revenue-cycle problem and recommend the next operational review step.",
      "A rejected or denied claim or a long-stalled accepted claim should receive meaningful attention; severity must reflect the supplied evidence, not speculation.",
      "If no meaningful operational concern is supported, return noConcern=true and severity low.",
      "Return exactly one result per entityKey and JSON only.",
    ].join(" "),
    responseSchema: operationalConcernSchema,
  },

  data_quality_review: {
    workType: "data_quality_review",
    promptVersion: "1",
    schemaVersion: "1",
    thinkingLevel: "high",
    requiresEntityCoverage: true,
    systemInstruction: [
      "You review deterministic data-quality checks for a healthcare practice platform.",
      "Each entity represents one named check with an exact affected-record count and description.",
      "Do not infer any additional affected records or causes. Classify the operational impact of the observed inconsistency.",
      "Prioritize broken identity links, appointment integrity, billing identity, ownership gaps, and duplicate identities according to likely operational impact.",
      "Recommend investigation or correction of the data source; never fabricate an automatic repair.",
      "If the supplied count is zero, return noConcern=true and severity low.",
      "Return exactly one result per entityKey and JSON only.",
    ].join(" "),
    responseSchema: operationalConcernSchema,
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
      "Never give medical advice. If a comment suggests crisis or self-harm, classify it as crisis, set severity critical, and draft a reply that points to emergency resources only.",
      "Return exactly one result object per requested entityKey. Return JSON only.",
    ].join(" "),
    responseSchema: findingArraySchema(
      {
        classification: { type: "string", enum: ["crisis", "support_request", "question", "praise", "criticism", "spam", "other"] },
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
      "Do not discover new findings, change severity, or invent causes, names, or numbers.",
      "Tell leadership what most needs attention today, what changed since the prior business day, which important issues remain unresolved, which areas were explicitly checked and normal, and which areas had incomplete or unavailable data.",
      "Prioritize supplied critical and high findings; topFindings is authoritative detail.",
      "List an area under everythingNormal only when the payload explicitly reports that module or check as healthy.",
      "Never infer normality merely because no findings were supplied; unavailable or partial modules belong in gaps.",
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

export const MODULE_WORK_TYPES: Record<string, string> = {
  system_integrity: "system_integrity_triage",
  client_journey: "client_journey_review",
  communications: "communications_qa_review",
  staff_quality: "staff_service_quality_review",
  appointment_integrity: "appointment_integrity_review",
  billing_claims: "billing_claims_review",
  data_quality: "data_quality_review",
  youtube: "youtube_comment_review",
  executive_brief: "executive_brief_synthesis",
};

export function promptVersionForModule(module: string): string {
  const workType = MODULE_WORK_TYPES[module];
  if (!workType) throw new Error(`Unknown AI Operations module: ${module}`);
  return specFor(workType).promptVersion;
}
