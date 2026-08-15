// Shared logic for the Beyond The Yellow automated prospect discovery workflow.
// Pure helpers here are unit-tested from src/test/bty-*.test.ts.

export const BTY_TENANT_ID = "00000000-0000-0000-0000-000000000001";
export const BTY_GEMINI_MODEL = "gemini-2.5-flash";
export const BTY_FAILURE_RECIPIENT = "info@valorwell.org";
export const BTY_SOURCE = "bty_automated_research";
export const BTY_TARGET_COUNT = 5;

export const BTY_ROTATION_STATES = [
  "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY",
  "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
] as const;

export const BTY_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};

export type SubscriberTier = { tier: number; min: number; max: number | null; label: string };

export const BTY_SUBSCRIBER_TIERS: SubscriberTier[] = [
  { tier: 1, min: 500, max: 5000, label: "500-5,000 subscribers (preferred)" },
  { tier: 2, min: 250, max: 10000, label: "250-10,000 subscribers" },
  { tier: 3, min: 100, max: 25000, label: "100-25,000 subscribers" },
  { tier: 4, min: 0, max: null, label: "any verifiable official subscriber count" },
];

export const BTY_PREFERRED_MIN = 500;
export const BTY_PREFERRED_MAX = 5000;

export function nextRotationState(state: string): string {
  const normalized = (state ?? "").trim().toUpperCase();
  const index = (BTY_ROTATION_STATES as readonly string[]).indexOf(normalized);
  if (index < 0) return BTY_ROTATION_STATES[0];
  if (index >= BTY_ROTATION_STATES.length - 1) return BTY_ROTATION_STATES[0];
  return BTY_ROTATION_STATES[index + 1];
}

export function tierForAttempt(tier: number): SubscriberTier {
  const found = BTY_SUBSCRIBER_TIERS.find((entry) => entry.tier === tier);
  return found ?? BTY_SUBSCRIBER_TIERS[BTY_SUBSCRIBER_TIERS.length - 1];
}

export function subscriberCountFitsTier(count: number, tier: number): boolean {
  const range = tierForAttempt(tier);
  if (!Number.isFinite(count) || count <= 0) return false;
  if (count < range.min) return false;
  if (range.max !== null && count > range.max) return false;
  return true;
}

export function preferenceDistance(count: number): number {
  if (count < BTY_PREFERRED_MIN) return BTY_PREFERRED_MIN - count;
  if (count > BTY_PREFERRED_MAX) return count - BTY_PREFERRED_MAX;
  return 0;
}

export function normalizeDomain(value?: string | null): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const stripped = raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/(\/.*)?$/, "");
  return stripped || null;
}

export function normalizeYoutubeUrl(value?: string | null): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const base = raw
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.|m\.)/, "")
    .replace(/\/+$/, "");
  const withoutQuery = (segment: string) => segment.replace(/\?.*$/, "");
  const parts = base.split("/");
  if (base.startsWith("youtube.com/channel/")) return `channel:${withoutQuery(parts[2] ?? "")}`;
  if (base.startsWith("youtube.com/@")) return `handle:${withoutQuery((parts[1] ?? "").replace("@", ""))}`;
  if (base.startsWith("youtube.com/c/") || base.startsWith("youtube.com/user/")) {
    return `handle:${withoutQuery(parts[2] ?? "")}`;
  }
  return `url:${withoutQuery(base)}`;
}

export function normalizeOrgName(value?: string | null): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const normalized = raw
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the\s+/, "")
    .replace(/\s+(inc|llc|incorporated|corp|corporation|foundation|org)$/, "")
    .trim();
  return normalized || null;
}

export function youtubeHandle(url?: string | null): string | null {
  const normalized = normalizeYoutubeUrl(url);
  if (!normalized) return null;
  if (normalized.startsWith("handle:")) return normalized.slice("handle:".length);
  return null;
}

