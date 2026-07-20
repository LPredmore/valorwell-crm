import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmRelationshipAction, PermissionedRelationshipAction, RelationshipAuditMetadata, RelationshipPagination, RelationshipTimelineShell, SafeExternalLink } from '@/components/crm/relationships/RelationshipWorkspacePrimitives';
import { useRelationshipUrlFilters } from '@/hooks/relationships/useRelationshipWorkspace';

function FilterProbe() {
  const { searchParams, setFilter, resetFilters } = useRelationshipUrlFilters();
  return <><output data-testid="filter-query">{searchParams.toString()}</output><button onClick={() => setFilter('stage', 'identified')}>Set stage</button><button onClick={resetFilters}>Reset</button></>;
}

describe('relationship workspace primitives', () => {
  it('disables unavailable or unauthorized actions with an explanation', () => {
    render(<PermissionedRelationshipAction label="Save" allowed={false} capabilityAvailable onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTitle('You do not have permission for this action.')).toBeInTheDocument();
  });

  it('uses safe external links and accessible pagination controls', () => {
    const change = vi.fn();
    render(<><SafeExternalLink href="https://example.test">Evidence</SafeExternalLink><RelationshipPagination page={1} pageSize={10} total={15} onPageChange={change} /></>);
    expect(screen.getByRole('link', { name: 'Evidence' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(change).toHaveBeenCalledWith(2);
  });

  it('confirms destructive actions and renders audit and empty timeline states', () => {
    const confirm = vi.fn();
    render(<MemoryRouter><ConfirmRelationshipAction triggerLabel="Suppress" title="Confirm suppression" description="Stops outreach." confirmLabel="Confirm" onConfirm={confirm} /><RelationshipAuditMetadata audit={{ createdAt: '2026-01-01', updatedAt: '2026-01-02' }} /><RelationshipTimelineShell hasItems={false} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Suppress' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText('No relationship activity is available.')).toBeInTheDocument();
    expect(screen.getByText('2026-01-02')).toBeInTheDocument();
  });

  it('stores filters in the URL and resets them without local storage', () => {
    render(<MemoryRouter><FilterProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Set stage' }));
    expect(screen.getByTestId('filter-query')).toHaveTextContent('stage=identified');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByTestId('filter-query').textContent).toBe('');
  });
});
