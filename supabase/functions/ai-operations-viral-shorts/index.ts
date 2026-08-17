// Daily Veteran Humor Viral Shorts discovery.
// Identifies at most two high-performing humorous veteran/military YouTube Shorts per day
// and stores them for HUMAN REVIEW ONLY. Nothing is downloaded, reposted or published.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AI_OPS_TENANT_ID, adminClient, authorizeWorker, callGeminiModel, centralBusinessDate,
  geminiApiKey, json, logEvent, parseModelJson, safeError,
} from "../_shared/ai-ops.ts";
import { youtubeGetJson } from "../_shared/ai-ops-youtube.ts";
import { awaitGeminiSlot, GeminiRateSlotUnavailable } from "../_shared/gemini-rate-limit.ts";
import {
  buildHumorPrompt, filterCandidates, geminiPool, searchQueriesForDate, selectCandidates,
  VIRAL_SHORTS_MODEL, VIRAL_SHORTS_RESPONSE_SCHEMA, VIRAL_SHORTS_SYSTEM_INSTRUCTION,
  type HumorVerdict, type RawVideo,
} from "../_shared/viral-shorts.ts";

const COMPONENT = "ai-operations-viral-shorts";
const SEARCH_MAX_RESULTS = 25;

async function searchVideoIds(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    part: "id", type: "video", videoDuration: "short", order: "viewCount",
    relevanceLanguage: "en", safeSearch: "moderate", maxResults: String(SEARCH_MAX_RESULTS), q: query,
  });
  const payload = await youtubeGetJson(`/search?${params.toString()}`) as { items?: Array<{ id?: { videoId?: string } }> };
  return (payload.items ?? []).map((item) => item.id?.videoId ?? "").filter(Boolean);
}

