import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const { sendLink, signInWithPassword, resetPassword, getSession, rpc, signOut } = vi.hoisted(() => ({
  sendLink: vi.fn(), signInWithPassword: vi.fn(), resetPassword: vi.fn(), getSession: vi.fn(), rpc: vi.fn(), signOut: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc, auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    getSession, signInWithOtp: sendLink, signInWithPassword, resetPasswordForEmail: resetPassword, signOut,
  } },
}));
vi.mock('@/components/crm/settings/AccountSecurityPanel', () => ({ AccountSecurityPanel: () => <div>Set your account password</div> }));
import Auth from './Auth';
const actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function renderAuth(path = '/auth') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/auth" element={<Auth />} /><Route path="/crm" element={<div>Authorized CRM destination</div>} />
  </Routes></MemoryRouter>);
}
describe('invited CRM user authentication', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    sendLink.mockResolvedValue({ error: null });
    resetPassword.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    rpc.mockResolvedValue({ data: { authenticated: true, profile_id: actor, available_tenants: [{ tenant_id: tenant, crm_role: 'crm_admin' }] }, error: null });
  });
  it('emails a link only for a pre-existing user, never creating accounts from login', async () => {
    renderAuth();
    const email = await screen.findByPlaceholderText('you@example.com');
    fireEvent.change(email, { target: { value: 'info+admintest@gmail.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    await waitFor(() => expect(sendLink).toHaveBeenCalledWith({ email: 'info+admintest@gmail.com', options: {
      shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth`,
    } }));
    expect(await screen.findByText(/check your email for the requested link/i)).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
  it('does not send a login link without an email', async () => {
    renderAuth();
    await screen.findByPlaceholderText('you@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    expect(await screen.findByText(/enter your email address/i)).toBeTruthy();
    expect(sendLink).not.toHaveBeenCalled();
  });
  it('sends recovery to the CRM password flow', async () => {
    renderAuth();
    fireEvent.change(await screen.findByPlaceholderText('you@example.com'), { target: { value: 'existing@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset my password' }));
    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith('existing@example.com', { redirectTo: `${window.location.origin}/auth?flow=recovery` }));
  });
  it.each(['invite', 'recovery'])('keeps an authenticated %s on the password screen before CRM navigation', async flow => {
    getSession.mockResolvedValue({ data: { session: { user: { id: actor } } }, error: null });
    renderAuth(`/auth?flow=${flow}`);
    expect(await screen.findByText('Set your account password')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to CRM' }));
    expect(await screen.findByText('Authorized CRM destination')).toBeTruthy();
  });
  it('keeps a signed-in account without CRM capability on an explicit access message', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: actor } } }, error: null });
    rpc.mockResolvedValue({ data: { authenticated: true, profile_id: actor, available_tenants: [] }, error: null });
    renderAuth();
    expect(await screen.findByText(/CRM access has not been assigned/)).toBeTruthy();
    expect(screen.queryByText('Authorized CRM destination')).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
  it('requires a choice among the server-authorized tenants without granting a role', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: actor } } }, error: null });
    rpc.mockResolvedValue({ data: { authenticated: true, profile_id: actor, available_tenants: [
      { tenant_id: tenant, crm_role: 'crm_admin' }, { tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', crm_role: 'crm_readonly' },
    ] }, error: null });
    renderAuth();
    fireEvent.click(await screen.findByRole('button', { name: /Workspace 2/ }));
    expect(window.localStorage.getItem('crm.currentTenantId')).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(await screen.findByText('Authorized CRM destination')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('get_crm_operating_context');
  });
});
