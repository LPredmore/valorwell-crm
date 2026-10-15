import { describe, expect, it } from 'vitest';
import { authorizedCrmTenantIds, crmAuthReturnUrl, crmPasswordFlow } from './crm-auth-navigation';
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('CRM invitation and recovery destinations', () => {
  it('returns both invitation and recovery links to CRM auth without relying on the shared Site URL', () => {
    expect(crmAuthReturnUrl('https://crm.valorwell.org', 'invite')).toBe('https://crm.valorwell.org/auth?flow=invite');
    expect(crmAuthReturnUrl('https://crm.valorwell.org', 'recovery')).toBe('https://crm.valorwell.org/auth?flow=recovery');
    expect(crmAuthReturnUrl('https://crm.valorwell.org')).toBe('https://crm.valorwell.org/auth');
  });
  it('recognizes implicit auth flow hashes and ignores arbitrary next/redirect requests', () => {
    expect(crmPasswordFlow('', '#type=recovery&access_token=not-read')).toBe('recovery');
    expect(crmPasswordFlow('?flow=invite', '')).toBe('invite');
    expect(crmPasswordFlow('?next=https://client.valorwell.org', '#type=magiclink')).toBeNull();
  });
  it('accepts only authenticated server capability tenants belonging to the current user', () => {
    const data = { authenticated: true, profile_id: 'actor', available_tenants: [
      { tenant_id: tenant, crm_role: 'crm_admin' }, { tenant_id: tenant, crm_role: 'crm_admin' },
      { tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', crm_role: 'crm_none' },
    ], user_metadata: { crm_role: 'crm_admin' } };
    expect(authorizedCrmTenantIds(data, 'actor')).toEqual([tenant]);
    expect(authorizedCrmTenantIds(data, 'different-actor')).toEqual([]);
    expect(authorizedCrmTenantIds({ ...data, authenticated: false }, 'actor')).toEqual([]);
    expect(authorizedCrmTenantIds({ user_metadata: data.user_metadata }, 'actor')).toEqual([]);
  });
});
