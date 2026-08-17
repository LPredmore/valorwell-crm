import { describe, expect, it } from "vitest";
import {
  buildHumorPrompt, filterCandidates, geminiPool, parseIsoDurationSeconds, rankCandidates,
  searchQueriesForDate, selectCandidates, shortsUrl, viralTierFor, VIRAL_SHORTS_MODEL,
  VIRAL_SHORTS_SEARCH_FAMILIES, verdictApproves, type HumorVerdict, type RawVideo,
} from "../../supabase/functions/_shared/viral-shorts";
import { slotBackoffMs, GEMINI_AUTOMATION_MAX_STARTS, GEMINI_AUTOMATION_WINDOW_SECONDS } from "../../supabase/functions/_shared/gemini-rate-limit";

const NOW = new Date("2026-08-17T00:00:00Z");

const video = (overrides: Partial<RawVideo> & { videoId: string }): RawVideo => ({
  title: "Veteran humor", description: "funny", channelId: "c1", channelName: "Chan",
  publishedAt: "2026-08-07T00:00:00Z", viewCount: 500_000, likeCount: 100, commentCount: 10,
  durationIso: "PT45S", youtubeLicense: "youtube", sourceQuery: "veteran humor #shorts",
  ...overrides,
});

const approve = (videoId: string, rationale = "veteran humor"): HumorVerdict => ({
  videoId, humorous: true, veteranRelatable: true, understandableWithoutContext: true,
  primarilyPolitical: false, graphicOrUnsafe: false, genericMilitaryFootage: false,
  suitableForPublicVeteranAccount: true, rationale,
});

