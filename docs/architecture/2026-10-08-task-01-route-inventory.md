# CRM Modernization — Task 01: Route, navigation and module inventory
**Audit date:** 2026-10-08. **Repository:** `LPredmore/valorwell-crm`, `main`. **Sources:** `src/App.tsx`, `src/components/crm/layout/CrmSidebar.tsx`, `src/components/crm/layout/CrmLayout.tsx`, `src/services/dataProvider.ts`, `src/pages/crm/`. This is a read-only production-code inventory; no deployed client behavior was changed.

## Baseline and observations
- 74 JSX route entries (including parent/index aliases); 34 direct sidebar items in **two flat groups**, Business Development and Clinical CRM. Menus and route paths can drift because route and sidebar configurations are separately hard-coded.
- Current CRM index redirects to `/crm/clients`; `/crm/canonical` exposes a different dashboard; `/command-center` is an additional top-level dashboard. Preserving page contracts and role-scoped meaning is required before choosing one home.
- Social Media Manager uses `/crm/social-media`, `src/pages/crm/SocialMediaManagerPage.tsx`, and `src/components/crm/social-media/`; Library, Publishing Queue, Calendar and Settings currently live as React tabs, not separately addressable routes. Schedule Series is a dialog.
- Client campaign and relationship outreach use **distinct** routes and persistence implementations. Do not merge transport paths simply to reduce sidebar links.
- `src/services/dataProvider.ts` selects live Supabase by default but supports forced mock mode through `VITE_USE_MOCK_DATA`; validation must distinguish them.

## Current route registry, component and future grouping
All paths below are sourced from `src/App.tsx`; relative route paths have been expanded under `/crm`. The grouping is a **proposed destination** and does not represent any deployed navigation change.

