# Gmail-Like Inbox Implementation

## Status: ✅ Completed

The inbox now uses thread-based direction detection to match Gmail's behavior.

## How It Works

1. **Edge function embeds threads** via `?embed=threads` in the HelpScout API call
2. **Determines `lastMessageBy`** from the most recent non-note thread:
   - `thread.type === 'customer'` → `lastMessageBy: 'customer'` → **Inbox**
   - `thread.type === 'reply' || 'message'` → `lastMessageBy: 'staff'` → **Sent**
3. **Inbox view**: Shows conversations where customer last messaged (needs reply), always Active status
4. **Sent view**: Shows conversations where staff last messaged (awaiting client), with optional status filter

## Key Files Changed

- `supabase/functions/helpscout-proxy/index.ts` - Embeds threads, computes `lastMessageBy`
- `src/lib/crm/types.ts` - Added `lastMessageBy` and `needsReply` fields
- `src/pages/crm/Inbox.tsx` - Gmail-style Inbox/Sent tabs
- `src/components/crm/inbox/InboxSentTabs.tsx` - New tab component
- `src/components/crm/inbox/SentStatusFilter.tsx` - Status filter for Sent view
- `src/components/crm/inbox/ConversationListItem.tsx` - Simplified, uses server-computed `needsReply`
- `src/hooks/crm/useConversations.ts` - Uses `view` param instead of `direction`