async function fetchVideoMetadata(videoIds: string[], sourceQueries: Map<string, string>): Promise<RawVideo[]> {
  if (!videoIds.length) return [];
  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails,status",
    id: videoIds.slice(0, 50).join(","),
  });
  const payload = await youtubeGetJson(`/videos?${params.toString()}`) as {
    items?: Array<{
      id?: string;
      snippet?: { title?: string; description?: string; channelId?: string; channelTitle?: string; publishedAt?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      contentDetails?: { duration?: string };
      status?: { license?: string };
    }>;
  };
  const num = (value?: string) => (value && /^\d+$/.test(value) ? Number(value) : null);
  return (payload.items ?? []).filter((item) => item.id).map((item) => ({
    videoId: item.id as string,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? null,
    channelId: item.snippet?.channelId ?? null,
    channelName: item.snippet?.channelTitle ?? null,
    publishedAt: item.snippet?.publishedAt ?? null,
    viewCount: num(item.statistics?.viewCount),
    likeCount: num(item.statistics?.likeCount),
    commentCount: num(item.statistics?.commentCount),
    durationIso: item.contentDetails?.duration ?? null,
    youtubeLicense: item.status?.license ?? null,
    sourceQuery: sourceQueries.get(item.id as string) ?? null,
  }));
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorizeWorker(request)) return json({ error: "Unauthorized." }, 401);

  const admin = adminClient();
  const body = await request.json().catch(() => ({})) as { tenantId?: string; businessDate?: string };
  const tenantId = body.tenantId ?? AI_OPS_TENANT_ID;
  const businessDate = body.businessDate ?? centralBusinessDate();

  // One run record per tenant/business date doubles as the idempotency guard.
  const { data: run, error: runError } = await admin
    .from("ai_operations_viral_short_runs")
    .insert({ tenant_id: tenantId, business_date: businessDate, status: "running" })
    .select("id")
    .maybeSingle();
  if (runError) {
    logEvent(COMPONENT, "run_skipped", { tenantId, businessDate, reason: runError.message });
    return json({ ok: true, skipped: "already_run_today", businessDate });
  }
  const runId = run?.id as string;
  const metrics = {
    youtubeSearches: 0, youtubeMetadataRequests: 0, rawCandidateCount: 0,
    filteredCandidateCount: 0, geminiCandidatesEvaluated: 0, geminiCalls: 0,
  };
  const queries = searchQueriesForDate(businessDate);

  const finish = async (status: "success" | "failed", selectedIds: string[], storedCount: number, failureReason: string | null) => {
    await admin.from("ai_operations_viral_short_runs").update({
      status,
      completed_at: new Date().toISOString(),
      search_queries: queries,
      youtube_searches: metrics.youtubeSearches,
      youtube_metadata_requests: metrics.youtubeMetadataRequests,
      raw_candidate_count: metrics.rawCandidateCount,
      filtered_candidate_count: metrics.filteredCandidateCount,
      gemini_candidates_evaluated: metrics.geminiCandidatesEvaluated,
      gemini_calls: metrics.geminiCalls,
      selected_video_ids: selectedIds,
      stored_count: storedCount,
      failure_reason: failureReason,
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
    logEvent(COMPONENT, status === "success" ? "run_complete" : "run_failed", {
      tenantId, businessDate, runId, queries, ...metrics, selectedIds, storedCount, failureReason,
    });
  };

  try {
    // STEP 1 — YouTube candidate search (authoritative discovery, ~2 requests/day).
    const sourceQueries = new Map<string, string>();
    const ids: string[] = [];
    for (const query of queries) {
      const found = await searchVideoIds(query);
      metrics.youtubeSearches += 1;
      for (const id of found) {
        if (!sourceQueries.has(id)) sourceQueries.set(id, query);
        if (!ids.includes(id)) ids.push(id);
      }
    }
    metrics.rawCandidateCount = ids.length;

    // STEP 2 — authoritative metadata (single videos.list request).
    const videos = await fetchVideoMetadata(ids, sourceQueries);
    metrics.youtubeMetadataRequests = videos.length ? 1 : 0;

    const { data: stored } = await admin
      .from("ai_operations_viral_short_candidates")
      .select("video_id")
      .eq("tenant_id", tenantId);
    const excludeVideoIds = (stored ?? []).map((row: { video_id: string }) => row.video_id);

    // STEP 3 — deterministic duration/viral filtering. Gemini never supplies metrics.
    const candidates = filterCandidates(videos, { excludeVideoIds });
    metrics.filteredCandidateCount = candidates.length;
    if (!candidates.length) {
      await finish("success", [], 0, null);
      return json({ ok: true, businessDate, selected: [], stored: 0, ...metrics });
    }

    // STEP 4 — ONE batched Gemini 2.5 Flash humor/audience classification, rate-slot protected.
    const pool = geminiPool(candidates);
    metrics.geminiCandidatesEvaluated = pool.length;
    await awaitGeminiSlot(admin, { label: COMPONENT, maxWaitMs: 90_000 });
    const result = await callGeminiModel({
      apiKey: geminiApiKey(),
      model: VIRAL_SHORTS_MODEL,
      systemInstruction: VIRAL_SHORTS_SYSTEM_INSTRUCTION,
      userPrompt: buildHumorPrompt(pool),
      responseSchema: VIRAL_SHORTS_RESPONSE_SCHEMA,
    });
    metrics.geminiCalls = 1;
    const verdicts = ((parseModelJson(result.text) as { results?: HumorVerdict[] }).results ?? []) as HumorVerdict[];

    // STEP 5 — select at most two; fewer is a legitimate successful outcome.
    const selections = selectCandidates(pool, verdicts);
    let storedCount = 0;
    for (const selection of selections) {
      const c = selection.candidate;
      const { error } = await admin.from("ai_operations_viral_short_candidates").insert({
        tenant_id: tenantId,
        business_date: businessDate,
        video_id: c.videoId,
        video_url: c.videoUrl,
        title: c.title,                 // original YouTube title preserved verbatim
        description: c.description,     // original YouTube description preserved verbatim
        channel_id: c.channelId,
        channel_name: c.channelName,
        published_at: c.publishedAt,
        view_count: c.viewCount,
        like_count: c.likeCount,
        comment_count: c.commentCount,
        duration_seconds: c.durationSeconds,
        age_days: c.ageDays,
        views_per_day: c.viewsPerDay,
        youtube_license: c.youtubeLicense,
        source_query: c.sourceQuery,
        viral_tier: c.viralTier,
        selection_rank: selection.rank,
        humor_rationale: selection.rationale,
        status: "new",
      });
      if (!error) storedCount += 1;
      else logEvent(COMPONENT, "candidate_store_skipped", { videoId: c.videoId, reason: error.message });
    }

    await finish("success", selections.map((s) => s.candidate.videoId), storedCount, null);
    return json({
      ok: true, businessDate, ...metrics, stored: storedCount,
      selected: selections.map((s) => ({ videoId: s.candidate.videoId, rank: s.rank, tier: s.candidate.viralTier, url: s.candidate.videoUrl })),
    });
  } catch (error) {
    const reason = error instanceof GeminiRateSlotUnavailable ? "gemini_rate_slot_unavailable" : safeError(error);
    await finish("failed", [], 0, reason);
    return json({ ok: false, businessDate, error: reason, ...metrics }, 200);
  }
});
