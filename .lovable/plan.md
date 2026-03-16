

# Fix: Replace Unique Constraint with Partial Unique Index

## The Problem

The current constraint `UNIQUE (tenant_id, client_id)` on `crm_campaign_enrollments` is a blanket uniqueness rule — it prevents a client from ever having more than one row in the table, regardless of status. This breaks the system when a client finishes one campaign and a trigger tries to enroll them in another.

## The Decision: Partial Unique Index

**Drop the existing unique constraint and replace it with a partial unique index** that only enforces uniqueness for `active` enrollments:

```sql
CREATE UNIQUE INDEX crm_campaign_enrollments_one_active
ON crm_campaign_enrollments (tenant_id, client_id)
WHERE status = 'active';
```

**Why this is the right approach:**

1. **It matches the actual business rule.** The rule is "one active campaign per client at a time" — not "one campaign ever." A partial index enforces exactly this, at the database level, with zero application-code workarounds.

2. **It preserves history.** A client can accumulate multiple rows (`responded`, `completed`, `cancelled`, `paused`) while the index blocks a second `active` row. This is critical for audit trails and campaign analytics.

3. **Both triggers already assume this model.** `cancel_campaign_on_status_change` marks the old enrollment as `responded` (no longer `active`), then `enroll_campaign_on_status_change` checks for `status = 'active'` before inserting. The only thing preventing this from working is the overly broad unique constraint.

4. **No application code changes needed.** The frontend hooks (`useEnrollClients`, `useCampaignEnrollments`) already filter by status. The trigger functions already guard against duplicate active enrollments. This is purely a constraint fix.

## Migration

A single migration with two statements:

1. `ALTER TABLE crm_campaign_enrollments DROP CONSTRAINT crm_campaign_enrollments_unique_client;`
2. `CREATE UNIQUE INDEX crm_campaign_enrollments_one_active ON crm_campaign_enrollments (tenant_id, client_id) WHERE status = 'active';`

## What About `paused`?

A `paused` enrollment is not `active`, so it won't block new enrollments. This is intentional — if a staff member pauses a campaign and the client's status changes, the cancel trigger won't catch it (it only targets `active`), but the new enrollment can still proceed. The paused enrollment becomes historical. If we later want paused enrollments to also block new ones, we extend the partial index to `WHERE status IN ('active', 'paused')`. For now, the simpler rule is correct.

## Verification

Current data (3 responded, 4 completed, 1 cancelled, 1 paused, 0 active) is fully compatible — no active duplicates exist, so the new index will apply cleanly.