export type Candidate = {
  organization_name?: string;
  headquarters_city?: string;
  headquarters_state?: string;
  website_url?: string;
  organization_kind?: string;
  youtube_channel_url?: string;
  youtube_handle?: string;
  youtube_subscriber_count?: number | string;
  subscriber_count_source?: string;
  subscriber_count_observed_at?: string;
  direct_services_summary?: string;
  why_bty_candidate?: string;
  evidence_urls?: string[];
  subscriber_range_tier?: number;
  confidence?: number | string;
  [key: string]: unknown;
};

export type ValidationOutcome = {
  accepted: Candidate[];
  rejected: { candidate: Candidate; reason: string }[];
};

export function centralBusinessDate(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

export function centralLocalTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

const REFERRAL_ONLY_PATTERNS = [
  /\bonly (?:provides|offers) referrals?\b/i,
  /\bexclusively (?:a )?(?:referral|navigation|resource)\b/i,
  /\bresource (?:directory|database)\b/i,
  /\breferral network\b/i,
  /\bumbrella organization\b/i,
  /\bgrantmaking\b/i,
  /\bgrant-?making\b/i,
  /\bfunds other (?:nonprofits|organizations)\b/i,
  /\bawareness campaign\b/i,
  /\badvocacy only\b/i,
];

const DIRECT_SERVICE_PATTERNS = [
  /housing/i, /food/i, /transport/i, /employment/i, /job/i, /mental health/i, /counsel/i,
  /peer support/i, /famil/i, /legal/i, /emergency/i, /financial assistance/i, /rehabilitat/i,
  /adaptive/i, /recreation/i, /community program/i, /transition/i, /casework/i, /case management/i,
  /wellness/i, /therap/i, /clinic/i, /shelter/i, /training/i, /education program/i, /retreat/i,
  /service dog/i, /equine/i, /respite/i, /benefit(?:s)? claim/i,
];

export function describesDirectService(summary?: string | null): boolean {
  const text = (summary ?? "").trim();
  if (text.length < 40) return false;
  if (REFERRAL_ONLY_PATTERNS.some((pattern) => pattern.test(text))
    && !DIRECT_SERVICE_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  if (/^supports veterans\.?$/i.test(text)) return false;
  return DIRECT_SERVICE_PATTERNS.some((pattern) => pattern.test(text));
}

export function parseSubscriberCount(value: unknown): number {
  if (typeof value === "number") return Math.floor(value);
  if (typeof value === "string") {
    const cleaned = value.replace(/[,\s]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return Number.NaN;
}

export type ValidationContext = {
  targetState: string;
  tier: number;
  /** Normalized names already accepted or rejected earlier in this run. */
  seenNames: Set<string>;
  /** Normalized keys of every organization that already exists in the CRM. */
  duplicateVerdicts?: Map<string, string>;
};

/** Validates Gemini candidates against every backend rule. Pure and unit-tested. */
export function validateCandidates(candidates: Candidate[], context: ValidationContext): ValidationOutcome {
  const accepted: Candidate[] = [];
  const rejected: { candidate: Candidate; reason: string }[] = [];
  const batchNames = new Set<string>();
  const batchDomains = new Set<string>();
  const batchChannels = new Set<string>();

  const ranked = [...candidates].sort((a, b) => {
    const aCount = parseSubscriberCount(a.youtube_subscriber_count);
    const bCount = parseSubscriberCount(b.youtube_subscriber_count);
    const aScore = Number.isFinite(aCount) ? preferenceDistance(aCount) : Number.MAX_SAFE_INTEGER;
    const bScore = Number.isFinite(bCount) ? preferenceDistance(bCount) : Number.MAX_SAFE_INTEGER;
    return aScore - bScore;
  });

  for (const candidate of ranked) {
    const name = (candidate.organization_name ?? "").trim();
    const normalizedName = normalizeOrgName(name);
    const state = (candidate.headquarters_state ?? "").trim().toUpperCase();
    const domain = normalizeDomain(candidate.website_url);
    const channel = normalizeYoutubeUrl(candidate.youtube_channel_url);
    const subscribers = parseSubscriberCount(candidate.youtube_subscriber_count);
    const reject = (reason: string) => rejected.push({ candidate, reason });

    if (!normalizedName) { reject("missing_name"); continue; }
    if (state !== context.targetState.toUpperCase()) { reject("headquarters_state_mismatch"); continue; }
    if (!domain) { reject("missing_website"); continue; }
    if (!channel) { reject("missing_youtube_channel"); continue; }
    if (!Number.isFinite(subscribers) || subscribers <= 0) { reject("missing_subscriber_count"); continue; }
    if (!subscriberCountFitsTier(subscribers, context.tier)) { reject("subscriber_count_outside_tier"); continue; }
    if (!(candidate.subscriber_count_source ?? "").trim()) { reject("missing_subscriber_evidence"); continue; }
    if (!describesDirectService(candidate.direct_services_summary)) { reject("no_direct_service_evidence"); continue; }
    if (!Array.isArray(candidate.evidence_urls) || candidate.evidence_urls.length === 0) {
      reject("missing_supporting_evidence"); continue;
    }
    if (context.seenNames.has(normalizedName)) { reject("already_evaluated_this_run"); continue; }
    if (batchNames.has(normalizedName) || (domain && batchDomains.has(domain))
      || (channel && batchChannels.has(channel))) {
      reject("duplicate_within_candidate_set"); continue;
    }
    const dbVerdict = context.duplicateVerdicts?.get(normalizedName);
    if (dbVerdict) { reject(dbVerdict); continue; }

    batchNames.add(normalizedName);
    if (domain) batchDomains.add(domain);
    if (channel) batchChannels.add(channel);
    accepted.push({
      ...candidate,
      organization_name: name,
      headquarters_state: state,
      youtube_subscriber_count: subscribers,
      youtube_handle: candidate.youtube_handle ?? youtubeHandle(candidate.youtube_channel_url) ?? undefined,
      subscriber_range_tier: context.tier,
    });
  }

  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  readonly kind: "timeout" | "rate_limited" | "invalid_response" | "grounding_failed" | "api_error";
  constructor(kind: GeminiError["kind"], message: string) {
    super(message);
    this.kind = kind;
    this.name = "GeminiError";
  }
}

export type GeminiRequest = {
  prompt: string;
  schema: Record<string, unknown>;
  model?: string;
  timeoutMs?: number;
};

/** Environment lookup that also type-checks outside the Deno runtime (unit tests). */
function envValue(name: string): string | undefined {
  const runtime = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
  return runtime?.env.get(name);
}

export async function callGemini<T>({ prompt, schema, model = BTY_GEMINI_MODEL, timeoutMs = 120_000 }: GeminiRequest): Promise<T> {
  const key = envValue("GEMINI_API_KEY");
  if (!key) throw new GeminiError("api_error", "GEMINI_API_KEY is not configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });
  } catch (error) {
    clearTimeout(timer);
    if ((error as Error).name === "AbortError") throw new GeminiError("timeout", "Gemini request timed out.");
    throw new GeminiError("api_error", (error as Error).message);
  }
  clearTimeout(timer);

  if (response.status === 429) throw new GeminiError("rate_limited", "Gemini rate limit reached.");
  if (!response.ok) {
    const body = await response.text();
    throw new GeminiError("api_error", `Gemini responded ${response.status}: ${body.slice(0, 600)}`);
  }

  const payload = await response.json().catch(() => null) as Record<string, any> | null;
  const candidate = payload?.candidates?.[0];
  const text: string | undefined = candidate?.content?.parts
    ?.map((part: Record<string, unknown>) => part.text)
    .filter((value: unknown): value is string => typeof value === "string")
    .join("");
  if (!text) throw new GeminiError("invalid_response", "Gemini returned no structured content.");

  const grounded = Boolean(candidate?.groundingMetadata ?? candidate?.grounding_metadata);
  try {
    const parsed = JSON.parse(text) as T;
    if (!grounded) {
      console.log(JSON.stringify({ component: "bty", event: "grounding_missing", model }));
    }
    return parsed;
  } catch {
    throw new GeminiError("invalid_response", "Gemini structured output was not valid JSON.");
  }
}

export const DISCOVERY_SCHEMA = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          organization_name: { type: "string" },
          headquarters_city: { type: "string" },
          headquarters_state: { type: "string" },
          website_url: { type: "string" },
          organization_kind: { type: "string" },
          youtube_channel_url: { type: "string" },
          youtube_handle: { type: "string" },
          youtube_subscriber_count: { type: "integer" },
          subscriber_count_source: { type: "string" },
          subscriber_count_observed_at: { type: "string" },
          direct_services_summary: { type: "string" },
          why_bty_candidate: { type: "string" },
          evidence_urls: { type: "array", items: { type: "string" } },
          subscriber_range_tier: { type: "integer" },
          confidence: { type: "number" },
        },
        required: [
          "organization_name", "headquarters_state", "website_url", "youtube_channel_url",
          "youtube_subscriber_count", "subscriber_count_source", "direct_services_summary",
          "why_bty_candidate", "evidence_urls",
        ],
      },
    },
  },
  required: ["candidates"],
} as const;

