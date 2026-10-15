# Recruitment to staff handoff continuation

Source implemented in draft PR #154; unmerged, undeployed and NOT VERIFIED. No applicant, staff, invitation, delivery, clinical, payroll or payer record was changed.

## Existing source contract

Inspected `valorwell-staff` commit `2386d0334b23c67febc038bdb8f4971d9b8d7bda`, its `ProviderApplicantsWorkspace`, contract hooks and `ProviderApplicantRow`, plus the live `staff_list_provider_applicants(text,text,integer,integer)` definition. Staff owns approvals and the existing approve-then-provision/invite flow. `ready` means Approved; `hired` means Onboarding started. Neither implies invitation delivery, completed onboarding or payer credentialing. Existing source returns `convertedStaffId`, `ownerName`, next action and due date, with source-side search/status/page filters and matching total.

The CRM board excludes hired/closed applicants and is a preview. It must not become the only means of tracking an application after approval. The staff workspace currently has no supported exact-applicant URL selector; do not invent a query parameter that silently opens a different record.

## Source changes

- New `/crm/recruitment/applicants` read-only queue includes all actual source statuses, including onboarding and closed records, using existing RPCs only. Page size is 50; source matching count is separate from the loaded count. Search/status/page are URL-backed, and drafts/caches reset across tenant, user, role and URL changes.
- Before every listing, require the staff-authorized tenant to equal the selected CRM tenant. The list RPC independently authorizes staff access. CRM capability alone does not grant applicant access, and no direct protected-table read is added. A staff permission error remains unavailable, not an empty list.
- Project only name, status, named owner, next action/due and linked staff reference into this view. Returned email/phone, communications, followup notes and other source fields are discarded by the projection. No persistent copy or general relationship timeline entry is created.
- Board/list applicant cards expose the same handoff guidance and source references from their existing authorized response. Queue links are available from the clinician stage navigator and prospect queue. All staff links use the known source workspace; operators locate the actual applicant by name/reference.
- An Approved record without a staff link calls for source review before retry; linkage is explicitly not delivery proof. No provisioning, approval, retry invitation, capacity, license or network availability action is added to CRM.

## Deferred acceptance and limitations

Prepared domain and repository test source; NOT RUN. Task 42 must cover role/tenant rejection before list, source permission errors, >50 records, Approved/hired/closed visibility, matching totals, malformed contract and URL values, back/forward, loading/error/retry, cache isolation, due dates, linked/unlinked/inconsistent source evidence and adjacent pipeline actions. Confirm native staff approval/retry remains the sole handoff mutation and no message is sent by reading/navigation.

Existing list RPC uses due-date/created-time offset ordering without a unique tie breaker. Concurrent changes/equal timestamps may shift page membership; this queue is not a complete audit export. No DB ordering contract was changed in this batch. Exact applicant deep links and invitation-delivery/retry idempotency acceptance require a separate reviewed staff-side integration. Payer/region availability requires authoritative credentialing evidence. Rollback these source changes through GitHub; there is no new DB migration to reverse.
