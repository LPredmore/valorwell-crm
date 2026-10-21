# Native baseline owner review packet

Status: **independent approval not provided; release ineligible**.

The original `valorwell-app-schema-20261020-163929.sql` was not recovered from the
authorized workspace or connected Drive search. A replacement schema-only catalog
capture was assembled using explicit read-only transactions. No application,
patient, Auth-user, Storage-object or payroll records, passwords, vault values or
provider credentials were queried for the baseline.

The private candidate is `/workspace/retest-private/development-candidate-complete`.
Its manifest SHA256 is
`74cc42947a6cd7320d991e78d43f80c80e49dcca2187ca9e690deba58de06521`.
Keep its catalog/function definitions and executable migration outside GitHub.
The separately generated private CLI migration is a current-state development
candidate, not a reconstruction of missing historical migration bodies.

The capture includes 31 catalog categories and all 17 inventoried namespaces.
The runnable application subset includes all six application/import/legacy-backup
namespaces: public, private, credentialing, import, backup_20260710_pre_ehr_work,
and backup_20260712_pre_overhaul_table_changes_v1. This is 597 tables and 37 views.
Unknown namespaces now stop finalization for explicit classification.

Two capture passes had unchanged source-row fingerprints and the same 966-version
ledger boundary, maximum `20261020214527`. They remain separate transactions,
not an atomic global snapshot. The ledger/source mapping includes each version,
name, statement count and statement-array hash; eight versions have no retrievable
bodies. No historical entries were inserted into any test or production ledger.

Supplemental private metadata retains Auth's 82, Storage's 74 and Realtime's 91
migration entries. All 478 database settings were fingerprinted; required values
were allowlisted, with other values withheld to avoid possible secrets. The
production engine identifies PostgreSQL 17.6/aarch64; the native image is
17.6/amd64. Exact hosted service build IDs have not been established from these
migration inventories and must not be invented.

Review the following concrete evidence before signing:

* All 46 server-redacted rows against their source hashes. Redaction removes
  recognized capabilities before transfer and changes executable semantics.
* The strict catalog comparison for the final native run. Classify every remaining
  difference, including managed functions, roles/memberships, default ACLs,
  publications, extensions, dependencies and omitted hosted historical ledgers.
  No broad role grant, replacement helper, blanket managed-difference allowlist,
  fabricated migration history or RLS disablement is an acceptable repair.
* Genuine Auth signup/profile creation, signed native PostgREST tests, the generic
  Realtime broadcast probe, and application/worker results. Broadcast transport
  success does not prove Realtime tenant authorization or hosted UAT.
* Seven captured extension requirements, including pg_net 0.19.5. The native
  pg_net schema location and pg_graphql/platform configuration differ.
* Automated catalog review: 927 SECURITY DEFINER functions have explicit
  search_path configuration; one constraint is unvalidated, no indexes are invalid,
  and 188 application/import/backup tables have RLS disabled in the source.
  These are review targets, not automatically validated vulnerabilities or approvals.
* Storage failures under captured policies and the separately staged tenant-metadata
  candidate. The new candidate requires authenticated current tenant, matching
  metadata, membership and CRM write capability. Legacy untagged objects fail
  closed for writes. The signature uploader supplies metadata; do not attribute
  legacy objects or backfill production without an owner-reviewed mapping.

The native payroll extension reproduced HTTP 500/P0002 for a foreign clinician
lookup without returning a statement. A private generated forward candidate changes
only that denial branch to 42501/HTTP 403. Source definition SHA256:
`94a270c6385aa7102c875ec6f6590bd343afc9bbb804419ecfe2ebd84838650e`;
candidate SQL SHA256:
`1da469903a9bcd8fea465ff98622b7e89078840ea4affa81115b3c109e617436`.
Review its body privately under the final run's `derived-source-private` directory.
Native checks confirm unchanged ownership/ACLs, preserved own-staff totals and
foreign denial. It is not an approved production migration.

Approval record (remain blank until independently completed): reviewer identity,
review time, exact candidate manifest hash, exact source commits, accepted parity
specification, disposition of each difference/redaction, legacy asset attribution
plan, and signed decision. Approval of this candidate does not authorize P6,
provider transactions, deployment, production SQL or migration-history changes.
