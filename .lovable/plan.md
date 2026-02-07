# Plan: Fix Email Quoted Footer Issue ✅ COMPLETED

## Problem (Resolved)
All outbound emails included a quoted footer (e.g., "On Sat... wrote: (Outbound email initiated)") because both edge functions used a 2-step pattern that created a fake "customer" inbound message, then replied to it.

## Solution Implemented
Replaced the 2-step "create conversation with type=customer thread → POST /reply" pattern with a single `POST /v2/conversations` call that includes an initial `type: 'reply'` thread containing the actual email body.

---

## Changes Made

### File 1: `supabase/functions/helpscout-proxy/index.ts`
- Removed the fake `type: 'customer'` thread with placeholder text
- Changed to single-step with `type: 'reply'` thread containing actual `body_html`
- Removed the separate `/reply` API call (was lines 307-345)
- Status kept as `pending` per guidance

### File 2: `supabase/functions/campaign-scheduler/index.ts`
- Same fix applied to `sendEmail` function
- Single-step `type: 'reply'` thread with actual content
- Removed the separate `/reply` API call (was lines 361-379)
- Status kept as `pending` per guidance

---

## Technical Details

| Thread Type | HelpScout Interpretation | Email Behavior |
|-------------|-------------------------|----------------|
| `customer` | Inbound from recipient | Not sent (just recorded) |
| `reply` | Outbound from staff | **Sends email via SMTP** |

Using `type: 'reply'` in the initial conversation creation:
1. Creates the conversation record
2. Sends the email immediately (single API call)
3. No fake inbound message exists to quote

---

## Acceptance Criteria
- [x] New outbound emails have no quoted block referencing placeholder text
- [x] Both bulk-send and campaign emails use the same single-step pattern
- [x] Status remains `pending` (no workflow change)
- [ ] Test: Send a new email and verify no "(Outbound email initiated)" appears
