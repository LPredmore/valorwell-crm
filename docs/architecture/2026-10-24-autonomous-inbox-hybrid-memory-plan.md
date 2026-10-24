# ValorWell Autonomous Inbox — Hybrid Memory Implementation Plan
Date: 2026-10-24
Status: Proposed architecture and acceptance gates; not authorization to process PHI or send messages
Primary project: Todoist "03 · Autonomous Inbox & Follow-through"; existing M2 memory task.
Repositories: LPredmore/valorwell-crm; existing Supabase Billing Hub CRM infrastructure.
Decision: Authoritative, permission-controlled memory stays in Supabase. Cloudflare Vectorize is a removable, non-authoritative semantic search index.

## Baseline verified 2026-10-24

- Existing database approximately 931 MB, low instantaneous connection pressure. Does **not** establish RAM/CPU headroom under peak load; collect actual performance telemetry before instance sizing.
- Existing private Autonomous Inbox action intents, append-only events, draft revisions, review hints and verified internal task receipts.
- No dedicated agent fact/policy/feedback/index-ledger storage found; PostgreSQL vector extension not installed. Do not enable pgvector in the primary merely to support the planned Vectorize layer.
- Current five cases have review-only classification. Human authored draft flow and narrowly scoped approved internal CRM task verification exist; no automatic AI reply drafting/sending is authorized.
- Existing Gmail/RingCentral ingest remains the source, subject to provider sync completeness and RingCentral webhook limitations. Do not confuse successful cron execution with complete inbound coverage.

## Non-negotiable principles

1. Supabase is the only authority for CRM identity, tenant membership, permissions, sourced facts, approved policies, action intents, outcomes and audit history.
2. Vectorize indexes contain **only nonclinical business** semantic representations plus opaque IDs and minimal scope metadata, never raw email bodies, names, clinical details, or policy secrets. Embeddings may disclose information; prohibit PHI/ePHI until documented contractual, legal and technical assessment.
3. Never use similarity scores as proof, access authorization or send permission. Every result is re-fetched from Supabase with role/tenant/sensitivity/source-version checks before use.
4. Approved rules and current operational facts are retrieved directly from Supabase every time they matter. Search-index eventual consistency cannot delay an opt-out, a correction, or a revoked permission.
5. Message ingest/CRM work continues if Cloudflare, embeddings, or the network fails. Fall back to exact Supabase lookups; flag ambiguous items for human review. Never silently discard.
6. Do not create a second CRM or shadow relationship graph. Index only concise memory derived from existing authoritative source IDs. Avoid full-text duplication and unbounded prompt histories.
7. Memory updates are versioned; corrections, supersession and deletion propagate to search with durable retries. All automatic actions remain subject to existing risk-tiered approval policies.
8. Feature flags: off -> shadow index -> shadow retrieve -> operator-visible suggestions -> wider read-only use -> separately authorized automation. Independent kill switch for external indexing and retrieval.

## Proposed data model — reuse existing CRM tables wherever possible

- private.agent_memory_facts: tenant_id, id, subject_kind, subject_id (existing CRM key), fact_type, brief_assertion, evidence/source_kind/source_record_id/source_revision, sensitivity, proposed/verified/obsolete state, confidence, observed_at/verified_at/expires_at, supersedes_id, creator/verifier. Immutable revision history or append-only associated events. Minimize content and set retention.
- private.agent_memory_policies: scoped approved business preferences, e.g. tenant, owner, workflow, organization or contact; priority, response tone, blocked or preferred categories, risk gate. Store text/value, version, effective period, approver, approval evidence, supersedes_id and revocation. Unapproved inference never becomes an automatic rule.
- private.agent_memory_feedback: original classification, corrected decision, scope, reason, actor, evidence, proposed-generalization versus approved rule. This may reference a case or canonical message without duplicating its body.
- private.agent_memory_index_jobs / index_state: memory_id, revision, model_id, index_alias/version, operation upsert/delete, idempotency key, queued/claimed/confirmed/failed/dead-letter, retry count, timestamps, last_safe_error_code, worker lease, checksum and external mutation ID where available.
- private.agent_memory_retrieval_log: case, requesting actor/service, tenant, retrieval mode, index version, matched IDs, citations, latency, fallback/error code; no prompts, PHI or secrets. Limit retention.
- Expose only least-privilege, audited CRM RPCs; private tables RLS, no direct anon or authenticated access. Require a backend permission gate for every result, not just Vectorize namespace.

