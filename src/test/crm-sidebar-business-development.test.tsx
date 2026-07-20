import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmSidebar } from '@/components/crm/layout/CrmSidebar';

function renderSidebar(path = '/crm/business-development') {
  return render(<MemoryRouter initialEntries={[path]}><CrmSidebar /></MemoryRouter>);
}

describe('Business Development sidebar navigation', () => {
  it('renders a separate Business Development group and preserves inbound interest as a clinical-adjacent lane', () => {
    renderSidebar();
    expect(screen.getAllByText('Business Development')).toHaveLength(2);
    expect(screen.getByText('Clinical CRM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inbound Creator & Community Interest' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'System Status' })).toHaveAttribute('href', '/crm/business-development/status');
  });

  it('marks nested Business Development routes active without marking the dashboard active', () => {
    renderSidebar('/crm/business-development/organizations/org-1');
    expect(screen.getByRole('link', { name: 'Organizations' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Business Development' })).not.toHaveAttribute('aria-current');
  });

  it('keeps collapsed navigation understandable through accessible labels and titles', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse CRM navigation' }));
    expect(screen.getByRole('button', { name: 'Expand CRM navigation' })).toBeInTheDocument();
    expect(screen.getByTitle('Organizations')).toBeInTheDocument();
    expect(screen.queryByText('Business Development')).not.toBeInTheDocument();
  });
});
