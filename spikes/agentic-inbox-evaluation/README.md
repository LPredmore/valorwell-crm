# Agentic Inbox versus extending ValorWell CRM

Evaluated October 16, 2026. This is an isolated feasibility experiment, not a production feature or deployment. It adds no production imports, migrations, mailbox connections, or outgoing email.

## Decision

Keep the canonical CRM communications backend and Resend. Adapt useful Agentic Inbox components and selected email tools rather than importing its entire backend. Agentic Inbox has meaningful reusable code; saying it provides little or no benefit would be too strong.

This recommendation is specific to this CRM and the requested incoming-email capabilities. It is an architectural judgment based on the verified contracts below, not a measured proof that one implementation will require fewer total engineering hours. If the goal becomes replacing the entire email client, the value of its complete UI increases substantially.

## Exact sources

| Source | Pinned commit |
| --- | --- |
| [ValorWell CRM](https://github.com/LPredmore/valorwell-crm/tree/34b6ffecbe2ba22df489e1e874cd40d43df71aed) | `34b6ffecbe2ba22df489e1e874cd40d43df71aed` |
| [Cloudflare Agentic Inbox](https://github.com/cloudflare/agentic-inbox/tree/48039bb6785af34e592c2966f87cde2b255c4c80) | `48039bb6785af34e592c2966f87cde2b255c4c80` |

Relevant CRM source: `supabase/functions/crm-resend-email/index.ts`, `src/repositories/supabase/communications.ts`, `src/repositories/supabase/tasks.ts`, `supabase/functions/_shared/ai-ops.ts`, the existing inbox/communications UI, relationship Gmail ingestion and generated database types. Relevant upstream source: `workers/index.ts`, `workers/agent/index.ts`, `workers/lib/tools.ts`, `workers/durableObject/index.ts`, `app/routes/email-list.tsx`, `app/services/api.ts`, `app/queries/`, and `app/components/`.

## What exists and what remains

| Requested behavior | Existing CRM | Agentic Inbox | Integration still needed |
| --- | --- | --- | --- |
| Receive and associate incoming email | Resend webhook fetches received body, resolves tenant/contact/reply, persists the message; reply can stop a campaign | MIME receiver, mailbox/thread storage, folders and attachments | Broader mailbox ingestion where needed; preserve CRM linkage and campaign behavior |
| Turn messages into actions | Task repository already supports owner, contact and due time | Nine email tools, no CRM task/calendar tool in this revision | Typed action extraction, permission checks, approvals, deduplication and audit in either approach |
| Search conversations | Canonical messages are available; current list/thread grouping needs improvement | Existing email search and thread tools plus search UI | Tenant/context-aware queries; scheduled searches require a scheduler/job record in either option |
| Use CRM context in drafts | Existing AI request helper can be reused; no complete incoming-email drafting workflow | Auto-draft uses email/thread and configurable mailbox prompt | Build CRM context retrieval and relevance/permission filtering in either option |
| Draft when email arrives | Requires persistent draft/job storage and worker trigger | Built-in incoming-email auto-draft | Native worker or upstream adapter; retries, deduplication and review UI still matter |
| Learn from corrections | Requires a persistent preference/feedback design | Persistent chat and configurable prompt; automatic drafting explicitly uses fresh messages excluding chat history | Explicitly save approved preferences and retrieve them for future drafts; no automatic learning loop found in the inspected app |

Resend is the delivery/receiving transport; Agentic Inbox is an application plus agent. Stock Agentic Inbox uses Cloudflare Email Routing and its send binding. Keeping Resend means adapting the transport boundary; installing the app does not automatically attach to Resend or replace CRM policies.

## Executed experiments

Both applications built independently. The source harness ran **22 tests, 22 passed**; see [raw TAP results](results/tests.tap). Some passing tests deliberately reproduce a missing feature or undesirable behavior: this count is not a product-readiness score.

The harness bundles actual source exports. It does not replace either backend with a completely rewritten simulation:

- Original CRM inbound handler executes against a Supabase-shaped adapter backed by embedded PostgreSQL. Tests verify body persistence, client/reply association, repeated delivery handling and campaign response handling.
- Original CRM task repository creates the follow-up with the expected client, owner and timezone-qualified due date. A new prototype action layer provides sequential deduplication and rejects unauthorized/unknown actions.
- Original CRM Gemini helper constructs its actual request using synthetic CRM context and thread data. The prototype retains a failed draft job and retries it; sequential reruns of a completed job do not infer again.
- Original upstream MIME receiver, Drizzle mailbox implementation, SQLite migrations, email tools and agent execute against a small runtime shim and real SQLite. Search, thread retrieval, archive/read state and draft writes work.
- A new scoped adapter lets the unchanged upstream search/thread/read/draft tools operate over the same canonical CRM-shaped PostgreSQL records as the native path. The original upstream agent also creates a draft there when CRM context is explicitly supplied. Its generated draft identifier is preserved.
- Re-delivering the same RFC message to the unmodified upstream receive path creates two inbox entries and two drafts in this fixture. The CRM handler deduplicates the Resend provider ID. This is an observed path-level difference, not a claim about all Cloudflare delivery guarantees.
- Prior interactive chat corrections appear in interactive chat requests but are absent from incoming-email auto-draft requests. CRM context is also absent until the adapter adds it. This establishes request composition, not the quality of model reasoning.
- The upstream shared environment permits tools to select another mailbox. This matches its documented shared Cloudflare Access trust boundary, not a newly reported vulnerability. It does not implement the CRM's tenant/record permissions.
- The scanner failure fixture retains incoming mail while skipping the auto-draft.

The real upstream inbox list route also **server-rendered successfully with CRM React 18.3.1, Router 6.30.6 and Query 5.104.3**, after dependency/path aliases and the needed UI providers were supplied. A seeded synthetic message appeared in the HTML. See [UI probe result](results/ui-probe.json). Version differences alone do not establish incompatibility. This does not verify browser hydration, clicks, editor, attachment preview, styling, agent WebSockets or the entire application. Kumo/Tailwind styles still require a port or controlled inclusion.

## Why importing the entire app is additional work here

The CRM already has its canonical communications ledger, contact relationships, task system, tenant identity and Resend transport. Upstream has separate Durable Object SQLite mailboxes, R2 storage, Cloudflare Access and Email Routing/send bindings. A whole-backend adoption must either synchronize those records and policies reliably or replace/adapt those interfaces. It must also preserve CRM campaign reply handling, owner/tenant attribution and audit history. A separate deployment with a link or iframe is possible, but does not satisfy deep integration by itself.

Its UI is valuable. Folder/list/thread/reply/attachment workflows are materially more complete than the CRM's basic inbox. The experiment proves a route can render under the CRM runtime and that its tools can target CRM records. It does not prove importing every component is cheaper than matching the current CRM design. The useful next implementation is a CRM-native incoming-mail workspace, borrowing components after reviewing their dependency and styling cost.

## Concrete implementation sequence

1. Extend canonical incoming-mail retrieval and repair thread grouping using reply relationships/provider IDs. Cover general mailbox/relationship contacts as well as existing client-focused send paths. Preserve the existing inbound campaign behavior.
2. Add canonical draft/job/action storage, tenant RLS, transactional enqueue or a reconciler, claim/lease/retry semantics, and audit. The existing handler returns only `duplicate: true` without a message ID for client-message redelivery, so queue creation must not depend on retrying its success response after a missed enqueue.
3. Add CRM context retrieval, approved persistent preferences and a schema-validated draft worker using the existing model boundary. Reuse Agentic Inbox's tool structure/selected implementations where it reduces work.
4. Add draft review/edit/send, thread/search and follow-up actions in the CRM interface. General mailbox sends still need the correct sender/recipient, reply-header and policy handling; this spike intentionally implements no send bridge.
5. Add scheduled search/follow-up jobs with explicit timezone/ownership. The spike searches messages and stores a task due date; it does not implement recurring searches, calendar booking, or a scheduler.
6. Validate actual hosted inference quality/cost, real ingestion, migrations/RLS, concurrency, attachment handling, scopes and browser workflows before enabling production automation. Existing Gmail observation is not evidence of full read/write mailbox synchronization.

## Limits of the evidence

AI inference, Cloudflare runtime, R2 and external provider network calls are scripted boundaries. No live AI model was asked to interpret an email, and no measured inference cost or draft-quality comparison is claimed. Prompt-injection classifier accuracy is not tested. Action extraction is a typed fixture, not natural-language understanding. Search is keyword/filter based, not semantic search.

PostgreSQL uses a projection of actual CRM columns, not the full production migration/RLS suite. Actor tenant checks in the prototype do not establish deployed authorization. The queue/action implementation demonstrates sequential behavior; it is not concurrency-safe production processing. Preferences/context are synthetic projected records rather than a finished CRM context resolver. SQLite uses a small Node storage adapter rather than the deployed Cloudflare runtime. There is no full mailbox migration, provider cutover, real email send, live database write or deployed feature.

These results support feasibility and identify specific work each option requires. They do not validate an exact 40–70-hour estimate or a guarantee that every integration path is cheaper. The recommended hybrid minimizes replacing established CRM responsibilities while keeping the real upstream reuse demonstrated here.

## Reproduce

Use Node 24.19.0 or another compatible Node 24 runtime with `node:sqlite`.

From this branch's CRM root, put a checkout of upstream next to the CRM checkout (or set `AGENTIC_INBOX_SOURCE` to its absolute path), then pin it:

```bash
git clone https://github.com/cloudflare/agentic-inbox.git ../upstream-agentic-inbox
git -C ../upstream-agentic-inbox checkout 48039bb6785af34e592c2966f87cde2b255c4c80
npm --prefix ../upstream-agentic-inbox ci --ignore-scripts --no-audit --no-fund
```

The CRM's existing package/lock mismatch made ordinary `npm ci` fail (including Tiptap version mismatches). This was present before the spike. To reproduce the evaluated install without modifying the lockfile:

```bash
npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps --package-lock=false
node spikes/agentic-inbox-evaluation/build.mjs
node --test --test-reporter=tap spikes/agentic-inbox-evaluation/compare.test.mjs
node spikes/agentic-inbox-evaluation/ui-probe.mjs
```

The evaluated resolved packages included PGlite 0.5.10 and esbuild 0.25.12. The fallback install is not a fully locked reproducible dependency graph; source revisions are pinned, dependency ranges can resolve differently later. Independent app build commands were `npm run build` in each checkout. CRM build emitted the existing large-bundle warning; neither production package file was edited.

`generated/` and the generated SSR HTML are excluded from version control. All fixture email addresses use `.test`; no private email bodies or real CRM records are committed.
