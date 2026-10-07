# Architecture rules

- Social Media Manager background work (e.g. Schedule Series dispatch) runs inside the `social-media-manager` Edge Function behind a cron-secret action, because Supabase does not bundle imports across function directories.
- Schedule Series planning rules live in pure `handlers/series-core.ts`; I/O stays in `handlers/series.ts`, so the rules stay unit-testable without a database.