export const CONTACT_SCHEMA = {
  type: "object",
  properties: {
    first_name: { type: "string" },
    last_name: { type: "string" },
    full_name: { type: "string" },
    title: { type: "string" },
    email: { type: "string" },
    linkedin_url: { type: "string" },
    phone: { type: "string" },
    other_contact_method: { type: "string" },
    why_this_person: { type: "string" },
    evidence_urls: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    verified: { type: "boolean" },
  },
  required: ["full_name", "why_this_person", "evidence_urls"],
} as const;

export const DIRECT_SERVICE_DEFINITION = `Direct service means the organization ITSELF performs meaningful, boots-on-the-ground work for veterans and/or military families. Qualifying work includes housing, food assistance, transportation, employment programs, mental-health support, peer support, family programs, legal services, emergency assistance, financial assistance, rehabilitation, adaptive recreation, community programming, veteran transition assistance, direct casework and direct wellness programs. Referral or navigation activity may exist but must not be the organization's only meaningful work.`;

export const EXCLUSION_DEFINITION = `Exclude organizations whose primary purpose is merely: connecting veterans with other organizations, maintaining resource directories, referral networks without meaningful direct service, grantmaking, funding other nonprofits without doing the work themselves, general awareness campaigns, advocacy without meaningful direct service delivery, umbrella organizations that primarily coordinate other providers, or organizations whose veteran services cannot be verified.`;

