# Pass 14 — Production Hardening and Final Acceptance

## Decision

The non-clinical Business Development relationship implementation is accepted for production deployment. Outbound delivery activation remains intentionally held.

Production acceptance means the application, database contracts, safety controls, delivery boundaries, search, reporting, and operator workflows have passed the final implementation audit. It does not authorize messages to be sent.

## Controlled activation state

At final acceptance:

- relationship campaigns with `execution_enabled = true`: **0**
- relationship enrollments with `delivery_enabled = true`: **0**
- ready and active relationship provider configurations: **0**
- canonical relationship communications: **0**
- canonical relationship replies: **0**

Activation requires a separate operational decision after provider credentials, sender-domain verification, webhook configuration, approved campaign content, recipient review, and monitored canary procedures are confirmed.

## Security and tenancy review

- No relationship RPC is executable by the PostgreSQL `PUBLIC` role.
- Anonymous execution is limited to the opaque, replay-safe unsubscribe endpoint.
- Work claiming, delivery preparation, provider results, provider events, inbound reply ingestion, and provider configuration remain service-role only.
- Authenticated security-definer wrappers delegate to private functions that establish the current CRM actor and tenant before reading or mutating records.
- Search and reporting remain security-invoker operations; table RLS remains the row-level authority.
- Clinical clients, clinical campaigns, clinical communications, appointments, billing messages, and Creator & Community Interest remain outside this domain.

## Worker and webhook review

### Campaign worker

- Accepts POST only.
- Requires exact service-role bearer authorization.
- Refuses operation when the service-role key, Supabase URL, or provider API key is absent.
- Caps each claim to 50 work items and uses leased, idempotent database work.
- Uses provider idempotency keys.
- Records sent, retry, and terminal failure outcomes through service-only RPCs.
- Uses bounded exponential retry scheduling.

### Resend webhook

- Accepts POST only.
- Refuses operation when required runtime configuration is absent.
- Verifies the raw request body using Resend/Svix signature headers before any database mutation.
- Uses provider event IDs for replay-safe ingestion.
- Retrieves inbound email content only after signature validation.
- Calls only service-role ingestion RPCs.

## Database and performance review

- Representative tenant-scoped search and reporting calls were executed using the real CRM administrator context.
- Full-text contact search used the generated search document GIN index.
- Six reporting views are security invoker.
- Relationship search and reporting RPCs have fixed search paths and reject anonymous execution.
- Foreign-key index coverage was validated during the implementation passes.
- Advisor warnings for currently unused relationship indexes are retained because the production relationship tables are empty or low-volume and the indexes support planned foreign-key, queue, and search access paths.
- Multiple permissive RLS policies reflect the intentional administrator/operator role model; they do not grant cross-tenant access.
- Unrelated pre-existing Billing Hub advisor findings remain outside the relationship-domain acceptance scope.

## Failure recovery

- Enrollment, safety, delivery preparation, result recording, provider event ingestion, and reply ingestion use idempotency records or provider event uniqueness.
- Work claims use leases and retry ceilings.
- A failed or interrupted worker invocation cannot bypass the campaign, enrollment, provider, or safety gates.
- Suppression, unsubscribe, complaint, bounce, and reply-stop rules remain authoritative at claim and pre-send time.
- Terminally stopped enrollments do not resume automatically.

## Accessibility and operator truthfulness

- The system-status page distinguishes accepted implementation from held activation.
- Capability load failures use an alert role and keep database-dependent behavior disabled.
- Reporting preserves the distinction between a verified numeric zero and unavailable data.
- Search does not return a bulk directory for an empty query.

## Final release boundary

Pass 14 does not activate a provider, enable campaign execution, enable enrollment delivery, schedule a worker, or send a message. Those are controlled operational actions that remain outside the implementation merge.
