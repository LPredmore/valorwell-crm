import { Editor as CoreEditor } from '@tiptap/core';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import { afterEach, describe, expect, it } from 'vitest';
import { EmailStudioBlock } from '@/features/email-studio/studio/extensions';

/**
 * The newsletter composer depends on @react-email/editor's FocusScopes
 * extension: it defaults to clearSelectionOnBlur, so focus leaving the canvas
 * resets the selection to Selection.atStart — which lands on the first block,
 * because authored content lives inside a container node. The composer keeps
 * its surrounding controls usable by registering them as focus scopes. These
 * tests pin that upstream behaviour so a dependency bump can't silently break
 * block editing again.
 */

type FocusScopeStorage = {
  registerScope: (element: HTMLElement) => void;
  unregisterScope: (element: HTMLElement) => void;
};

const mounted: Array<{ editor: CoreEditor; nodes: HTMLElement[] }> = [];

afterEach(() => {
  while (mounted.length) {
    const entry = mounted.pop();
    entry?.editor.destroy();
    entry?.nodes.forEach((node) => node.remove());
  }
});

async function mountEditor() {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new CoreEditor({
    element,
    extensions: [StarterKit, EmailTheming.configure({ theme: 'basic' }), EmailStudioBlock],
    content: {
      type: 'doc',
      content: [
        { type: 'emailStudioBlock', attrs: { kind: 'hero', title: 'FIRST', body: 'first body' } },
        { type: 'emailStudioBlock', attrs: { kind: 'story', title: 'SECOND', body: 'second body' } },
      ],
    },
  });
  mounted.push({ editor, nodes: [element] });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'emailStudioBlock') positions.push(pos);
    return true;
  });
  return { editor, positions };
}

function selectedTitle(editor: CoreEditor) {
  const selection = editor.state.selection as unknown as { node?: { attrs: Record<string, unknown> } };
  return selection.node?.attrs.title;
}

function blurEditorTo(editor: CoreEditor, nextFocus: Element) {
  editor.view.dom.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  editor.view.dom.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: nextFocus }));
}

describe('@react-email/editor focus scope contract', () => {
  it('resets the selection to the first block when focus leaves for an unregistered element', async () => {
    const { editor, positions } = await mountEditor();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    mounted[mounted.length - 1].nodes.push(outside);

    editor.commands.setNodeSelection(positions[1]);
    expect(selectedTitle(editor)).toBe('SECOND');

    blurEditorTo(editor, outside);

    expect(selectedTitle(editor)).toBe('FIRST');
    expect(editor.state.selection.from).toBe(positions[0]);
  });

  it('preserves the selection when focus moves into a registered scope', async () => {
    const { editor, positions } = await mountEditor();
    const panel = document.createElement('aside');
    const panelInput = document.createElement('input');
    panel.appendChild(panelInput);
    document.body.appendChild(panel);
    mounted[mounted.length - 1].nodes.push(panel);

    const focusScope = editor.extensionStorage.focusScope as FocusScopeStorage;
    expect(typeof focusScope?.registerScope).toBe('function');
    focusScope.registerScope(panel);

    editor.commands.setNodeSelection(positions[1]);
    blurEditorTo(editor, panelInput);

    expect(selectedTitle(editor)).toBe('SECOND');
    expect(editor.state.selection.from).toBe(positions[1]);
  });
});
