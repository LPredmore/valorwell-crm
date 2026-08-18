// Retired: video-idea discovery has been removed from ValorWell.
// Keep a tombstone endpoint so stale callers fail closed instead of performing any search.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({ ok: false, retired: true, error: "video_idea_discovery_removed" }),
  {
    status: 410,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  },
));