| Current route | Bound page/component | Proposed domain | Sidebar presence |
|---|---|---|---|
| `/` | `Index` | Entry/Compatibility | Deep-link / route-only |
| `/auth` | `Auth` | Entry/Compatibility | Deep-link / route-only |
| `/unsubscribe` | `RelationshipUnsubscribePage` | Communications | Deep-link / route-only |
| `/newsletter/unsubscribe` | `NewsletterUnsubscribePage` | Communications | Deep-link / route-only |
| `/command-center` | `CrmLayout (parent)` | Workspace | Command Center |
| `/command-center (index)` | `CommandCenterPage` | Workspace | Deep-link / route-only |
| `/crm` | `CrmLayout (parent)` | Entry/Compatibility | Deep-link / route-only |
| `/crm (index)` | `CrmIndex` | Workspace | Deep-link / route-only |
| `/crm/clients` | `CanonicalClients` | Clinical/Operations | Clients |
| `/crm/clients/:id` | `CanonicalClientDetail` | Clinical/Operations | Deep-link / route-only |
| `/crm/staff` | `CanonicalStaff` | Clinical/Operations | Staff |
| `/crm/campaigns` | `Navigate` | Communications | Deep-link / route-only |
| `/crm/campaigns/:id` | `CanonicalCampaignDetail` | Communications | Deep-link / route-only |
| `/crm/campaigns/:id/edit` | `CrmCampaignEditor` | Communications | Deep-link / route-only |
| `/crm/campaigns/:id/enrollments` | `CrmCampaignEnrollments` | Communications | Deep-link / route-only |
| `/crm/communications/campaigns` | `CampaignManagementPage` | Communications | Campaign Management |
| `/crm/communications/newsletters` | `NewsletterManagementPage` | Communications | Newsletters |
| `/crm/communications/observability` | `CommunicationsObservabilityPage` | Communications | Comms Observability |
| `/crm/tasks` | `CanonicalTasks` | Workspace | Deep-link / route-only |
| `/crm/ai-operations` | `AiOperationsPage` | Administration | AI Operations |
| `/crm/social-media` | `SocialMediaManagerPage` | Social Media | Social Media Manager |
| `/crm/command-center` | `Navigate` | Workspace | Deep-link / route-only |
| `/crm/exceptions` | `CanonicalExceptions` | Clinical/Operations | Deep-link / route-only |
| `/crm/therapist-matches` | `TherapistMatchReconciliationPage` | Clinical/Operations | Deep-link / route-only |
| `/crm/inbox` | `CanonicalInbox` | Workspace | Communications |
| `/crm/reports` | `CanonicalReports` | Administration | Reports |
| `/crm/business-development` | `BusinessDevelopmentDashboard` | Relationship/BTY | Business Development |
| `/crm/business-development/status` | `BusinessDevelopmentArchitecture` | Operations/Administration | System Status |
| `/crm/business-development/orchestration` | `RelationshipOrchestrationPage` | Operations/Administration | BTY Orchestration |
| `/crm/business-development/orchestration/reconciliation` | `RelationshipReconciliationPage` | Operations/Administration | Deep-link / route-only |
| `/crm/business-development/automation` | `Navigate` | Operations/Administration | Deep-link / route-only |
| `/crm/business-development/duplicate-cleanup` | `BtyAutomationPage` | Operations/Administration | BTY Duplicate Cleanup |
| `/crm/communications-control-plane` | `CommunicationsControlPlanePage` | Communications | Communications Control Plane |
| `/crm/business-development/search` | `RelationshipSearchPage` | Relationship/BTY | Search Relationships |
| `/crm/business-development/organizations` | `OrganizationDirectoryPage` | Relationship/BTY | Organizations |
| `/crm/business-development/organizations/new` | `OrganizationFormPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/organizations/:id/edit` | `OrganizationFormPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/organizations/:id` | `OrganizationDetailPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/contacts` | `ContactDirectoryPage` | Relationship/BTY | Contacts |
| `/crm/business-development/contacts/:id` | `ContactDetailPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/opportunities` | `OpportunityDirectoryPage` | Relationship/BTY | BTY Opportunities |
| `/crm/business-development/opportunities/:id` | `OpportunityDetailPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/imports` | `RelationshipImportPage` | Relationship/BTY | Imports |
| `/crm/business-development/bulk-enrollment` | `RelationshipBulkEnrollmentPage` | Relationship/BTY | Bulk Campaign Enrollment |
| `/crm/business-development/campaigns` | `RelationshipCampaignDirectoryPage` | Relationship/BTY | Relationship Campaigns |
| `/crm/business-development/campaigns/new` | `RelationshipCampaignEditorPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/campaigns/preview` | `RelationshipCampaignPreviewPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/campaigns/:id/enrollments` | `RelationshipCampaignEnrollmentsPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/campaigns/:id/delivery` | `RelationshipCampaignDeliveryPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/campaigns/:id` | `RelationshipCampaignEditorPage` | Relationship/BTY | Deep-link / route-only |
| `/crm/business-development/replies` | `RelationshipReplyQueuePage` | Relationship/BTY | Relationship Replies |
| `/crm/business-development/suppressions` | `RelationshipSuppressionPage` | Relationship/BTY | Relationship Suppressions |
| `/crm/business-development/reports` | `RelationshipReportsPage` | Relationship/BTY | Reports |
| `/crm/creator-community-interest` | `CreatorCommunityInterestQueue` | Relationship/BTY | Inbound Creator & Community Interest |
| `/crm/creator-community-interest/:id` | `CreatorCommunityInterestDetail` | Relationship/BTY | Deep-link / route-only |
| `/crm/email-studio` | `EmailStudioPage` | Communications | Email Studio |
| `/crm/email-studio/new` | `EmailTemplateEditorPage` | Communications | Deep-link / route-only |
| `/crm/email-studio/templates/:id` | `EmailTemplateEditorPage` | Communications | Deep-link / route-only |
| `/crm/email-studio/playground` | `EmailStudioPlaygroundPage` | Communications | Deep-link / route-only |
| `/crm/email-studio-spike` | `EmailStudioSpikePage` | Communications | Deep-link / route-only |
| `/crm/settings` | `CrmSettings` | Administration | Settings |
| `/crm/canonical` | `CanonicalDashboard` | Entry/Compatibility | Canonical Dashboard |
| `/crm/canonical/clients` | `CanonicalClients` | Clinical/Operations | Canonical Clients |
| `/crm/canonical/clients/:id` | `CanonicalClientDetail` | Clinical/Operations | Deep-link / route-only |
| `/crm/canonical/tasks` | `CanonicalTasks` | Workspace | Tasks |
| `/crm/canonical/exceptions` | `CanonicalExceptions` | Clinical/Operations | Exceptions |
| `/crm/canonical/therapist-matches` | `TherapistMatchReconciliationPage` | Clinical/Operations | Therapist Reconciliation |
| `/crm/canonical/campaigns` | `Navigate` | Communications | Deep-link / route-only |
| `/crm/canonical/campaigns/:id` | `CanonicalCampaignDetail` | Communications | Deep-link / route-only |
| `/crm/canonical/inbox` | `CanonicalInbox` | Entry/Compatibility | Deep-link / route-only |
| `/crm/canonical/search` | `CanonicalSearch` | Entry/Compatibility | Search |
| `/crm/canonical/staff` | `CanonicalStaff` | Clinical/Operations | Deep-link / route-only |
| `/crm/canonical/reports` | `CanonicalReports` | Administration | Deep-link / route-only |
| `*` | `NotFound` | Entry/Compatibility | Deep-link / route-only |

