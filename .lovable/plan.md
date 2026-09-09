# Diagnosis: newsletter block clicks never reach the Block inspector

## Confirmed root cause

`@react-email/editor` 1.6.10 wraps ALL top-level document content in a `container` node at editor start-up. Our selection code assumes newsletter blocks are top-level children of the doc, so every lookup fails.

Runtime probe (real editor, real extensions, our real helpers):

```text
DOC TOP CHILDREN: [ 'container' ]
BLOCK POS: 1
SELECTION: NodeSelection from 1 to 2 depth 1 node emailStudioBlock
getSelectedNewsletterBlock => null
DOM tag: SECTION
resolveNewsletterBlockPositionFromDom => null
```

Evidence in the package: `dist/extensions-CbYVXbNU.mjs` defines a `container` node (`group: block`, `content: block+`, `defining: true`) plus a ProseMirror plugin `containerEnforcer` whose view runs `wrapInContainer(state)` when `hasContainerNode(doc)` is false. Newly loaded canonical drafts are therefore re-parented under `container` before the user ever clicks.

Consequences, in order of the click path:

1. `newsletter-email-canvas` `onMouseDownCapture` calls `selectNewsletterBlockFromDom` → `resolveNewsletterBlockPositionFromDom`, which scans only `doc.child(index)` and requires `child.type.name === 'emailStudioBlock'`. The single top-level child is `container`, so it returns `null` and our explicit NodeSelection is never set.
2. ProseMirror still selects the block natively — `emailStudioBlock` is `atom: true, selectable: true` and rendered `contenteditable="false"` — which is exactly the gold `.ProseMirror-selectednode` outline in the screenshot.
3. `selectionUpdate` fires, `syncEditorControls` runs, and `getSelectedNewsletterBlock` rejects the selection at `if (selection.$from.depth !== 0) return null` because the real depth is `1`.
4. With `nextSelectedBlock === null` and `editor.isFocused === true`, `syncEditorControls` takes the middle branch and actively clears `selectedPositionRef.current` and `setSelectedBlock(null)` — so the inspector falls back to the "Click a section…" empty state.

The second hypothesis is therefore also confirmed: the `depth !== 0` guard is wrong for this runtime, and `getNewsletterBlockAtPosition` / `updateNewsletterBlockAtPosition` / move / duplicate / delete share the same top-level-only assumption, so they would fail even if selection state were fixed.

## onReady / ref hypothesis: ruled out

`EmailEditor` renders `RefBridge` before `EmailEditorReadyBridge` as siblings. `RefBridge` uses `useImperativeHandle` (a layout effect) and `EmailEditorReadyBridge` uses `useLayoutEffect`; sibling layout effects run in render order, so `editorRef.current` is already populated when our `onReady` runs. Listeners do attach. `onReady` also receives an `EmailEditorRef` argument we ignore, which is a robustness nit but not the cause here.

## Why tests never caught it

`src/test/newsletter-editor-workspace.test.tsx` mocks `@react-email/editor`, and `src/test/newsletter-visual-editing.test.ts` builds hand-written fake editor objects with `$from.depth: 0` and a flat `doc.childCount`. No test runs the real editor, so the `container` wrapper never appears in CI.

## Fix direction (not applied in this turn)

1. Make block resolution depth-agnostic: locate `emailStudioBlock` nodes via `doc.descendants` and compute the block's own parent-relative index for move/up/down, instead of `doc.child` / `$from.index(0)`.
2. Replace `$from.depth !== 0` with a node-type check on the `NodeSelection` (`selection.node.type.name === 'emailStudioBlock'`).
3. Stop `syncEditorControls` from clearing a stored position when the editor is focused but no block node selection exists; clear only on a canvas click outside `[data-email-studio-block]` or when the stored node is gone.
4. Move canvas selection to a post-ProseMirror bubble `onClick` and adopt the resolved block into `selectedPositionRef` / `selectedBlock` / `inspectorTab='block'` explicitly.
5. Add a real-editor regression test (no `@react-email/editor` mock) asserting the doc is `container`-wrapped, that a click on a rendered `[data-email-studio-block]` descendant populates Title/Body, and that an edit dispatches a transaction.

Nothing else changes: no schema, migration, audience, scheduling, or delivery changes.
