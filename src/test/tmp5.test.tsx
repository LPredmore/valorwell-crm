import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientNewsletterEmailStudioComposer } from '@/features/email-studio/newsletter/ClientNewsletterEmailStudioComposer';
vi.mock('@/features/email-studio/templates/api', () => ({ getEmailStudioAccessContext: async () => ({ tenantId: 't', userId: 'u', role: 'admin' }) }));
describe('state churn', () => { it('tab click', async () => {
  render(<ClientNewsletterEmailStudioComposer scope="marketing_newsletter" />);
  await new Promise(r => setTimeout(r, 1000));
  process.stderr.write('MARK-rendered\n');
  fireEvent.click(screen.getByText('Email'));
  process.stderr.write('MARK-tab-clicked\n');
  await new Promise(r => setTimeout(r, 400));
  process.stderr.write('MARK-settled\n');
  expect(true).toBe(true);
}); });
