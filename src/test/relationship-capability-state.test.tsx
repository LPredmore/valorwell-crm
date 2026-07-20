import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RelationshipCapabilityState } from '@/components/crm/relationships/RelationshipCapabilityState';
import type { CapabilityAvailability } from '@/domain/relationships/contracts';

const state = (status: CapabilityAvailability['status'], diagnostic?: string): CapabilityAvailability => ({ capability: 'organizations', status, available: status === 'available', reason: 'internal', diagnostic });

describe('RelationshipCapabilityState', () => {
  it('renders a loading state', () => {
    render(<RelationshipCapabilityState isLoading />);
    expect(screen.getByLabelText('Loading relationship capability')).toBeInTheDocument();
  });

  it('renders a safe retry state without exposing diagnostics', () => {
    const onRetry = vi.fn();
    render(<RelationshipCapabilityState isError onRetry={onRetry} />);
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each(['pending', 'missing_contract', 'permission_denied', 'network_error', 'query_error', 'invalid_response'] as const)('renders the %s state without raw diagnostics', status => {
    render(<RelationshipCapabilityState state={state(status, 'secret diagnostic')} />);
    expect(screen.queryByText('secret diagnostic')).not.toBeInTheDocument();
    expect(screen.getByText(/Database support pending|Access required|Connection unavailable|Service unavailable|Service response unavailable/)).toBeInTheDocument();
  });
});