describe("veteran humor shorts discovery", () => {
  it("uses gemini-3.6-flash", () => {
    expect(VIRAL_SHORTS_MODEL).toBe("gemini-3.6-flash");
  });

  it("rotates two complementary search queries per day", () => {
    const a = searchQueriesForDate("2026-08-17");
    const b = searchQueriesForDate("2026-08-18");
    expect(a).toHaveLength(2);
    expect(new Set(a).size).toBe(2);
    expect(a.join("|")).not.toBe(b.join("|"));
    for (const query of [...a, ...b]) expect(VIRAL_SHORTS_SEARCH_FAMILIES).toContain(query);
  });

  it("parses ISO durations and rejects anything over 180 seconds", () => {
    expect(parseIsoDurationSeconds("PT45S")).toBe(45);
    expect(parseIsoDurationSeconds("PT3M")).toBe(180);
    expect(parseIsoDurationSeconds("PT3M1S")).toBe(181);
    expect(parseIsoDurationSeconds("bogus")).toBeNull();
    const kept = filterCandidates([video({ videoId: "ok" }), video({ videoId: "long", durationIso: "PT3M30S" })], { now: NOW });
    expect(kept.map((c) => c.videoId)).toEqual(["ok"]);
  });

  it("assigns view tiers and computes deterministic viral metrics", () => {
    expect(viralTierFor(2_000_000)).toBe("A");
    expect(viralTierFor(300_000)).toBe("B");
    expect(viralTierFor(120_000)).toBe("C");
    expect(viralTierFor(60_000)).toBe("fallback");
    expect(viralTierFor(1_000)).toBeNull();
    const [candidate] = filterCandidates([video({ videoId: "v1", viewCount: 1_000_000 })], { now: NOW });
    expect(candidate.viralTier).toBe("A");
    expect(candidate.ageDays).toBe(10);
    expect(candidate.viewsPerDay).toBe(100_000);
    expect(candidate.videoUrl).toBe(shortsUrl("v1"));
  });

  it("ranks by tier, then views per day, then absolute views", () => {
    const ranked = rankCandidates(filterCandidates([
      video({ videoId: "b", viewCount: 400_000 }),
      video({ videoId: "a", viewCount: 3_000_000 }),
      video({ videoId: "c", viewCount: 900_000, publishedAt: "2026-08-16T00:00:00Z" }),
    ], { now: NOW }));
    expect(ranked.map((c) => c.videoId)).toEqual(["a", "c", "b"]);
  });

  it("never reconsiders previously stored video ids", () => {
    const kept = filterCandidates([video({ videoId: "old" }), video({ videoId: "new" })], { now: NOW, excludeVideoIds: ["old"] });
    expect(kept.map((c) => c.videoId)).toEqual(["new"]);
  });

  it("sends one batched Gemini request with a bounded candidate pool", () => {
    const many = filterCandidates(Array.from({ length: 40 }, (_, i) => video({ videoId: `v${i}`, viewCount: 500_000 - i })), { now: NOW });
    const pool = geminiPool(many);
    expect(pool.length).toBe(25);
    const prompt = JSON.parse(buildHumorPrompt(pool)) as { candidates: unknown[] };
    expect(prompt.candidates).toHaveLength(25);
  });

  it("preserves the original title and description in the prompt payload without rewriting", () => {
    const pool = filterCandidates([video({ videoId: "v1", title: "ORIGINAL TITLE", description: "ORIGINAL DESC" })], { now: NOW });
    const prompt = JSON.parse(buildHumorPrompt(pool)) as { candidates: Array<{ title: string; description: string }> };
    expect(prompt.candidates[0].title).toBe("ORIGINAL TITLE");
    expect(prompt.candidates[0].description).toBe("ORIGINAL DESC");
  });

  it("only approves candidates that clear every content gate", () => {
    expect(verdictApproves(approve("v1"))).toBe(true);
    expect(verdictApproves({ ...approve("v1"), primarilyPolitical: true })).toBe(false);
    expect(verdictApproves({ ...approve("v1"), graphicOrUnsafe: true })).toBe(false);
    expect(verdictApproves({ ...approve("v1"), genericMilitaryFootage: true })).toBe(false);
    expect(verdictApproves(undefined)).toBe(false);
  });

  it("selects exactly two videos when two qualify", () => {
    const candidates = filterCandidates([
      video({ videoId: "a", viewCount: 2_000_000 }),
      video({ videoId: "b", viewCount: 300_000 }),
      video({ videoId: "c", viewCount: 150_000 }),
    ], { now: NOW });
    const selections = selectCandidates(candidates, [approve("a"), approve("b"), approve("c")]);
    expect(selections.map((s) => [s.candidate.videoId, s.rank])).toEqual([["a", 1], ["b", 2]]);
  });

  it("allows fewer than two selections and never manufactures a second", () => {
    const candidates = filterCandidates([video({ videoId: "a" }), video({ videoId: "b" })], { now: NOW });
    expect(selectCandidates(candidates, [approve("a")]).map((s) => s.candidate.videoId)).toEqual(["a"]);
    expect(selectCandidates(candidates, [])).toEqual([]);
  });

  it("uses the 50K fallback tier only when tiers A-C cannot supply two candidates", () => {
    const candidates = filterCandidates([
      video({ videoId: "tierC", viewCount: 120_000 }),
      video({ videoId: "fallback", viewCount: 60_000 }),
      video({ videoId: "tierB", viewCount: 400_000 }),
    ], { now: NOW });
    expect(selectCandidates(candidates, [approve("tierB"), approve("tierC"), approve("fallback")]).map((s) => s.candidate.videoId))
      .toEqual(["tierB", "tierC"]);
    expect(selectCandidates(candidates, [approve("tierC"), approve("fallback")]).map((s) => s.candidate.videoId))
      .toEqual(["tierC", "fallback"]);
  });
});

describe("shared Gemini automation rate limit", () => {
  it("targets 8 request starts per rolling 60 seconds", () => {
    expect(GEMINI_AUTOMATION_MAX_STARTS).toBe(8);
    expect(GEMINI_AUTOMATION_WINDOW_SECONDS).toBe(60);
  });

  it("backs off within bounded jittered limits", () => {
    for (const suggested of [0, 500, 30_000]) {
      const wait = slotBackoffMs(suggested, 1);
      expect(wait).toBeGreaterThanOrEqual(250);
      expect(wait).toBeLessThanOrEqual(10_000);
    }
  });
});