export function buildDiscoveryPrompt(input: {
  targetState: string;
  tier: SubscriberTier;
  stateOrganizations: string[];
  allOrganizationNames: string[];
  rejectedThisRun: string[];
}): string {
  const stateName = BTY_STATE_NAMES[input.targetState] ?? input.targetState;
  return [
    `You are researching candidate organizations for ValorWell's "Beyond The Yellow" veteran storytelling initiative.`,
    `Use Google Search grounding for every factual claim. Never guess.`,
    ``,
    `TARGET STATE: ${stateName} (${input.targetState}). Every candidate must be HEADQUARTERED in ${stateName}.`,
    `PREFERRED YOUTUBE RANGE: 500-5,000 subscribers.`,
    `CURRENT PERMITTED RANGE (relaxation tier ${input.tier.tier}): ${input.tier.label}.`,
    `Prioritise candidates closest to 500-5,000 subscribers even when a wider range is permitted.`,
    ``,
    `DIRECT SERVICE REQUIREMENT: ${DIRECT_SERVICE_DEFINITION}`,
    `EXCLUSIONS: ${EXCLUSION_DEFINITION}`,
    `For each candidate answer explicitly: what does this organization itself actually do for veterans or their families? A vague statement such as "supports veterans" is insufficient and will be rejected.`,
    ``,
    `YOUTUBE REQUIREMENT: the channel must be the organization's own official YouTube channel — not a person, news outlet, partner, or topic channel. The subscriber count must come from actual research with a source URL and an observation date.`,
    ``,
    `Existing ${stateName} organizations — DO NOT RETURN:`,
    input.stateOrganizations.length ? input.stateOrganizations.map((name) => `- ${name}`).join("\n") : "- (none)",
    ``,
    `Organizations already tracked anywhere in the CRM — DO NOT RETURN:`,
    input.allOrganizationNames.length
      ? input.allOrganizationNames.slice(0, 400).map((name) => `- ${name}`).join("\n")
      : "- (none)",
    ``,
    `Candidates already rejected during today's run — DO NOT RETURN:`,
    input.rejectedThisRun.length ? input.rejectedThisRun.map((name) => `- ${name}`).join("\n") : "- (none)",
    ``,
    `Return 10-15 ranked candidates in the structured JSON schema so backend validation has replacements available. Do not fabricate any field; omit a candidate entirely rather than guessing.`,
  ].join("\n");
}

