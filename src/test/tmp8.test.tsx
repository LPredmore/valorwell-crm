import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createRef } from 'react';
import { EmailEditor, type EmailEditorRef } from '@react-email/editor';
import { StarterKit } from '@react-email/editor/extensions';
import { EmailTheming } from '@react-email/editor/plugins';
import { EmailStudioBlock, EmailStudioVariable } from '@/features/email-studio/studio/extensions';
import { createEmailStudioDocument } from '@/features/email-studio/studio/documents';
import { selectNewsletterBlockFromDom } from '@/features/email-studio/newsletter/newsletterVisualEditing';

describe('listener recursion', () => {
  it('sync on transaction', async () => {
    const ref = createRef<EmailEditorRef>();
    const doc = createEmailStudioDocument({ mode: 'newsletter', scope: 'marketing_newsletter', themeKey: 'valorwell' });
    render(<EmailEditor ref={ref} content={doc as never} extensions={[StarterKit, EmailTheming.configure({theme:'basic'}), EmailStudioBlock, EmailStudioVariable]} />);
    await new Promise(r => setTimeout(r, 800));
    const editor = ref.current!.editor!;
    let count = 0;
    const sync = () => {
      count += 1;
      if (count > 50) { process.stderr.write('MARK-runaway\n'); throw new Error('runaway'); }
      editor.can().undo();
      editor.can().redo();
    };
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    process.stderr.write('MARK-attached\n');
    const section = document.querySelector('section[data-email-studio-block="story"]') as HTMLElement;
    selectNewsletterBlockFromDom(editor, section.querySelector('h2'));
    process.stderr.write('MARK-selected count=' + count + '\n');
    expect(true).toBe(true);
  });
});