## Sidebar items without an exact route declaration (must verify nested/alias destinations)
None detected in this snapshot.
Nested route resolution is the expected explanation for some results; check alias and redirect behavior before treating any as invalid.

## Route → feature → primary data/service ownership
| Route family | UI/provider location | Current backend owner (inspect further before edits) |
|---|---|---|
| `/crm/business-development/contacts*` | `src/pages/crm/business-development/Contact*`, relationship repository | `relationship_contacts`, `relationship_contact_organizations`, `relationship_interactions` |
| `/crm/business-development/organizations*` | `Organization*`, relationship repository | `relationship_organizations`, contact affiliations |
| `/crm/business-development/opportunities*` | `Opportunity*` and `src/domain/relationships/opportunity-workflow.ts` | BTY `relationship_opportunities`, status history, meetings |
| `/crm/business-development/campaigns*` | relationship campaign pages/adapters | `relationship_campaigns`, `relationship_campaign_enrollments`, `relationship_communications`, `relationship_replies` |
| `/crm/communications/campaigns`, `/crm/campaigns*` | client/staff campaign pages and canonical adapters | `crm_campaigns`, `crm_campaign_enrollments`, triggers/scheduler |
| `/crm/communications/newsletters` | `NewsletterManagementPage.tsx` | `crm_newsletters`, `newsletter-send-worker`, related RPCs |
| `/crm/clients*`, `/crm/canonical/*`, `/crm/staff` | canonical client/staff/task repositories | EHR/operations data; keep PHI out of relationship/marketing domain |
| `/crm/social-media` | `SocialMediaManagerPage.tsx`; social library, queue and calendar components | `social-media-manager` Edge Function; `ai_operations_social_*`; YouTube dispatcher and RPCs |
| `/crm/ai-operations`, `/command-center` | command center and AI operations interfaces | `ai_operations_*` and related operational findings |

## Proposed information architecture (task 07/08 delivery target)
1. **Workspace:** Dashboard, My Tasks, Inbox.
2. **CRM:** Contacts, Organizations, Pipelines, Communications, Campaigns.
3. **Operations:** Therapist Recruitment, Beyond The Yellow, Client Intake, Clinician Network.
4. **Social Media — separately collapsed group:** Social Dashboard/Library/Publishing Queue/Calendar/Settings. **Current `/crm/social-media` stays working until Flurra cutover passes an independent gate**.
5. **Administration:** Reports, AI Operations/System Health, Settings.

## Route compatibility acceptance contract for implementation
- Keep all current deep links and id routes (e.g., `contacts/:id`, `campaigns/:id`, `clients/:id`) functional or provide exact redirects preserving IDs and query strings.
- Add social-media tab deep links while preserving `/crm/social-media` default behavior and its worker API.
- Put 1 menu entry per common user activity; specialized legacy diagnostics remain under Admin rather than being deleted.
- Check nested active state, mobile layout, keyboard nav and permission visibility.
- **Verification performed:** inspected JSX registry and menu source; generated a complete route-item inventory. Browser navigation, screenshots, credentialed role walkthrough and automated tests are **not run as part of read-only audit**; schedule with tasks 07–10.

## Successor tasks
Task 07 typed navigation, 08 social isolation, 09 redirects, 10 accessibility/responsiveness. No production code or database modified by this inventory.