export function buildContactPrompt(input: {
  organizationName: string;
  website?: string | null;
  state?: string | null;
  directServices?: string | null;
}): string {
  return [
    `Find the single best person to contact at "${input.organizationName}"${input.state ? ` (${input.state})` : ""} about participating in ValorWell's "Beyond The Yellow" initiative, which interviews organizations about their direct work for veterans and military families.`,
    input.website ? `Organization website: ${input.website}` : "",
    input.directServices ? `Known direct services: ${input.directServices}` : "",
    ``,
    `Prefer a person who can publicly represent the organization's work: founder, executive director, CEO, president, program director, director of veteran services, communications director, community engagement director, or a comparable senior leader. Do not mechanically pick the highest-ranking executive — choose whoever is most appropriate for a BTY interview based on how the organization is actually structured.`,
    ``,
    `Use Google Search grounding. Never invent contact information. If a direct email address cannot be verified from a real source, return null for email rather than guessing a pattern. Always include evidence URLs and explain why this person was chosen.`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Two-step staggered discovery (6:00 AM + 6:05 AM, up to 4 candidates each)
// ---------------------------------------------------------------------------

export const BTY_PASS_TARGET_COUNT = 4;
export const BTY_PASS_MIN_SUBSCRIBERS = 500;
export const BTY_PASS_RELAXED_MIN_SUBSCRIBERS = 250;
export const BTY_PASS_RELAXATION_THRESHOLD = 3;

/** Raw shape Gemini returns for the staggered search. */
export type StaggeredRow = {
  org_name?: string;
  website?: string;
  city?: string;
  state?: string;
  youtube_url?: string;
  estimated_subscribers?: number | string;
  primary_impact_work?: string;
  why_boots_on_ground?: string;
  [key: string]: unknown;
};

export const STAGGERED_DISCOVERY_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      org_name: { type: "string" },
      website: { type: "string" },
      city: { type: "string" },
      state: { type: "string" },
      youtube_url: { type: "string" },
      estimated_subscribers: { type: "integer" },
      primary_impact_work: { type: "string" },
      why_boots_on_ground: { type: "string" },
    },
    required: [
      "org_name", "website", "city", "state", "youtube_url",
      "estimated_subscribers", "primary_impact_work", "why_boots_on_ground",
    ],
  },
} as const;

/**
 * Embedded staggered-search prompt. Intentionally carries NO ignore list:
 * duplicate suppression happens in backend code against the database.
 */
