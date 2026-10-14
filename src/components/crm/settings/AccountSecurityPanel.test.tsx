import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
const {updateUser}=vi.hoisted(()=>({updateUser:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({
  supabase:{auth:{updateUser}},
}));
import {AccountSecurityPanel} from './AccountSecurityPanel';

describe('CRM invited-user password setup',()=>{
  beforeEach(()=>{vi.clearAllMocks();updateUser.mockResolvedValue({error:null});});
  it('refuses mismatched passwords without calling auth',async()=>{
    const {container}=render(<AccountSecurityPanel />);
    fireEvent.change(screen.getByLabelText('New password'),{target:{value:'SomePassword12345'}});
    fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'AnotherPassword12345'}});
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent','Passwords do not match.');
    expect(updateUser).not.toHaveBeenCalled();
  });
  it('changes password through user-scoped Supabase Auth and clears inputs',async()=>{
    const {container}=render(<AccountSecurityPanel />);
    fireEvent.change(screen.getByLabelText('New password'),{target:{value:'SecureTestPassword12345'}});
    fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'SecureTestPassword12345'}});
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(()=>expect(updateUser).toHaveBeenCalledWith({password:'SecureTestPassword12345'}));
    expect(await screen.findByText('Your password has been updated.')).toBeTruthy();
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });
  it('refuses password shorter than 12 characters',async()=>{
    const {container}=render(<AccountSecurityPanel />);
    fireEvent.change(screen.getByLabelText('New password'),{target:{value:'Shortpass'}});
    fireEvent.change(screen.getByLabelText('Confirm new password'),{target:{value:'Shortpass'}});
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByText(/at least 12 characters/i)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