## Retrieval contract

A. Resolve canonical sender/contact/organization/active case in the CRM. If ambiguous, don't guess.
B. Fetch current approved preferences, stop-contact rules and relevant active task/appointment/relationship facts from indexed relational queries (always, even if Vectorize is down).
C. Only if needed, generate a permitted nonclinical query embedding and search Vectorize within allowed tenant namespace and category; small topK (initially 5-10), no unnecessary values/text returned.
D. Resolve returned opaque memory IDs in a batched, permission-filtered Supabase query. Reject deleted, stale, revoked, wrong-tenant, insufficient-evidence, wrong-sensitivity or wrong-version results. Link the exact originating CRM evidence.
E. Compose concise model context from verified evidence; clearly distinguish facts, proposals, old history and uncertainty.
F. Apply current action policy in Supabase before creating any task, draft or outbound intent. Nonclinical AI analysis and non-send draft assistance require separate approval; no PHI access or outbound sends by default.
G. If external retrieval fails or times out, finish deterministically from Supabase or send to review. Record degradation; do not hold up provider ingest.

## Cloudflare contract and cost of integration

- Start with a distinct nonclinical test index and production index only after acceptance. Decide embedding model and dimensions based on measured retrieval quality; Vectorize index dimensions/metric cannot change in place, so use versioned indexes for model upgrades.
- Use Cloudflare Vectorize REST API from an existing Supabase Edge Function (Cloudflare Worker not required for V1) with narrowly scoped account API token stored in server-side secrets. No token in client code or PostgreSQL row data.
- Cloudflare namespace by tenant, metadata filtering on low-sensitivity scope fields only. Namespace is a search narrowing mechanism, NOT the authorization boundary. Store opaque IDs rather than source content in vector metadata.
- Optional Cloudflare Workers AI embeddings may be benchmarked against other permitted providers on nonclinical data; treat embeddings as potentially sensitive. Track the embedding model and version per index. Cloudflare index writes are asynchronous; track applied versions and shadow consistency rather than assume read-after-write.
- Supabase durable work queue or existing suitable isolated worker pattern. Evaluate pgmq against a private leased outbox; choose the simplest proven option and keep it isolated from billing/applicant notification work.
- Implement batch upserts and deletes, bounded concurrency, exponential retries, dead letter review, periodic checksum/count reconciliation, safe token rotation, rebuild-from-Supabase script, and full index export/rebuild procedure.
- Never persist clinical data or PHI on Cloudflare absent an explicitly approved BAA/service-scope/security review.

## Delivery phases and completion gates

### P0 — Baseline and safe evaluation set
- Measure Supabase primary CPU, memory, disk I/O, cache hit, slow queries and pooler under normal and burst conditions, plus per-message execution time.
- Build 100-200 synthetic or explicitly approved nonclinical business scenarios across known senders, irrelevant vendor pitches, new partner inquiries, scheduled replies, corrections and conflicting preferences. Include opt-out, account ambiguity, cross-tenant attempts, outages and prompt injection. Label expected importance, relationship, memory facts, action restrictions.
- Outcome: documented baseline + reproducible test harness, no live user message exfiltration.

### P1 — Source-of-truth memory and governance
- Implement versioned private facts/policies/feedback, source references and audit hooks; use existing case/actions. Approve a small starter set of operator preferences and protected rules.
- Security tests: tenant isolation, least privilege, corrections, deletions, authorizations, expired facts, case linkage; deterministic policy precedence.
- Outcome: safe Supabase-only memory retrieval and editable Memory & Preferences CRM view before external dependency.