export function buildStaggeredDiscoveryPrompt(activeState: string): string {
  const stateName = BTY_STATE_NAMES[activeState] ?? activeState;
  return [
    `Search for up to ${BTY_PASS_TARGET_COUNT} veteran-focused non-profit organizations headquartered or primarily operating in ${stateName}.`,
    ``,
    `CRITICAL FILTERS:`,
    `1. 'Boots on the Ground' Only: They must provide direct local programs (e.g., housing, equine/wilderness therapy, job placement, peer support). Strictly EXCLUDE pass-through grantmakers, funding foundations, or referral directories.`,
    `2. YouTube Criteria: They must have an active YouTube channel with at least ${BTY_PASS_MIN_SUBSCRIBERS} subscribers. If fewer than ${BTY_PASS_RELAXATION_THRESHOLD} organizations meet this in ${stateName}, include organizations with down to ${BTY_PASS_RELAXED_MIN_SUBSCRIBERS} subscribers.`,
    ``,
    `Return the result strictly as a JSON array of objects with keys: \`org_name\`, \`website\`, \`city\`, \`state\`, \`youtube_url\`, \`estimated_subscribers\`, \`primary_impact_work\`, and \`why_boots_on_ground\`.`,
  ].join("\n");
}

/** Maps a staggered row onto the canonical candidate shape persisted by the CRM. */
export function mapStaggeredCandidate(row: StaggeredRow, activeState: string): Candidate {
  const subscribers = parseSubscriberCount(row.estimated_subscribers);
  const state = (row.state ?? "").trim().toUpperCase();
  return {
    organization_name: (row.org_name ?? "").trim(),
    website_url: (row.website ?? "").trim(),
    headquarters_city: (row.city ?? "").trim(),
    headquarters_state: state.length === 2 ? state : activeState.toUpperCase(),
    youtube_channel_url: (row.youtube_url ?? "").trim(),
    youtube_handle: youtubeHandle(row.youtube_url) ?? undefined,
    youtube_subscriber_count: Number.isFinite(subscribers) ? subscribers : undefined,
    direct_services_summary: (row.primary_impact_work ?? "").trim(),
    why_bty_candidate: (row.why_boots_on_ground ?? "").trim(),
  };
}

export type StaggeredValidationContext = {
  targetState: string;
  /** Normalized names already saved or discarded during this business date. */
  seenNames: Set<string>;
  /** Normalized-name -> reason map for organizations already in the CRM. */
  duplicateVerdicts?: Map<string, string>;
};

/**
 * Validates a staggered pass in code: required fields, headquarters state,
 * boots-on-the-ground evidence, and the 500 -> 250 subscriber relaxation.
 */
