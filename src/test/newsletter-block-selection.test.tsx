import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';

vi.mock('@/features/email-studio/templates/api', () => ({
  getEmailStudioAccessContext: async () => ({
    tenantId: 'tenant-test',
    userId: 'user-test',
    role: 'admin',
  }),
}));

beforeAll(() => {
  // ProseMirror's mousedown handler calls document.elementFromPoint, which
  // jsdom does not implement.
  if (!document.elementFromPoint) {
    (document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null;
  }
});

async function renderComposer(onDirty?: () => void) {
  render(<ClientNewsletterEmailStudioComposer scope="marketing_newsletter" onDirty={onDirty} />);
  await waitFor(() => {
    expect(document.querySelectorAll('section[data-email-studio-block]').length).toBeGreaterThan(1);
  });
  return Array.from(document.querySelectorAll('section[data-email-studio-block]')) as HTMLElement[];
}

describe('newsletter block selection against the real email editor', () => {
  it('selects a block when a descendant element inside it is clicked and populates the inspector', async () => {
    const sections = await renderComposer();
    const target = sections.find((section) => section.dataset.emailStudioBlock === 'story');
    expect(target).toBeTruthy();
    const heading = target!.querySelector('h2') as HTMLElement;
    expect(heading).toBeTruthy();

    fireEvent.mouseDown(heading, { bubbles: true });
    fireEvent.click(heading, { bubbles: true });

    const title = await waitFor(() => screen.getByLabelText('Title') as HTMLInputElement);
    expect(title.value).toBe(target!.dataset.title);
    expect(title.disabled).toBe(false);
    const body = screen.getByLabelText('Body') as HTMLTextAreaElement;
    expect(body.value).toBe(target!.dataset.body);
  });

  it('applies inspector edits to the selected block in the canvas and marks the draft dirty', async () => {
    const onDirty = vi.fn();
    const sections = await renderComposer(onDirty);
    const target = sections.find((section) => section.dataset.emailStudioBlock === 'callout')!;

    fireEvent.mouseDown(target.querySelector('p') ?? target, { bubbles: true });
    fireEvent.click(target.querySelector('p') ?? target, { bubbles: true });

    const title = await waitFor(() => screen.getByLabelText('Title') as HTMLInputElement);
    fireEvent.change(title, { target: { value: 'Edited callout title' } });

    await waitFor(() => {
      const updated = Array.from(document.querySelectorAll('section[data-email-studio-block="callout"]')) as HTMLElement[];
      expect(updated.some((section) => section.dataset.title === 'Edited callout title')).toBe(true);
    });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Edited callout title');
    expect(onDirty).toHaveBeenCalled();
  });

  it('keeps the locked compliance footer selectable but non-editable', async () => {
    const sections = await renderComposer();
    const locked = sections.find((section) => section.dataset.locked === 'true');
    expect(locked).toBeTruthy();

    fireEvent.mouseDown(locked!, { bubbles: true });
    fireEvent.click(locked!, { bubbles: true });

    const title = await waitFor(() => screen.getByLabelText('Title') as HTMLInputElement);
    expect(title.disabled).toBe(true);
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });
});
