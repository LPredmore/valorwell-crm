# Source candidates for eight migrations with missing ledger SQL bodies

**Verified 2026-10-20.** The Billing Hub production ledger contains **962** migration versions; the eight entries below have `statements IS NULL` or `cardinality(statements)=0`. Each version's matching `supabase/migrations/*.sql` file **exists on the named repository's `main` branch**, and its GitHub blob SHA and UTF-8 size were independently retrieved.

| Ledger version | GitHub source repository / filename | Blob SHA | Size |
| --- | --- | --- | ---: |
| `20260813090700` | [Staff — retire_documented_completion_authority](https://github.com/LPredmore/valorwell-staff/blob/main/supabase/migrations/20260813090700_retire_documented_completion_authority.sql) | `995c3fe06d425f6a075a97b8b656d3a90ec3c81e` | 10,192 |
| `20260813090800` | [Staff — harden_documented_projection_trigger](https://github.com/LPredmore/valorwell-staff/blob/main/supabase/migrations/20260813090800_harden_documented_projection_trigger.sql) | `452902a65597d177e76a18e0aeaf32ef94e6fb0f` | 571 |
| `20260813090900` | [Staff — canonical_reschedule_completion_guard](https://github.com/LPredmore/valorwell-staff/blob/main/supabase/migrations/20260813090900_canonical_reschedule_completion_guard.sql) | `7df7c74fd54d1d5ceb62564e7f7d769a682596de` | 4,067 |
| `20260813091500` | [Clients — canonical_qualifying_session_lifecycle](https://github.com/LPredmore/valorwell-clients/blob/main/supabase/migrations/20260813091500_canonical_qualifying_session_lifecycle.sql) | `2a232450ee44bf0674c4b4be4a766986b02ed069` | 22,022 |
| `20260813091600` | [Clients — harden_at_risk_scheduler](https://github.com/LPredmore/valorwell-clients/blob/main/supabase/migrations/20260813091600_harden_at_risk_scheduler.sql) | `db1d3b3956f0a27e931bec965ef02c3ed2bb5f75` | 1,299 |
| `20260813093500` | [Clients — canonical_therapist_relationship_evidence](https://github.com/LPredmore/valorwell-clients/blob/main/supabase/migrations/20260813093500_canonical_therapist_relationship_evidence.sql) | `8342db4d30dbcaae6cab9bce166590b2278cd335` | 20,215 |
| `20260813100500` | [Clients — retire_legacy_containment_authority](https://github.com/LPredmore/valorwell-clients/blob/main/supabase/migrations/20260813100500_retire_legacy_containment_authority.sql) | `c1736a8c1613b20c3103677e98b0dffe8a0fef52` | 5,340 |
| `20261015015000` | [CRM — crm_identity_review_links_current_tenants](https://github.com/LPredmore/valorwell-crm/blob/main/supabase/migrations/20261015015000_crm_identity_review_links_current_tenants.sql) | `a35b43911d8f05a98c0297f03eab8e332719a43e` | 14,088 |

**What is resolved:** Each of these eight `version` numbers can be mapped to a concrete source file. No versions had to be inferred or invented.

**What is NOT resolved:** The production ledger does not retain the original statement body for these eight entries. A filename and blob SHA do not independently prove that an identical SQL body was run at the time. Comparing today's objects, function definitions, triggers, grants and available deployment evidence is required. Executing the files again against an existing production schema may duplicate or mutate state and is **not** authorized. Do not copy historic patient, payroll, claim or user data into a preview to test them.

For the clean-preview branch gate, the **earliest December 2025 baseline is still missing** from the four checked-in repositories. These eight recovered source files are later in the sequence and **do not** fix the first/second/third migrations' dependency ordering.

**Next:** Attach each source file to the authoritative baseline inventory with an explicit applied-object mapping, then decide whether a source-supported pre-December bootstrap exists or whether to adopt a complete current-state schema-only baseline. Keep production migration history unchanged pending a reviewed rollout.
