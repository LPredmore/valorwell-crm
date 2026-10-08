# CRM Navigation implementation — Tasks 07–10
Date: 2026-10-08. Existing CRM repository: `LPredmore/valorwell-crm`.
Target branch: `feat/crm-navigation-phases-07-10`. This change is **CRM UI routing/navigation only**. No Supabase schema migration, RLS/grants, publishing worker, Flurra code, background job, outbound email, or data move.

## Task 07 — grouped typed configuration
`src/components/crm/layout/crmNavigation.ts` is the single typed registry for the sidebar:
- Workspace: Dashboard, My Tasks, Inbox.
- CRM: Contacts, Organizations, Pipelines (current BTY opportunities page), Communications (existing control plane), Campaigns; specialized links under More tools.
- Operations: Therapist Recruitment (current therapist matching/reconciliation page until future recruitment pipeline implementation), Beyond The Yellow, Client Intake, Clinician Network; specialist tools in More tools.
- Social Media: Library, Publishing Queue, Calendar, Settings, Schedule Series.
- Administration: Reports, AI Operations, System Health, Settings; support tools under More tools.

**Important:** The new nav does NOT imply that a universal pipeline or recruiter workspace already exists; Tasks 18–29 deliver those new features. Existing destinations were chosen to preserve current functionality while the CRM is reorganized.

All legacy sidebar features are accessible as main links or via **More tools**. No generic placeholder routes, sidebar dead ends, invented tasks/unread badges, or new CRM engines were introduced. Frontend menu visibility is filtered using `CrmAuthContext.capabilities`; actual security remains enforced by existing backend RLS/RPC/Edge Function authorization, not this client-side display.

## Task 08 — Social Media preserved
- A distinct collapsible Social Media navigation group now links to `/crm/social-media?tab=library`, `?tab=queue`, `?tab=calendar`, `?tab=settings` and `?action=schedule-series`.
- `SocialMediaManagerPage.tsx` reads/writes tab/dialog state through React Router `useSearchParams`. The original `/crm/social-media` remains the default Library view; direct links and tab navigation survive refresh/back/forward. Series continues using the existing `ScheduleSeriesDialog`.
- Existing `fetchSocialMediaBootstrap`, library/queue/calendar/settings components, YouTube publishing dispatcher, Storage, R2, scheduling and backend policies are unchanged.
- The Social Media menu remains in the CRM until a separately validated Flurra cutover is approved. No move to Flurra was attempted.

## Task 09 — compatible route cleanup
`CrmLegacyRouteRedirect` retains route parameters, query strings and hash fragments. Redirect aliases are deliberately restricted to routes that rendered the **same existing component** or already used a redirect:

| Legacy URL | Canonical destination |
|---|---|
| `/crm/campaigns` | `/crm/communications/campaigns` |
| `/crm/command-center` | `/command-center` |
| `/crm/business-development/automation` | `/crm/business-development/duplicate-cleanup` |
| `/crm/canonical/clients` | `/crm/clients` |
| `/crm/canonical/clients/:id` | `/crm/clients/:id` |
| `/crm/canonical/tasks` | `/crm/tasks` |
| `/crm/canonical/exceptions` | `/crm/exceptions` |
| `/crm/canonical/therapist-matches` | `/crm/therapist-matches` |
| `/crm/canonical/campaigns` | `/crm/communications/campaigns` |
| `/crm/canonical/campaigns/:id` | `/crm/campaigns/:id` |
| `/crm/canonical/inbox` | `/crm/inbox` |
| `/crm/canonical/staff` | `/crm/staff` |
| `/crm/canonical/reports` | `/crm/reports` |

**Not collapsed:** `/crm/canonical` (specialized canonical dashboard), `/crm/business-development` (distinct BTY dashboard), `/crm/canonical/search` (specialized canonical search), `/crm/business-development/search` (relationship search), client-campaign editor/enrollment/detail routes and all relationship-campaign preview/delivery/enrollment paths. They remain available because their contracts are not interchangeable. Deep links including IDs/search/hash are preserved.

## Task 10 — accessibility and responsive navigation
- Desktop sidebar: collapsible icon-only mode; accessible tooltips and link labels. Group headings are keyboard-operable Radix Collapsible triggers, with accessible names; per-group state persists in localStorage with a safe fallback. Active group and advanced tool list expand when navigating into them.
- Mobile: hamburger menu triggers an accessible Radix Sheet drawer with overlay, Escape key behavior, focus trap/restoration from Dialog primitives; clicking a link closes the drawer. Sidebar is not left permanently consuming narrow-screen width.
- Title and breadcrumb: route-aware title plus section in existing header; no fabricated KPI badge counts. On pathname changes, focus moves to the content region; same-route query changes (Social Media tab switching) do not steal focus.
- Social tab navigation wraps on narrow screens. All changes use existing React Router, Tailwind, Radix and Lucide packages; no added dependencies.

## Verification and limitations
- Automated unit/integration tests in `src/components/crm/layout/crmNavigation.test.tsx` cover group isolation, capability filtering, Social Media query/deep links, group interaction, and old-route parameter/query/hash preservation.
- To be **run by GitHub CI or local dev**: `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm test -- src/components/crm/layout/crmNavigation.test.tsx`, `npm run build`.
- Manual login+browser verification needed on deployed preview: desktop width 1280px+, keyboard Tab/Enter/Space through groups and More tools; mobile 320–390px with drawer open/close/Escape, route change and focus; readonly/operator roles; Social Media tab/schedule dialog direct navigation; historical bookmarked URLs; confirm publishing jobs unchanged. These are **not claimed complete** unless actual results are attached.
- Earlier CI runs on main were blocked by retired-project guard and repository policy; inspect branch PR checks and separate pre-existing checks from any new errors.
- Rollback: revert these frontend commits/PR; no database state needs rollback. Browser links to existing social tabs still work at `/crm/social-media` when the new query-link UI is reverted.

This change **does not** satisfy Task 03 real two-tenant signed-JWT negative tests, which the user explicitly deferred until application/database integration.
