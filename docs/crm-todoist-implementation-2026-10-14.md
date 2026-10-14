# CRM Todoist implementation batch — October 14, 2026

Status: implemented in source, verification deferred at the user's request. This batch is not merged or deployed and does not mark any roadmap phase complete.

Repository: LPredmore/valorwell-crm. Base: main 27fd88b. Branch: codex/crm-todoist-implementation. Workspace: C:\Users\predm\OneDrive\Documents\Database Migration\valorwell-crm-todoist.

The Todoist master roadmap is task 6hhmHVFjqc5rmjCq. The appended final verification checklist is task 6hm9jrrxrXXxpPwq, with eight nested checks. Existing phases 10, 13, 17, 27 and 34 remain open while this incremental implementation awaits acceptance.

## Implemented

- Contact and organization directory owner filters select named tenant team members while preserving profile IDs in the existing query contract.
- Organization editing uses the same named owner control; unknown/historical owners retain selection without showing UUIDs.
- Contact organization filtering now offers searchable, paged organization names instead of requiring a pasted organization UUID. Selected organizations outside the current page remain represented.
- Contact/org detail summaries resolve owner names and remove the redundant raw organization UUID beneath affiliation links.
- Contact/org directories, details, capability snapshots and relevant opportunity views include operating tenant and user in their query keys. Capability caches additionally include role and refresh after one minute. No operating tenant means these queries remain disabled; existing RLS/provider scoping is preserved.
- Organization affiliated contacts and linked relationship opportunities now paginate rather than silently stopping at 100 records.
- Contact/organization editing, lifecycle changes and affiliation creation invalidate compatible scoped detail/list caches. Affiliation search is debounced and hides outdated choices while the input has changed.
- Organization create/edit/save and opportunity creation UI respect the existing mutate capability. Organization form state resets when tenant or record changes.
- Recruiter queue search, state, review stage, quality, follow-up, assigned-to-me and page are URL-backed. Prospect detail links preserve those filters and provide a return to the filtered queue. Unsupported filter values are ignored; pagination is disabled while loading.
- Canonical dashboard card counts show an unavailable/loading state instead of displaying zero or stale success data after a source error.
- The account-menu icon has an accessible label.
- Existing component fixtures were adjusted for newly explicit authentication contexts; they have not been executed.

## Deferred verification

Todoist checklist: https://app.todoist.com/app/task/6hm9jrrxrXXxpPwq

1. Full lint, TypeScript, unit/regression suite, build, boundary/provenance and required CI.
2. Tenant/user/role switching and cache isolation using independent identities in an isolated environment.
3. Named owner/organization controls, unknown selection, errors, paging and combined URL filters.
4. More than 100 affiliated contacts/opportunities, edit invalidation and identity/Primary preservation.
5. Recruiter queue reload/back/forward/detail return/reset and malformed URL behavior.
6. Dashboard loading/error/stale/empty states, readonly actions, mobile keyboard and accessibility.
7. Remaining original acceptance and authenticated smoke checks, coordinated with existing roadmap and remediation tasks.
8. Review, cleanup, merge and normal frontend deployment after verification; rollback by reverting this batch.

No test, lint, type-check, build, browser acceptance, production data writes, migrations or Edge deployments were performed for this implementation batch. No outreach, invitation, newsletter, SMS, payment, social queue or publisher changes were made. Research identity reconciliation, deliberate global Primary decisions, donor payment ingestion, live invitation redirects and independently authenticated production acceptance remain separate work; existing code presence is not completion evidence.
