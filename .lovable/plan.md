

# Quick-Send from Client Profile

## What Changes

On the client detail page, clicking the email address or phone number will open the in-app compose dialog instead of the browser's native `mailto:` / `tel:` handler. Clicking the email opens the email compose dialog (with rich text editor and signature selection). Clicking the phone number opens the SMS compose dialog.

Both dialogs send to that single client using the existing bulk send infrastructure (which already handles single-recipient sends).

## How It Works

### ClientInfoCard gets compose dialogs

The `ClientInfoCard` component will:

1. Import `BulkComposeDialog` and `SmsComposeDialog`
2. Import `useBulkSend` and `useBulkSms` hooks
3. Add state for which dialog is open (`emailOpen` / `smsOpen`)
4. Replace the `<a href="mailto:...">` with a clickable button/link that sets `emailOpen = true`
5. Replace the `<a href="tel:...">` with a clickable button/link that sets `smsOpen = true`
6. Render both dialogs at the bottom of the component, each with `recipientCount={1}`
7. Wire `onSend` for email to call `createBulkSend.mutateAsync({ clientIds: [client.id], subject, bodyHtml })`
8. Wire `onSend` for SMS to call `createBulkSms.mutateAsync({ clientIds: [client.id], bodyText })`

### Progress modals

After sending, the existing `BulkProgressModal` and `SmsProgressModal` will show send progress, just like the bulk actions from the client list. These will also be rendered in the component, triggered by the bulk send/sms IDs returned from the mutations.

## Files Changed

- `src/components/crm/detail/ClientInfoCard.tsx` -- Add dialog state, replace native links with click handlers, render compose + progress dialogs

No new files. No database changes. Reuses all existing compose dialogs, hooks, and progress modals.

