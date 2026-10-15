# Zeffy Foundation donations: configuration and attribution review

Read-only investigation, October 15, 2026 UTC. Zeffy is the current donation platform per the user. Givebutter campaign `565036` is legacy only. Preserve all historical donation, attribution and audit records. Legacy Givebutter repairs do not gate investigation/design of an independent Zeffy path.

During the initial read-only investigation, no application, database, webhook, ad-account or provider configuration changed. No webhook invoked, payment/refund initiated, conversion uploaded, message sent, worker activated, test/lint/typecheck/build or browser acceptance run. Documentation and Todoist scope corrections only.

## Confirmed current setup

| Question | Evidence / conclusion |
| --- | --- |
| Foundation organization | Public Zeffy Bridge Fund page identifies organization/legal name **ValorWell Foundation**, Zeffy organization ID `82c94ff3-79c1-44a0-ab32-7c984ec4aec4`. This is a Zeffy organization ID, **not** a Supabase tenant ID. |
| Current form | `https://www.zeffy.com/embed/donation-form/the-valorwell-bridge-fund?modal=true`; public form ID `d46f040c-7dcb-4d71-9954-9238f4e43e22`. The captured payment campaign ID matches this form. |
| Foundation tenant | **Not established.** Billing Hub's authoritative tenant registry contains ValorWell (`00000000-0000-0000-0000-000000000001`) and Test Organization (`5bae6536-50fe-4136-a13e-5d38dd8ea730`), neither explicitly Foundation. Zeffy event storage has no tenant/account ownership column; handler has no mapping. No Foundation repository found by installed-repository name search. Accessible Supabase projects are Billing Hub and Flurra; Flurra was not queried. Do not infer a Foundation tenant from the old task, shared project, Ads account, or website name. |
| Deployed receiver | Billing Hub Edge Function **`zeffy-webhook` v11**, ACTIVE, JWT verification disabled for external delivery. Base endpoint: `https://ahqauomkgflopxgnlndd.supabase.co/functions/v1/zeffy-webhook`. Handler requires an existing shared key via `?key=…` or `x-valorwell-webhook-key`; no key value was retrieved or published. |
| Historical receipt evidence | `zeffy_webhook_events` has 11 requests, September 8–16: 5 `payment.created`, 5 `payment.completed`, 1 `payment.updated`; created/completed refer to **5 distinct payments**, not 10 donations. Completed captures comprise 4 manual and 1 online payment. These may include setup/test records; not a verified donation total. |
| Current subscription status | **Unknown.** Historical stored requests demonstrate capture, not today's Zeffy Settings → Integrations URL/event selections/enabled status. No current provider settings/API credential accessible. Exact full configured URL may include the secret query parameter; do not publish it. |
| Receiver behavior | Captures JSON, event ID/type, body hash and selected headers; unique partial index `(event_type,event_id)` handles repeated event capture. No normalized payment/refund ledger, tenant resolution, donor aggregate update, attribution matching or Ads upload in this function. No table triggers or database function-body Zeffy consumers found in the inspected catalog. |
| Authentication gap | Handler checks a shared key hash but **does not verify Zeffy's HMAC signature or timestamp**. 9/11 captures contain a `zeffy-signature` header; presence is not verification. JSON plus a body hash cannot substitute for saved raw bytes and signature verification. Reconcile historical payments through authenticated provider reads before treating them as verified financial facts. |
| Capture access | RLS is enabled with no policies; anon/authenticated SELECT grants exist but no permissive RLS policy was found. No new browser access should be added. This is catalog evidence, not a signed-role test. |

Deployed function bundle SHA-256: `838ba011312ab023802402cf1ab0d6e4df543fb437d43651fad0ffe08a0d8106`. Its live implementation was inspected through Supabase; no `zeffy-webhook` source was found in the scanned CRM/Billing Hub/staff/website checkouts. Empty GitHub indexed code search was not treated as proof of global absence. Reconcile live-source provenance into the owning repository before changing the handler.

## Provider contract checked

