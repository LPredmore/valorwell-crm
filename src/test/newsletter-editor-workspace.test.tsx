import { forwardRef, useImperativeHandle } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewsletterEditorWorkspace } from '@/features/email-studio/newsletter/NewsletterEditorWorkspace';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';

vi.mock('@react-email/editor', () => ({
  EmailEditor: forwardRef(function MockEmailEditor(_props: Record<string, unknown>, ref) {
    useImperativeHandle(ref, () => ({
      getEmail: async () => ({ html: '<p>Test</p>', text: 'Test' }),
      getJSON: () => ({ type: 'doc', content: [] }),
      editor: null,
    }));
    return <div data-testid="mock-email-editor" />;
  }),
}));

vi.mock('@react-email/editor/extensions', () => ({
  StarterKit: {},
}));

vi.mock('@react-email/editor/plugins', () => ({
  EmailTheming: { configure: () => ({}) },
}));

vi.mock('@/features/email-studio/templates/api', () => ({
  getEmailStudioAccessContext: async () => ({
    tenantId: 'tenant-test',
    userId: 'user-test',
    role: 'admin',
  }),
}));

afterEach(() => {
  document.body.style.overflow = '';
});

describe('N3.1 newsletter editor workspace', () => {
  it('uses a full-screen authoring shell instead of the old constrained dialog', () => {
    const { unmount } = render(
      <NewsletterEditorWorkspace
        title="New newsletter"
        name="Weekly"
        subject="This week at ValorWell"
        reason="Weekly draft"
        autosaveStatus="saved"
        savePending={false}
        saveDisabled={false}
        onNameChange={() => undefined}
        onSubjectChange={() => undefined}
        onReasonChange={() => undefined}
        onClose={() => undefined}
        onPreview={() => undefined}
        onSave={() => undefined}
        audienceControls={<span>Clients · 100 deliverable</span>}
      >
        <div data-testid="workspace-body">Editor</div>
      </NewsletterEditorWorkspace>,
    );

    const workspace = screen.getByTestId('newsletter-editor-workspace');
    expect(workspace).toHaveClass('fixed', 'inset-0');
    expect(screen.getByTestId('workspace-body')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Export canonical content')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders independent block, canvas, and settings regions around a true email-width canvas', () => {
    render(<ClientNewsletterEmailStudioComposer scope="marketing_newsletter" />);

    expect(screen.getByTestId('newsletter-authoring-layout')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-block-library')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-canvas-region')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-settings-panel')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-formatting-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('newsletter-email-canvas')).toHaveClass('w-[648px]');
    expect(screen.getByTestId('mock-email-editor')).toBeInTheDocument();
    expect(screen.queryByText('Export canonical content')).not.toBeInTheDocument();
  });
});
