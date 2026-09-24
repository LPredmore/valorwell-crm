// Lets Vitest suites and the application type-check import Supabase Edge Function modules
// that reference the Deno-style npm: specifier. Vitest aliases the same specifier at runtime
// (vitest.config.ts); Deno resolves it natively when the function is deployed.
declare module "npm:@supabase/supabase-js@2.93.1" {
  export * from "@supabase/supabase-js";
}
