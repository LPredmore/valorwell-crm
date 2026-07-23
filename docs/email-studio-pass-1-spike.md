# Email Studio Pass 1 compatibility spike

## Scope

This pass is code-only. It introduces an isolated React Email Editor compatibility route and does not change database tables, RPCs, campaign persistence, message persistence, Resend delivery, campaign scheduling, suppressions, enrollment behavior, or production activation.

The spike is available at:

`/crm/email-studio-spike`

It is intentionally omitted from the CRM sidebar.

## Dependency decision

The spike pins `@react-email/editor` at the compatible `1.6.x` line through the repository lockfile. The application already satisfies the editor prerequisites:

- React 18
- Vite with package exports
- Node 22 CI
- TipTap 3

## What the spike proves

The route provides three seeded prototypes:

1. Direct Email
2. Campaign Email
3. Newsletter

Each prototype can:

- load TipTap JSON into the editor;
- insert a custom ValorWell callout block;
- insert structured personalization-variable nodes;
- export editor JSON, email-ready HTML, and plain text;
- reload the exported JSON by remounting the editor;
- display the generated HTML in a sandboxed iframe;
- display the generated plain text and JSON for inspection.

The custom variable extension exports canonical tokens such as `{{first_name}}` while preventing the operator from accidentally editing only part of the token in the visual editor.

## Rendering authority decision

Pass 1 selects **browser export plus server validation** for the next implementation passes.

Reasoning:

- The documented `EmailEditor` export API operates on a live TipTap `Editor` instance.
- The browser integration is directly supported and produces HTML, text, and JSON through one API.
- A Supabase Edge authoritative renderer would require the complete TipTap, ProseMirror, React Email, and React rendering dependency graph to be proven under Deno.
- That Deno compatibility has not been established by an official supported server-only JSON serializer API.
- Treating Edge rendering as available without executing that compatibility harness would be unsafe.

Therefore the next architecture should:

1. export JSON, HTML, and text in the browser;
2. send all three representations to a server validation boundary;
3. validate document schema, variable scope, URLs, images, compliance requirements, and allowed generated HTML;
4. calculate the authoritative render hash server-side;
5. persist only validated snapshots.

A later pass may replace this with authoritative Edge rendering only after a dedicated Deno test proves the exact dependency graph and output equivalence.

## Security boundary

The spike preview uses an iframe with an empty `sandbox` permission set. It does not relax or replace the CRM's global HTML sanitizer. The generated output is not persisted and is not sent through Resend.

## Acceptance evidence

Automated tests cover:

- document creation for all three modes;
- JSON deep-clone round trip;
- structured variable discovery;
- custom ValorWell block presence;
- the explicit rendering-authority decision.

The required application CI remains responsible for dependency installation, lint, application and tooling type checks, Vitest, and the production build.

## Deferred to Pass 2+

- Final canonical email content contract
- Complete variable registry and alias migration
- Mode-specific extension restrictions
- Production validation service
- Database storage
- Template versioning
- Asset upload
- Manual email integration
- Client campaign integration
- Relationship campaign integration
- Newsletter delivery
