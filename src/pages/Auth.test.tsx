import { beforeEach,describe,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { sendLink, signInWithPassword } = vi.hoisted(()=>({
  sendLink:vi.fn(),signInWithPassword:vi.fn(),
}));
vi.mock('@/integrations/supabase/client',()=>({
  supabase:{auth:{
    onAuthStateChange:()=>({data:{subscription:{unsubscribe:vi.fn()}}}),
    getSession:()=>Promise.resolve({data:{session:null}}),
    signInWithOtp:sendLink,signInWithPassword,
  }},
}));
import Auth from './Auth';

describe('invited CRM user authentication',()=>{
  beforeEach(()=>{vi.clearAllMocks();sendLink.mockResolvedValue({error:null});});
  it('emails a link only for a pre-existing user, never creating accounts from login',async()=>{
    render(<MemoryRouter><Auth /></MemoryRouter>);
    const email=await screen.findByPlaceholderText('you@example.com');
    fireEvent.change(email,{target:{value:'info+admintest@gmail.com'}});
    fireEvent.click(screen.getByRole('button',{name:'Email me a sign-in link'}));
    await waitFor(()=>expect(sendLink).toHaveBeenCalledWith({
      email:'info+admintest@gmail.com',options:{
        shouldCreateUser:false,emailRedirectTo:`${window.location.origin}/auth`,
      },
    }));
    expect(await screen.findByText(/check your email for a sign-in link/i)).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
  it('does not send a login link without an email',async()=>{
    render(<MemoryRouter><Auth /></MemoryRouter>);
    await screen.findByPlaceholderText('you@example.com');
    fireEvent.click(screen.getByRole('button',{name:'Email me a sign-in link'}));
    expect(await screen.findByText(/enter your email address/i)).toBeTruthy();
    expect(sendLink).not.toHaveBeenCalled();
  });
});
