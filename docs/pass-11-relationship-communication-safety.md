# Pass 11 — Relationship communication safety

## Scope

Pass 11 adds the non-clinical Business Development safety boundary for relationship outreach in Billing Hub and `valorwell-crm`.

It includes:

- Tenant-scoped suppression records for global, organization, contact, email, and campaign scopes.
- Deterministic precedence and reason severity with complete matched-suppression evidence.
- Immutable suppression identity and optimistic versioned revocation.
- Hashed, expiring, single-use unsubscribe tokens issued only by the service role.
- Anonymous unsubscribe processing with replay-safe outcomes and no token-existence disclosure.
- Append-only unsubscribe requests, enrollment events, and relationship interactions.
- Current-policy revalidation against DNC state, contact email, affiliations, opportunity readiness, campaign state, verified referral evidence, and active suppressions.
- Automatic enrollment invalidation and dormant-work cancellation when safety inputs change.
- Operator suppression management and enrollment safety-review workflows.
- Public unsubscribe confirmation that is explicitly separate from clinical, billing, appointment, and client communications.

## Deterministic precedence

Suppression scope precedence is:

1. Global
2. Email
3. Contact
4. Organization
5. Campaign

Within a scope, reason severity is:

1. Complaint
2. Unsubscribe
3. Do not contact
4. Invalid address
5. Bounce
6. Manual
7. Campaign stop

All active matches are retained in the safety snapshot; the first ordered match is the primary suppression.

## Execution boundary

Pass 11 does not send messages, call a delivery provider, create outbound communication records, process replies, or enable campaign execution.

The database continues to enforce:

- `relationship_campaigns.execution_enabled = false`
- `relationship_campaign_enrollments.delivery_enabled = false`

Work claiming also re-evaluates current safety policy transactionally. Pass 12 must implement delivery and reply handling before any work can be claimed or sent.

## Revocation behavior

Revoking or allowing a suppression to expire never resumes a prior enrollment automatically. A terminal suppressed enrollment remains terminal. A new enrollment requires a new explicit eligibility and safety review.

## Verification

Rollback testing covers:

- safety-ready enrollment with delivery disabled;
- locked zero-work claims;
- suppression application and idempotent replay;
- global-over-email precedence;
- suppression revocation without automatic resumption;
- contact DNC invalidation;
- verified-referral revocation invalidation;
- anonymous unsubscribe, replay, and invalid-token handling;
- terminal campaign stop behavior;
- role and direct-write privilege boundaries;
- zero residual fixtures and unchanged execution/delivery locks.
