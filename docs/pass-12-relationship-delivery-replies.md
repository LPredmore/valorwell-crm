# Pass 12 — Relationship delivery and replies

## Scope

Pass 12 adds the canonical non-clinical delivery and reply path for Business Development relationship outreach.

It includes:

- Canonical outbound and inbound relationship communications in Billing Hub.
- Append-only provider and CRM communication events.
- Provider-neutral database contracts with a Resend delivery boundary.
- A service-only campaign worker with retry and provider idempotency handling.
- A signed Resend webhook that verifies the raw webhook payload before ingestion.
- Hashed unsubscribe-token issuance during final delivery preparation.
- Final transactional safety revalidation before a communication is rendered or sent.
- Delivery-result recording for sent, retryable failure, and terminal failure outcomes.
- Delivery, bounce, complaint, and provider-failure event handling.
- Automatic email suppression and enrollment revalidation after bounces or complaints.
- Inbound reply matching through explicit communication context, provider message/thread identifiers, and tenant-scoped inbound-address fallback.
- Replay-safe inbound event and message processing.
- Canonical reply records with ownership, status, follow-up date, optimistic versioning, and audit events.
- Stop-on-reply behavior that marks the enrollment responded and cancels remaining dormant or claimed work.
- Operator delivery-readiness controls and a non-clinical reply queue.

## Controlled activation

Direct table writes cannot enable relationship campaign execution or enrollment delivery.

The controlled activation RPC requires:

1. An active relationship campaign.
2. At least one active campaign step.
3. A verified Resend sender matching the campaign sender.
4. A verified inbound reply address.
5. A signed webhook endpoint marked verified.
6. A service-only worker marked verified.
7. A compliance postal address.
8. Current safety-ready enrollments.

Disabling or suspending the provider closes campaign and enrollment delivery gates. Work claiming and delivery preparation re-evaluate the gates transactionally.

## Provider separation

Provider secrets, work claiming, provider sends, webhook processing, provider event ingestion, and inbound message ingestion remain service-only. Browser code receives tenant-filtered canonical JSON through read RPCs and cannot invoke delivery-worker or webhook mutation contracts.

Clinical campaigns, clinical communications, client records, appointments, billing messages, and Creator & Community Interest are not reused.

## Delivery integrity

A work item cannot complete unless a canonical outbound communication for that exact work item is recorded as sent or delivered. The provider call uses the communication ID as its provider idempotency key. Result recording and provider webhooks use independent database idempotency ledgers.

## Reply integrity

Every actionable reply references one canonical inbound communication. A reply cannot be created from an unmatched provider event. When the originating campaign step has `stop_on_reply = true`, the enrollment transitions to `responded`, delivery is disabled, and remaining planned, retry-waiting, or claimed work is cancelled atomically.

## Verification

Rollback testing covers:

- direct execution and delivery activation denial;
- activation denial without provider readiness;
- controlled activation with complete readiness proofs;
- final safety revalidation;
- deterministic rendering with unsubscribe and postal-address content;
- one canonical outbound record per work item;
- provider send result and work advancement;
- delivered-event matching and replay protection;
- inbound reply matching and replay protection;
- reply workflow optimistic versioning;
- stop-on-reply cancellation of a later campaign step;
- unmatched inbound events remaining unattached;
- zero residual fixtures and zero production execution/delivery gates.
