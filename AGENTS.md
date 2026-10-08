# Architecture rules

- Social Media Manager background work (e.g. Schedule Series dispatch) runs inside the `social-media-manager` Edge Function behind a cron-secret action, because Supabase does not bundle imports across function directories.
- Schedule Series planning rules live in pure `handlers/series-core.ts`; I/O stays in `handlers/series.ts`, so the rules stay unit-testable without a database.
- Automatic Shorts thumbnail uploads are gated per YouTube account by `ai_operations_social_settings.metadata.shorts_thumbnail_api` and decided only in `_shared/youtube-publish/shorts-thumbnail.ts`, because an API 200/hasCustomThumbnail is not proof a Shorts thumbnail is visible; enabling requires a recorded test run plus human visual confirmation.
