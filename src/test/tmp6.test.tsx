import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';
vi.mock('@/features/email-studio/templates/api', () => ({ getEmailStudioAccessContext: async () => ({ tenantId: 't', userId: 'u', role: 'admin' }) }));
describe('ev', () => { it('click', async () => {
  render(<ClientNewsletterEmailStudioComposer scope="marketing_newsletter" />);
  await new Promise(r => setTimeout(r, 1000));
  process.stderr.write('MARK-rendered\n');
  const s = document.querySelector('section[data-email-studio-block="story"]') as HTMLElement;
  fireEvent.click(s.querySelector('h2')!, { bubbles: true });
  process.stderr.write('MARK-fired\n');
  await new Promise(r => setTimeout(r, 400));
  process.stderr.write('MARK-settled\n');
  expect(true).toBe(true);
}); });
