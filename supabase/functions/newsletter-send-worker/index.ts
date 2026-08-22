import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

Deno.serve((_request: Request) => new Response(JSON.stringify({
  error: "Newsletter delivery is PRELAUNCH and intentionally unavailable.",
  runtimeState: "PRELAUNCH",
  sendCapable: false,
}), {
  status: 410,
  headers,
}));
