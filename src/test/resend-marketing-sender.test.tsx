import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ResendConfigPanel } from '@/components/crm/settings/ResendConfigPanel';
import type { ResendSettings } from '@/hooks/crm/useResendSettings';

const mutateAsync = vi.fn();

const settings: ResendSettings = {
  tenant_id: 'tenant-1',
  from_name: 'ValorWell Support',
  from_email: 'info@valorwell.org',
  marketing_from_email: null,
  marketing_from_name: null,
  reply_to_email: 'info@valorwell.org',
  inbound_email: null,
  postal_address: '100 Main Street, Lee’s Summit, MO',
  connection_status: 'connected',
  last_verified_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

vi.mock('@/hooks/crm/useResendSettings', () => ({
  useResendSettings: () => ({
    settings,
    isPending: false,
    isConnected: true,
    testConnection: { mutateAsync: vi.fn(), isPending: false },
    updateSettings: { mutateAsync, isPending: false },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue(settings);
});

describe('Resend marketing sender configuration', () => {
  it('saves a dedicated marketing sender for newsletters, normalized', async () => {
    render(<ResendConfigPanel />);

    fireEvent.change(screen.getByLabelText('Marketing from email (newsletters)'), {
      target: { value: '  News@News.ValorWell.org  ' },
    });
    fireEvent.change(screen.getByLabelText('Marketing from name'), {
      target: { value: '  ValorWell News  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      marketing_from_email: 'news@news.valorwell.org',
      marketing_from_name: 'ValorWell News',
      // the transactional identity must not be disturbed
      from_email: 'info@valorwell.org',
      from_name: 'ValorWell Support',
    });
  });

  it('sends null when the marketing sender is left empty so delivery falls back to the transactional sender', async () => {
    render(<ResendConfigPanel />);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      marketing_from_email: null,
      marketing_from_name: null,
    });
  });
});
