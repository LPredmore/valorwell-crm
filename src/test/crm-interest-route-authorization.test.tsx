import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CrmLayoutInner } from '@/components/crm/layout/CrmLayout';

vi.mock('@/hooks/crm/useCrmAuth', () => ({ useCrmAuth: () => ({ isLoading: false, isAuthenticated: false }) }));

describe('creator/community nested route authorization', () => {
  it('redirects an unauthenticated nested detail request to authentication', () => {
    render(<MemoryRouter initialEntries={['/crm/creator-community-interest/contact-a']}><Routes><Route path="/crm/*" element={<CrmLayoutInner />} /><Route path="/auth" element={<div>Authentication required</div>} /></Routes></MemoryRouter>);
    expect(screen.getByText('Authentication required')).toBeInTheDocument();
  });
});
