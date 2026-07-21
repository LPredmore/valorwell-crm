# Pass 9 — Relationship campaign foundation

## Scope

Pass 9 establishes the non-clinical Business Development campaign definition layer in Billing Hub and `valorwell-crm`.

It includes:

- Campaign identity, purpose, initiative, owner, sender, lifecycle, timezone, and intended send-window definitions.
- A structured campaign brief aligned to the ValorWell campaign operating model.
- Ordered subject/body steps with delay, active, and stop-on-reply definitions.
- Tenant-scoped persistence, RLS, explicit grants, audit attribution, optimistic versioning, and idempotent save/status operations.
- Campaign register, filtering, creation, editing, activation-readiness checks, and guarded lifecycle controls.

## Hard boundary

`relationship_campaigns.execution_enabled` is constrained to `false` in the database.

Pass 9 does not:

- enroll any contact or organization;
- schedule or claim due work;
- send email or call a provider;
- create communication records;
- process replies;
- use clinical CRM campaigns, enrollments, communications, or schedulers.

An `active` campaign means only that the campaign definition passed the Pass 9 readiness checks. Execution remains unavailable until the enrollment, safety, delivery, and reply passes are separately completed and verified.

## Verification

Live authenticated rollback tests covered draft creation, activation readiness, versioned updates, stale-version rejection, activation, idempotent replay, pause transitions, read-only mutation denial, direct-write denial, and cleanup.

Static privilege verification confirms anonymous users cannot read campaign tables or execute campaign mutation RPCs. Authenticated users receive direct table reads only; mutations occur through tenant- and role-checked RPCs.
