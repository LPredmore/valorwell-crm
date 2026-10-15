// Prepared only; execution deferred to Todoist task 42.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { state, mutate } = vi.hoisted(() => ({ state: { query: {} as Record<string, unknown> }, mutate: vi.fn() }));
vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => ({ capabilities: { mutate: false } }) }));
vi.mock('@/hooks/canonical/useCrmData', () => ({
  useExceptions: () => state.query,
  useStaffList: () => ({ isSuccess: true, data: [], isError: false }),
  useExceptionMutations: () => {
    const action = { mutate, isPending: false, error: null };
    return { resolve: action, dismiss: action, reassign: action, createTask: action };
  },
}));
import CanonicalExceptions from './CanonicalExceptions';
const example = { id: 'exception', type: 'Manual Review Required', severity: 'High', status: 'Open',
  summary: 'Synthetic exception', createdAt: '2026-10-15T12:00:00Z' };
beforeEach(() => { vi.clearAllMocks(); state.query = { isSuccess: true, data: [example], isLoading: false, isError: false }; });
afterEach(cleanup);
describe('operational exceptions permission and failure presentation', () => {
  it('shows a readonly record without mutation controls', () => {
    render(<CanonicalExceptions />);
    expect(screen.getByText('Synthetic exception')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Task' })).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('hides cached results after failure without claiming an empty queue', () => {
    state.query = { ...state.query, isSuccess: false, isError: true, error: new Error('Denied'), refetch: vi.fn() };
    render(<CanonicalExceptions />);
    expect(screen.queryByText('Synthetic exception')).toBeNull();
    expect(screen.queryByText('No operational exceptions returned.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry exceptions' })).toBeTruthy();
  });
});
