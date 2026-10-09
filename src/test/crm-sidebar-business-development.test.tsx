import {fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {CrmSidebar} from '@/components/crm/layout/CrmSidebar';

// Sidebar navigation is a capability-filtered UI. Use an authorized operator
// contract rather than rendering a protected component without its provider.
vi.mock('@/hooks/crm/useCrmAuth',()=>({
  useCrmAuth:()=>({capabilities:{
    view:true,mutate:true,communicate:true,report:true,manage_campaigns:true,
  }}),
}));

function renderSidebar(path='/crm/business-development'){
  return render(<MemoryRouter initialEntries={[path]}><CrmSidebar/></MemoryRouter>);
}

describe('CRM relationship and BTY sidebar navigation',()=>{
  beforeEach(()=>{localStorage.clear();});
  it('keeps people/organizations, configurable pipelines, BTY and system health navigable',()=>{
    renderSidebar();
    expect(screen.getByRole('navigation',{name:'CRM navigation'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Contacts'})).toHaveAttribute('href','/crm/business-development/contacts');
    expect(screen.getByRole('link',{name:'Organizations'})).toHaveAttribute('href','/crm/business-development/organizations');
    expect(screen.getByRole('link',{name:'Pipelines'})).toHaveAttribute('href','/crm/pipelines');
    expect(screen.getByRole('link',{name:'Beyond The Yellow'})).toHaveAttribute('href','/crm/business-development');
    expect(screen.getByRole('link',{name:'System Health'})).toHaveAttribute('href','/crm/business-development/status');
    fireEvent.click(screen.getByRole('button',{name:'Show additional Operations tools'}));
    expect(screen.getByRole('link',{name:'BTY Duplicate Cleanup'})).toHaveAttribute('href','/crm/business-development/duplicate-cleanup');
    expect(screen.getByRole('link',{name:'Creator & Community Interest'})).toHaveAttribute('href','/crm/creator-community-interest');
    expect(screen.queryByRole('link',{name:'BTY Automation'})).not.toBeInTheDocument();
  });
  it('highlights a nested organization without selecting the BTY dashboard',()=>{
    renderSidebar('/crm/business-development/organizations/org-1');
    expect(screen.getByRole('link',{name:'Organizations'})).toHaveAttribute('aria-current','page');
    expect(screen.getByRole('link',{name:'Beyond The Yellow'})).not.toHaveAttribute('aria-current');
  });
  it('makes icon-only collapsed links accessible with title and label',()=>{
    renderSidebar();
    fireEvent.click(screen.getByRole('button',{name:'Collapse CRM navigation'}));
    expect(screen.getByRole('button',{name:'Expand CRM navigation'})).toBeInTheDocument();
    const organizations=screen.getByRole('link',{name:'Organizations'});
    expect(organizations).toHaveAttribute('title','Organizations');
    expect(organizations).toHaveAttribute('aria-label','Organizations');
  });
});