Current [Zeffy API/OpenAPI](https://api.zeffy.com/api/docs): `Payment.amount`, item/refund amounts are **cents**, with currency. Status filters: `succeeded`, `pending`, `failed`. `payment.completed`/`created` include full payment data; `updated`/`deleted` carry an ID reference. Fetch `/api/v1/payments/{id}` for updates. Refund state: `none`/`partial`/`full`; refund records have IDs, cents, currency and pending/succeeded/failed status. Recurring data includes subscription ID, interval, status and period boundaries, but the published event list contains no dedicated subscription pause/cancel event or exhaustive recurring status enum. Metadata is reserved; click IDs are absent from the schema. Signature authentication uses timestamped raw-body HMAC; stable event IDs support retry dedupe. These documented fields are not runtime acceptance.

Implications for this implementation:

- Normalize provider cents once; retain original amount/currency and payment ID. Never copy Givebutter's old amount interpretation into Zeffy or use tax-eligible amount as a substitute for the gift amount.
- Separate event dedupe from payment dedupe: both created and completed can describe the same payment. Manual/imported records are not evidence of an online website checkout. Do not upload these captures merely because their status says succeeded.
- Resolve update references through authenticated reads, store refund/dispute changes as evidence, and reconcile net amounts. A refund request is not a successful refund; recurring subscription cancellation does not reverse past gifts. [Refund operations](https://support.zeffy.com/issue-refunds-and-manage-cancellations-sfeqf) support partial/full refunds, while Zeffy's voluntary platform contribution is separate.
- Do not infer active recurring status forever from a past installment. Confirm subscription-change notification guarantees and current status with Zeffy; plan periodic authenticated reconciliation if lifecycle changes do not emit an appropriate event. Preserve unknown states.

## Existing website and Google Ads intent

Inspected website commit `784d2c73237c91cb8f5ee6d43ecdaafa22655e80`:

- `src/components/DonateButton.tsx` opens the fixed Zeffy URL above in an on-site modal, with a direct-link fallback.
- `src/lib/tracking.ts` sends `begin_donation` and Ads conversion `AW-16798905432/2XDvCITusvcbENjoq8o-`, value `1 USD`, using a browser-generated handoff ID. It fires on opening, not confirmed payment. Keep this as the user's **Donation form opened** conversion; its configured Google Ads display name, primary/secondary setting and bidding role were not independently inspected. The nominal value is not actual donation revenue.
- `src/lib/donationAttribution.ts` stores click IDs/UTMs locally for up to 90 days; `DonationAttributionManager` captures them on route changes. Current DonateButton/tracker does not send that record or handoff ID into the Zeffy iframe or a server handoff endpoint. Its `data-donate-*` CTA attributes and gtag metadata do not make those fields appear in a Zeffy payment.
- Legacy deployed `donate-go` v19 still writes `donation_attribution` and returns a **Givebutter** URL with a `gbtoken` marker. It is not called by the inspected Zeffy modal path. Do not reuse that redirect unchanged. No route was invoked here.
- `donation_attribution` has 254 historical rows, 5 with a click ID; latest capture September 3. Zeffy captures have no observed `gclid`/`gbraid`/`wbraid`/handoff-ID/legacy token field, no UTM/source custom answers and empty metadata. No individual website/payment join is established by this data.

### Which fields can support matching?

| Field/evidence | What it can reliably establish | Limit |
| --- | --- | --- |
| Payment ID + authenticated provider account + campaign ID | A stable financial transaction, once authenticated and ownership mapped | Does not identify a website visit or ad click. |
| Event ID | Delivery dedupe | Created/completed are different events for the same payment. |
| Subscription ID | Relate recurring installments | Does not identify each installment's originating ad click; do not attribute every renewal to a new website conversion. |
| `buyer_questions` / documented UTM source | Source attribution if Zeffy persists it on the payment | Must confirm actual API/export question mapping and embedded-form behavior. Current captures have no such answers. |
| Opaque first-party checkout token paired server-side with click IDs | Deterministic visit/payment join **if** Zeffy round-trips it in verified payment data | Proposed bridge only, not implemented or proven supported through arbitrary URL/metadata fields. |
| Donor contact/email | A provider donor reference | Not a visit ID; shared email, repeat gifts, cross-device or timing guesses cannot prove an ad click. No email-based CRM merge/backfill. |

[Zeffy's UTM documentation](https://support.zeffy.com/utm-tracking-on-zeffy-forms-sbfs5) supports `utm_source` on donation form links, surfaced in donation details/custom-question-like output and exports. This establishes source reporting capability, not automatic support for `gclid`, arbitrary metadata, all UTM fields, or a unique checkout token in an iframe. Ask Zeffy to confirm a supported opaque-token/source round trip before relying on it; don't overwrite acquisition source with an internal CTA label. The current form's public `redirectUrl` is null.

[Zeffy's Analytics guide](https://support.zeffy.com/how-can-i-integrate-zeffy-with-google-analytics-bo9pn) describes visits and traffic sources, not payment interactions/conversion rates. An embedded form does not automatically expose its cross-origin payment state to the host page. A thank-you return alone must not become financial verification.

## Intended tracking contract

1. **Donation form opened:** retain the existing initial intent conversion and browser handoff identity. Do not rename its meaning to a paid gift or replace it with a payment event.
2. **Completed donation:** separate conversion action and ledger fact, derived from authenticated Zeffy success, mapped Foundation ownership, donation campaign/type, payment ID, actual amount/currency and reliable event/payment timing. Keep all verified donations in the Foundation ledger, even when unattributed. Exclude setup/manual/imported records from website-conversion uploads absent evidence of a real website-originated donation.
3. **Individual Ads attribution:** only when a verified payment can join a first-party capture containing a valid click identifier and required consent/time/account context. Use payment-based transaction IDs and separate upload states; leave unmatched gifts explicitly unattributed. Do not fabricate click matches from campaign name, donor email or close timestamps. [Google's click conversion requirements](https://developers.google.com/google-ads/api/docs/conversions/upload-offline) include conversion action/time/value/currency and click identifiers; transaction IDs also support duplicate control and later adjustments.
4. **Refunds/corrections:** reconcile partial/full successful refunds and disputes against the same payment; assess [conversion restatement/retraction](https://developers.google.com/google-ads/api/docs/conversions/upload-adjustments) against the actual completed-donation action. Do not erase the initial form-open event or historical gifts. No uploader or adjustment was run.

Separate actions preserve the funnel; do not add form-open count to paid-gift count as if both were donations. Current code/account evidence does not prove the completed-donation conversion action exists or is configured.

## Todoist requirements reconciliation

| Task | Still applies | Outdated / corrected scope |
| --- | --- | --- |
| 40 `6hj2hFVfJgfQCJMH` | Source-owned ledger, idempotency, amount/currency, recurring/refund reconciliation, reviewed contact links, manual prospect stage, tenant isolation | Zeffy is current. Prior hard-coded default tenant and Givebutter/campaign `565036` as current source are superseded. |
| Donor prerequisite `6hmFwP4FMMFf9Mmq` | Ownership, replay/concurrency, stable IDs, native lifecycle, no sends | Evaluate Zeffy independently; old processor/email-registry behavior is a legacy consumer risk, not the Zeffy contract. |
| 03A `6hhp2XjH89j9WGQH` | Protect legacy transaction view and preserve authorized historical reporting | Givebutter-specific view remains a security/retention task. Do not route Zeffy through it or require a current Givebutter subscription to review Zeffy. |
| 20/24 donor adapters/cards | Source-backed read-only giving facts, correct availability/tenant handling | Existing `crm_donors` aggregates are not proof of a Zeffy sync. |
| 42 `6hm9jrrxrXXxpPwq` | All existing acceptance remains deferred/open | Append Zeffy-specific checks; old campaign `565036` ownership requirement now applies only to legacy records/repair. |

## Missing configuration and exact next actions

1. **Authoritative ownership:** obtain the Foundation legal/account configuration and explicitly bind Zeffy organization/form to the correct Billing Hub tenant. The registry does not currently establish it. Do not create/choose a tenant automatically.
2. **Provider settings access:** inspect Zeffy owner Settings → Integrations for current enabled URL, event selections, recent delivery status and signing-secret availability; confirm whether the existing URL includes the shared-key parameter. Do not rotate/reconfigure it or expose the secret during review. Historical September capture is not current operational confirmation.
3. **Server credentials/provenance:** establish trusted Zeffy read-API and signing-secret bindings, and the repository owning the deployed capture function. Verify signed raw bodies and replay tolerance before financial ingestion; API-reconcile historical captures without blind processing.
4. **Recurring/refund completeness:** confirm notification guarantees for pause/cancel and authoritative payment status changes; define ID-only update fetch/reconciliation, successful refund/dispute accounting, and event/payment uniqueness. Preserve raw/audit history and legacy tables.
5. **Attribution bridge:** confirm with Zeffy a supported field that returns an opaque website checkout token/source on verified payments (or documented export). Then bind it to server-side click capture. Current payment metadata and browser-local storage do not provide this bridge. Confirm consent/window rules and completed-donation Ads action/account settings before any upload.

No retired Givebutter configuration is needed to finish these Zeffy steps. Givebutter retention/security work stays separate.
## Subsequent source implementation

Billing Hub draft [PR #15](https://github.com/LPredmore/valorwell-billing-hub/pull/15) now prepares signed raw-body capture, retry/conflict handling, pure payment/refund projection and an authenticated GET-only aggregate audit command. Source commits `ceccbd7` and `495d0ea`; no checks executed, no provider calls, no deployment/configuration changes and no ledger/Ads writes. The deployed v11 receiver described above remains the live evidence. Foundation tenant ownership and supported individual attribution are still unresolved. See `docs/zeffy-verified-capture-and-payment-review.md` in that PR for the concrete configuration and acceptance runbook.

