# Live rollout receipt — October 15, 2026

Owner authorized database migrations, generated types, deployments and Zeffy integration. The no-test instruction remains: no tests, lint, type checks, standalone builds, browser acceptance, advisors, signed-JWT fixtures or runtime financial checks were run. Publishing was requested through host controls and may involve the host's deployment build; it is not application verification. No application code edited through Lovable.

## Database and functions

Billing Hub `ahqauomkgflopxgnlndd`: apply_migration succeeded for staff exact applicant lookup (`20261015210737`) and Zeffy ledger (`20261015210747`). Migration-history/catalog read returned both versions and disabled Foundation mapping for the owner-confirmed tenant ending 0001. Billing Hub source files were renamed from scaffold timestamps to actual applied versions, preserving SQL bytes. Never replay the old scaffold versions or the earlier identity migration. Supabase live type generation succeeded; exact output committed to CRM, Staff and Billing Hub.

Deployed/ACTIVE `zeffy-donation-report` v1 (bundle SHA-256 `4f5856488e5ee1685371a8e01f9f4b6bf4730876320d4254cd1b211988e4b0c7`) and signed standby `zeffy-webhook-verified` v1 (`f925d0af885b8fa884109d0222c3eb10efd4707359189c7d53b48c07d3240b50`). Existing `zeffy-webhook` v11 remains unchanged so uncertain private signing/subscription configuration cannot interrupt current capture. The standby deploys the tracked webhook bundle under a second slug with local imports. No provider cutover, financial processing, source/queue enablement or cron installed.

## GitHub source merges

| Repository / PR | Merge commit |
| --- | --- |
| Billing Hub [#17](https://github.com/LPredmore/valorwell-billing-hub/pull/17) | a9de396e93b1686dacb799348845479f76c031d6 |
| Staff [#32](https://github.com/LPredmore/valorwell-staff/pull/32) | 17bee71c865026c832eea78e57ddd1cb0ddbe4de |
| CRM [#156](https://github.com/LPredmore/valorwell-crm/pull/156) | 27025a843967dd8d3fd9a78ae255e0fffe2c1018 |
| Website [#129](https://github.com/LPredmore/valorwell-website/pull/129) | 223b40bfd2f704390cd691ff9bdf5bb2f5a8f477 |

Website adds documented channel-only UTM_source collection for the fixed Zeffy donation form. Known acquisition source stays distinct from CTA placement. Raw click IDs, arbitrary local-storage text, names/email and invented checkout tokens are excluded. Donation form opened tracking remains unchanged. Source appears in Zeffy donation details/exports per provider documentation; persistence through our embed and an API field identity are still unverified. This is not individual ad attribution or an uploader.

## Hosting publish requests

Read-only host metadata matched these exact GitHub commits before each publish request. Corrected CRM placeholder and Staff unrelated-old-project README links first. Each deploy_project call returned **status=pending** with the receipt below. The available get_project operation reports source/provision state and does not establish completion of an individual deployment. Existing is_published=true predates these requests. No completed-hosting or custom-domain propagation claim is made; no browser/HTTP acceptance ran.

| App / project | Requested commit | Deployment ID | Returned hosting URL |
| --- | --- | --- | --- |
| CRM / 67d68fb5-d6d7-40fb-b409-203945e02edd | 27025a843967dd8d3fd9a78ae255e0fffe2c1018 | f4213772-135f-49ae-82b5-c1884c393ee4 | https://status-scribe-mail.lovable.app |
| Staff / bbe5d93f-0702-430e-a5d5-4ddb88ec9112 | 17bee71c865026c832eea78e57ddd1cb0ddbe4de | a84acad2-5f18-4b34-bd4e-0e9b0e520ea3 | https://ehr-staff.lovable.app |
| Clients / 3c381a94-ac2b-412d-884c-ac6a545c20ea | 09a272d1a39413e3e9ab365d1ea870ab0918638c | 37a9c40f-129f-474c-a4b5-d49bb1c6bf80 | https://ehr-client.lovable.app |
| Website / c758642f-82dd-4b2c-89f4-751876e059fc | 223b40bfd2f704390cd691ff9bdf5bb2f5a8f477 | 72545ea4-6bfb-4e93-a593-e4e911a60816 | https://pathfinder-wellspring.lovable.app |

Custom domains were not changed. Billing Hub frontend was not republished because this pass changes its generated types/backend contracts, not its frontend behavior. If the host reports deployment failure, inspect that receipt before retrying; do not deploy a different project or edit code through Lovable to bypass GitHub.

## Exact remaining private setup and acceptance

Connected tools do not expose Zeffy owner settings or Supabase secret/Auth-config management. Workspace reports no ready credentials; actual Edge secret presence remains unconfirmed. As Foundation owner, open [Zeffy Settings → Integrations](https://www.zeffy.com/o/settings?openIntegrations=true); get the read API key and Webhook signing secret. Store the latter as ZEFFY_WEBHOOK_SIGNING_SECRET in [Billing Hub function secrets](https://supabase.com/dashboard/project/ahqauomkgflopxgnlndd/functions/secrets) and bind ZEFFY_API_KEY in the trusted reconciliation environment. Never paste values into chat/source/browser. Confirm the actual configured URL and payment.completed/created/updated/deleted selections. Keep existing endpoint/retries until a coordinated signed cutover. No legacy key/HMAC fallback.

Individual attribution additionally needs Zeffy's documented hidden opaque checkout-reference round trip returned in authenticated payments, consent/window, completed-donation Ads action/account/time and refund adjustment contracts. Metadata is reserved; buyer-question labels or email/time matches are not substitutes. Exact provider question: which supported embedded-form field can carry an opaque first-party reference and return it unchanged with the successful payment, and under which API field/export column? No direct provider question was sent.

CRM shared Auth still needs confirmation of the three additive exact /auth returns (plain, flow=invite, flow=recovery); keep client Site URL/templates/other portals. All record reconciliation/Primary/network and real invitation/transport checks remain separately open.

Preserved Task 42's full existing description/checklists. Appended final continuation `6hmQmgvw69Pjjc8H` for these applied versions/deployments/source-parameter checks, in addition to `6hmQfFRGxP3g4qFq`'s SQL/race/refund/tenant checks. No phase acceptance was closed. Roll back access/publish first, pause source/queue and preserve stored financial/source history; use forward schema repair after use.