export function validateStaggeredCandidates(
  rows: StaggeredRow[],
  context: StaggeredValidationContext,
): ValidationOutcome {
  const target = context.targetState.toUpperCase();
  const mapped = rows.map((row) => mapStaggeredCandidate(row, target));
  const accepted: Candidate[] = [];
  const rejected: { candidate: Candidate; reason: string }[] = [];
  const batchNames = new Set<string>();
  const batchDomains = new Set<string>();
  const batchChannels = new Set<string>();
  const deferred: { candidate: Candidate; subscribers: number }[] = [];

  for (const candidate of mapped) {
    const normalizedName = normalizeOrgName(candidate.organization_name);
    const domain = normalizeDomain(candidate.website_url);
    const channel = normalizeYoutubeUrl(candidate.youtube_channel_url);
    const subscribers = parseSubscriberCount(candidate.youtube_subscriber_count);
    const reject = (reason: string) => rejected.push({ candidate, reason });

    if (!normalizedName) { reject("missing_name"); continue; }
    if ((candidate.headquarters_state ?? "").toUpperCase() !== target) {
      reject("headquarters_state_mismatch"); continue;
    }
    if (!domain) { reject("missing_website"); continue; }
    if (!channel) { reject("missing_youtube_channel"); continue; }
    if (!(candidate.why_bty_candidate ?? "").trim()) { reject("missing_boots_on_ground_rationale"); continue; }
    if (!describesDirectService(candidate.direct_services_summary)) { reject("no_direct_service_evidence"); continue; }
    if (!Number.isFinite(subscribers) || subscribers < BTY_PASS_RELAXED_MIN_SUBSCRIBERS) {
      reject("subscriber_count_below_minimum"); continue;
    }
    if (context.seenNames.has(normalizedName)) { reject("already_evaluated_today"); continue; }
    if (batchNames.has(normalizedName) || batchDomains.has(domain) || batchChannels.has(channel)) {
      reject("duplicate_within_candidate_set"); continue;
    }
    const dbVerdict = context.duplicateVerdicts?.get(normalizedName);
    if (dbVerdict) { reject(dbVerdict); continue; }

    batchNames.add(normalizedName);
    batchDomains.add(domain);
    batchChannels.add(channel);
    const normalized: Candidate = {
      ...candidate,
      youtube_subscriber_count: subscribers,
      subscriber_range_tier: subscribers >= BTY_PASS_MIN_SUBSCRIBERS ? 1 : 2,
    };
    if (subscribers >= BTY_PASS_MIN_SUBSCRIBERS) accepted.push(normalized);
    else deferred.push({ candidate: normalized, subscribers });
  }

  // 250-499 subscriber organizations only qualify when the 500+ pool is thin.
  if (accepted.length < BTY_PASS_RELAXATION_THRESHOLD) {
    for (const entry of deferred.sort((a, b) => b.subscribers - a.subscribers)) {
      if (accepted.length >= BTY_PASS_TARGET_COUNT) break;
      accepted.push(entry.candidate);
    }
  } else {
    for (const entry of deferred) rejected.push({ candidate: entry.candidate, reason: "subscriber_relaxation_not_required" });
  }

  return { accepted: accepted.slice(0, BTY_PASS_TARGET_COUNT), rejected };
}

/** Extracts the first JSON array from a grounded (non-structured) Gemini reply. */
export function extractJsonArray<T = unknown>(text: string): T[] {
  const raw = (text ?? "").trim();
  const fenced = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

/**
 * Google Search grounded call. Grounding cannot be combined with a response
 * schema on the Gemini Developer API, so the JSON array is parsed from text.
 */
export async function callGeminiGrounded<T>(
  prompt: string,
  options: { model?: string; timeoutMs?: number } = {},
): Promise<T[]> {
  const key = envValue("GEMINI_API_KEY");
  if (!key) throw new GeminiError("api_error", "GEMINI_API_KEY is not configured.");
  const model = options.model ?? BTY_GEMINI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);

  let response: Response;
  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.2 },
      }),
    });
  } catch (error) {
    clearTimeout(timer);
    if ((error as Error).name === "AbortError") throw new GeminiError("timeout", "Gemini request timed out.");
    throw new GeminiError("api_error", (error as Error).message);
  }
  clearTimeout(timer);

  if (response.status === 429) throw new GeminiError("rate_limited", "Gemini rate limit reached.");
  if (!response.ok) {
    const body = await response.text();
    throw new GeminiError("api_error", `Gemini responded ${response.status}: ${body.slice(0, 600)}`);
  }

  const payload = await response.json().catch(() => null) as Record<string, any> | null;
  const text: string = (payload?.candidates?.[0]?.content?.parts ?? [])
    .map((part: Record<string, unknown>) => part.text)
    .filter((value: unknown): value is string => typeof value === "string")
    .join("");
  if (!text) throw new GeminiError("invalid_response", "Gemini returned no content.");
  const rows = extractJsonArray<T>(text);
  if (!rows.length) throw new GeminiError("invalid_response", "Gemini returned no parsable JSON array.");
  return rows;
}
