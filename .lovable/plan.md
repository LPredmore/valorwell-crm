

# Rich Text Email Editor

## What Changes

Replace the plain text `<Textarea>` with a rich text toolbar editor in all three email composition surfaces. This gives you bold, italic, underline, hyperlinks, and bulleted/numbered lists -- the formatting that matters for professional email.

## The Editor: Tiptap

Tiptap is the right choice here. It's the most widely used rich text editor in the React ecosystem, outputs clean HTML natively (which is exactly what HelpScout expects), and is modular so we only include what we need. No heavyweight WYSIWYG bloat.

### Why not other options:
- **react-quill**: Abandoned, React 18 compatibility issues
- **Slate.js**: Lower-level framework, requires building everything yourself -- overkill for a formatting toolbar
- **Draft.js**: Deprecated by Meta
- **Raw contentEditable**: Unreliable cross-browser HTML output

## Implementation

### 1. Install Tiptap (3 packages)

- `@tiptap/react` -- React bindings
- `@tiptap/starter-kit` -- bold, italic, lists, headings, etc.
- `@tiptap/extension-link` -- clickable hyperlinks with URL input

### 2. Create a shared `RichTextEditor` component

**New file: `src/components/crm/shared/RichTextEditor.tsx`**

A reusable component that wraps Tiptap with a formatting toolbar. Features:

- **Toolbar buttons**: Bold, Italic, Underline, Link, Bullet List, Ordered List
- **Link dialog**: Small popover to enter/edit a URL when the Link button is clicked
- **Props**: `value` (HTML string), `onChange` (returns HTML string), `placeholder`, `disabled`, `minHeight`
- **Styling**: Matches the existing input/textarea design (border, ring focus, background) using the project's Tailwind tokens so it looks native

The component manages Tiptap internally and exposes a simple string-in/string-out interface so the parent components don't need to know anything about Tiptap.

### 3. Update BulkComposeDialog

Replace the `<Textarea>` for the message body with `<RichTextEditor>`. Remove the manual plain-text-to-HTML conversion in `handleSend` since the editor already outputs HTML. The `body` state becomes an HTML string directly.

### 4. Update ReplyComposer

Replace the `<Textarea>` with `<RichTextEditor>`. The `text` field sent to the reply hook is already passed as the body to HelpScout -- it just becomes HTML instead of plain text. HelpScout's API accepts HTML in thread bodies natively.

### 5. Update CampaignStepEditor

Replace the email body `<Textarea>` (the one labeled "Body (HTML supported)") with `<RichTextEditor>`. The value is already stored as `email_body_html`, so this is a direct swap. The SMS textarea stays as plain text (SMS doesn't support formatting).

## What Stays the Same

- All database columns unchanged (they already store HTML strings)
- Edge function processing unchanged (already sends HTML to HelpScout)
- SMS composition stays as plain textarea (SMS is plain text by nature)
- Subject lines stay as plain `<Input>` (email subjects don't support HTML)
- The `onSend` / `onChange` callback signatures don't change -- they already expect HTML strings

## Files Changed

- **New**: `src/components/crm/shared/RichTextEditor.tsx`
- **Modified**: `src/components/crm/bulk/BulkComposeDialog.tsx`
- **Modified**: `src/components/crm/inbox/ReplyComposer.tsx`
- **Modified**: `src/components/crm/campaigns/CampaignStepEditor.tsx`

## New Dependencies

- `@tiptap/react`
- `@tiptap/starter-kit`
- `@tiptap/extension-link`