### P2 — Cloudflare test integration
- Create versioned test index and scoped token, choose embedding model/dimensions by benchmark. Build adapter interface: exact_only, vectorize, disabled. Add index ledger/queue and Edge worker.
- Upsert minimal nonclinical memories; compare 100% indexed count by source revision; delete/replace/rebuild tests.
- Outcome: no policy-authority ambiguity; no real PHI in tests; zero failed index jobs left undetected.

### P3 — Hybrid shadow retrieval
- For identical test/business scenarios compare Supabase-only vs hybrid; capture p50/p95/p99 latency, CPU/RAM, retrieval precision, missed critical facts, index lag, provider errors, cost.
- Run in shadow (responses not used to drive cases/actions) until acceptance. Deliberately simulate API outage, stale index, revoked preference, wrong tenant, duplicated writes.
- Proposed quality gates: **zero cross-tenant or protected data leaks; zero unsupported automatic sends; no missed opt-outs; critical-importance recall at least 98% on validated held-out samples**. Establish feasible measured p95 latency objective before production rather than promising a number; hybrid should not materially worsen end-to-end response time.
- Outcome: documented evidence whether hybrid actually improves performance enough to justify its extra moving parts.

### P4 — Operator visibility and feedback learning
- CRM Memory & Preferences page: grouped facts, evidence/source links, active/revoked state, who approved, recency, editing/revocation controls, suggestion confidence, and retention/deletion requests.
- Inline importance/irrelevance/correction feedback on cases, with proposed scoped rule changes requiring approval for broad generalization.
- Outcome: corrections persist, approved rules apply immediately (even when Cloudflare unavailable), and search index catches up after.

### P5 — Graduated enablement and monitoring
- Enable suggestions for nonclinical traffic only after gates pass; 5%, 25%, then 100% read-only rollout with feature switch and instant fallback to Supabase exact lookup. Expand to approved internal CRM automations separately.
- Monitor ingest-to-index lag, stale/tombstoned results, queue depth and oldest age, error/retry/dead-letter counts, mismatch counts, relevance accuracy, p95 query time, model spending, Supabase CPU/RAM, and missed high-priority items.
- Daily reconciler: independently compare Supabase verified revisions with Vectorize index state; report differences without deleting authoritative data.
- Outcome: security and performance evidence from actual provider-connected nonclinical workload; rollback/rebuild demonstrated.

### P6 — Later expansion, separate authorization
- Native nonclinical message analysis, editable AI drafts and approved actions after quality evaluation. PHI/clinical routing only after separately approved protected processing and proper contracts.
- Add Google Drive policy document ingestion on approved sources, indexing concise citations rather than duplicating entire documents.
- Video/social-media workload stays in background processing or dedicated compute; Vectorize is not a video processing engine and does not replace a Supabase compute upgrade if core CRM workloads need it.

## Rollback and upgrade rules

- No forced Cloudflare dependency in inbox ingest or critical case state updates.
- Kill switch disables vector reads and new indexing immediately; exact memory/approved rules remain available in Supabase.
- Can recreate Vectorize from authorized, current source facts and revisions, including deletes; confirm index parity before restart.
- Supabase compute is upgraded based on actual sustained CPU, memory, I/O, slow query and recovery data, not raw vector count. Prioritize operational resilience and backup/restore drills over speculative compute sizing.

## Open setup inputs (do not fabricate)
- Confirm which existing Cloudflare account is approved for ValorWell, its token creation owner and nonclinical data-region/security controls.
- Approve nonclinical memory scope and any embedding/LLM provider contract; prohibit PHI otherwise.
- Final embedding model and dimensions after P0 benchmark, not before.
- Authorized staff roles and rule-approval policy for CRM Memory & Preferences.
- Confirm provider indexing budget and desired external performance SLO after observing realistic test data.

## References
- https://developers.cloudflare.com/vectorize/get-started/intro/
- https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
- https://developers.cloudflare.com/vectorize/platform/limits/
- https://developers.cloudflare.com/api/resources/vectorize/
- https://supabase.com/docs/guides/queues
