import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';
vi.mock('@/features/email-studio/templates/api', () => ({ getEmailStudioAccessContext: async () => ({ tenantId: 't', userId: 'u', role: 'admin' }) }));
describe('render', () => { it('clicks', async () => {
  render(<ClientNewsletterEmailStudioComposer scope="marketing_newsletter" />);
  await new Promise(r => setTimeout(r, 1200));
  process.stderr.write('MARK-rendered\n');
  const sections = Array.from(document.querySelectorAll('section[data-email-studio-block]')) as HTMLElement[];
  const target = sections.find(s => s.dataset.emailStudioBlock === 'story')!;
  fireEvent.mouseDown(target.querySelector('h2')!, { bubbles: true });
  process.stderr.write('MARK-mousedown\n');
  fireEvent.click(target.querySelector('h2')!, { bubbles: true });
  process.stderr.write('MARK-click\n');
  await new Promise(r => setTimeout(r, 500));
  process.stderr.write('MARK-settled ' + (document.getElementById('newsletter-block-title') as HTMLInputElement)?.value + '\n');
  expect(true).toBe(true);
}); });
