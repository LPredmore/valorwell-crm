# Campaign creation and relationship import blocker repair

## Reported symptoms

1. The primary CRM Campaigns page displayed existing campaigns but offered no way to create one.
2. Relationship CSV import appeared to remain in an importing state indefinitely.

## Campaign root cause and repair

The primary `/crm/campaigns` page was implemented as a read-only table. The existing `CampaignEditor` and campaign creation mutation already supported a new campaign when the route parameter is `new`, and the existing `/crm/campaigns/:id/edit` route therefore accepts `/crm/campaigns/new/edit`.

The Campaigns page now:

- shows a capability-gated **New campaign** button
- routes authorized operators to the existing new-campaign editor
- disables the action for roles without `manage_campaigns`
- links campaign names to their detail pages
- displays explicit loading, empty, query-error, and retry states

No campaign schema or campaign delivery behavior changed.

## Import root cause

The live PostgreSQL and Data API logs identified the exact failing condition:

> A matching organization appeared after preview for row 42. Refresh and resolve the import again.

The private transactional commit function correctly detected that relationship data changed after the preview was created. However, it raised SQLSTATE `40001`, which means serialization failure. PostgreSQL/PostgREST treated this ordinary application conflict as a retryable transaction rollback, repeatedly retried the complete import transaction, and eventually returned HTTP `504`.

The browser therefore remained in the pending mutation state until the gateway timeout and looked like an endless import.

## Database repair

Migration `20260723215000_relationship_import_stale_preview_errors.sql` updates all six stale-preview guards in `private.commit_relationship_import`:

- SQLSTATE changes from retryable `40001` to non-retryable `P0001`
- detail is `RELATIONSHIP_IMPORT_STALE_PREVIEW`
- hint tells the operator to create a refreshed server preview and resolve newly detected matches

The commit remains atomic. No partial organization, contact, opportunity, affiliation, referral, social-profile, or interaction rows survive a rejected commit.

## Application diagnostics

Every relationship import repository operation now produces a privacy-safe diagnostic on failure:

- diagnostic ID
- operation: preview, reload, resolve, or commit
- preview ID when one exists
- expected version when supplied
- timestamp
- PostgREST error code
- message
- detail
- hint
- stale-preview classification

Diagnostics intentionally exclude:

- CSV contents
- raw or normalized rows
- organization/contact candidate records
- imported email addresses, phone numbers, websites, or notes

The existing import screen renders the enhanced error message. For a stale preview, the message explicitly directs the operator to use **Create server preview** again with the retained CSV and mapping, review any newly detected conflicts, and commit the new preview.

## Production verification

The migration was first executed inside a transaction and rolled back. The test found six stale-preview guards and zero remaining `40001` guards.

After applying the migration to Billing Hub:

- the live function contained six `RELATIONSHIP_IMPORT_STALE_PREVIEW` guards
- no `40001` remained
- a rollback-only authenticated commit test against the affected ready preview returned `P0001` with the expected structured detail
- the test transaction was rolled back
- no import rows were committed by validation

## Boundaries

This repair does not:

- automatically choose a duplicate resolution
- silently merge organizations or contacts
- force creation when a new match appears
- weaken tenant isolation or CRM capability checks
- change campaign scheduling, enrollment, or delivery
- change clinical campaign behavior
