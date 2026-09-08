import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import { EmailStudioBlock, EmailStudioVariable } from '@/features/email-studio/studio/extensions';
import { createEmailStudioDocument } from '@/features/email-studio/studio/documents';
import { findNewsletterBlockPositionFromDom, getNewsletterBlockAtPosition, selectNewsletterBlockFromDom, getSelectedNewsletterBlock, updateNewsletterBlockAtPosition } from '@/features/email-studio/newsletter/newsletterVisualEditing';

describe('helpers vs real editor', () => {
  it('maps descendants', async () => {
    const ref = createRef<EmailEditorRef>();
    const doc = createEmailStudioDocument({ mode: 'newsletter', scope: 'marketing_newsletter', themeKey: 'valorwell' });
    render(<EmailEditor ref={ref} content={doc as never} extensions={[StarterKit, EmailTheming.configure({theme:'basic'}), EmailStudioBlock, EmailStudioVariable]} />);
    await new Promise(r => setTimeout(r, 800));
    const editor = ref.current!.editor!;
    const section = document.querySelector('section[data-email-studio-block="story"]') as HTMLElement;
    process.stderr.write('MARK-have-section\n');
    const pos = findNewsletterBlockPositionFromDom(editor, section.querySelector('h2'));
    process.stderr.write('MARK-pos ' + pos + '\n');
    expect(pos).not.toBeNull();
    const block = getNewsletterBlockAtPosition(editor, pos!);
    process.stderr.write('MARK-kind ' + block?.kind + '\n');
    expect(selectNewsletterBlockFromDom(editor, section.querySelector('h2'))).toBe(true);
    process.stderr.write('MARK-selected ' + getSelectedNewsletterBlock(editor)?.kind + '\n');
    expect(updateNewsletterBlockAtPosition(editor, pos!, { title: 'X' })).toBe(true);
    process.stderr.write('MARK-updated ' + getNewsletterBlockAtPosition(editor, pos!)?.title + '\n');
  });
});
