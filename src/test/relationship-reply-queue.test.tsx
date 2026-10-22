import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RelationshipReplyQueuePage from '@/pages/crm/business-development/RelationshipReplyQueuePage';
import { dataProvider } from '@/services/dataProvider';
vi.mock('@/hooks/relationships/useRelationshipCapabilities', () => ({ useRelationshipCapability: () => ({ capability: { available: true }, isLoading: false, isError: false }) }));
vi.mock('@/components/crm/relationships/RelationshipCapabilityState', () => ({ RelationshipCapabilityState: () => null }));
vi.mock('@/services/dataProvider', () => ({ dataProvider: { relationships: { listReplies: vi.fn(), updateReply: vi.fn() } } }));
const list = vi.mocked(dataProvider.relationships.listReplies);
const reply = { id: 'reply', communicationLogId: 'comm', receivedAt: '2026-10-21T00:00:00Z', senderEmail: 'sender@example.invalid', recipientEmail: 'info@example.invalid', body: 'Synthetic reply', status: 'new' as const, version: 1, metadata: {}, createdAt: '', updatedAt: '' };
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RelationshipReplyQueuePage /></QueryClientProvider>); }
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
describe('reply queue operator visibility', () => {
  it('allows access to replies beyond the first 100 and resets paging on filter changes', async () => {
    list.mockImplementation(async (filters) => ({ items: [{ ...reply, id: `reply-${filters?.page}`, subject: `Page ${filters?.page} reply` }], total: 101, page: filters?.page ?? 1, pageSize: 100 }));
    show();
    await screen.findByText(/Page 1 reply/);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText(/Page 2 reply/);
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Unowned only'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, unownedOnly: true })));
  });
  it.each([undefined, 'owner'])('surfaces explicit owner review even with owner=%s and leaves due dates unset', async (ownerId) => {
    list.mockResolvedValue({ items: [{ ...reply, ownerId, metadata: { owner_review_required: true } }], total: 1, page: 1, pageSize: 100 });
    show();
    await screen.findByText(/Owner review required:/);
    expect(screen.getByLabelText('Follow-up due')).toHaveValue('');
    expect(dataProvider.relationships.updateReply).not.toHaveBeenCalled();
  });
  it('surfaces legacy unowned replies even without review metadata', async () => {
    list.mockResolvedValue({ items: [reply], total: 1, page: 1, pageSize: 100 });
    show();
    await screen.findByText(/Owner review required:/);
  });
  it('does not mark a verified owned reply for review', async () => {
    list.mockResolvedValue({ items: [{ ...reply, ownerId: 'owner' }], total: 1, page: 1, pageSize: 100 });
    show();
    await screen.findByText('Synthetic reply');
    expect(screen.queryByText(/Owner review required:/)).not.toBeInTheDocument();
  });
});
