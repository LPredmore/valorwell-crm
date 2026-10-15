import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AccountSecurityPanel } from '@/components/crm/settings/AccountSecurityPanel';
import { authorizedCrmTenantIds, crmAuthReturnUrl, crmPasswordFlow } from '@/domain/auth/crm-auth-navigation';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [passwordFlow, setPasswordFlow] = useState(() => crmPasswordFlow(location.search, window.location.hash));
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [tenantChoices, setTenantChoices] = useState<string[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const query = new URLSearchParams(location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return query.has('error') || query.has('error_code') || hash.has('error') || hash.has('error_code')
      ? 'This invitation or sign-in link is invalid or expired. Request a new link below.' : null;
  });
  const [linkSent, setLinkSent] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    let observedAuthEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      observedAuthEvent = true;
      if (event === 'PASSWORD_RECOVERY') setPasswordFlow('recovery');
      setSessionUserId(session?.user?.id ?? null);
      if (!session?.user) setIsCheckingSession(false);
    });
    void supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
      if (!active || observedAuthEvent) return;
      if (sessionError) setError('Your session could not be loaded. Please sign in again.');
      setSessionUserId(session?.user?.id ?? null);
      if (!session?.user) setIsCheckingSession(false);
    }).catch(() => {
      if (active && !observedAuthEvent) {
        setError('Your session could not be loaded. Please sign in again.');
        setIsCheckingSession(false);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    if (passwordFlow) { setIsCheckingSession(false); return; }
    let active = true;
    setIsCheckingSession(true);
    setAccessDenied(false);
    setTenantChoices([]);
    // Outside onAuthStateChange: avoid awaiting another Supabase call in its callback.
    void Promise.resolve(supabase.rpc('get_crm_operating_context')).then(({ data, error: contextError }) => {
      if (!active) return;
      const tenants = contextError ? [] : authorizedCrmTenantIds(data, sessionUserId);
      if (tenants.length === 0) {
        setAccessDenied(true);
        setError(contextError ? 'CRM access could not be checked. Try signing in again.'
          : 'You are signed in, but CRM access has not been assigned. Ask your administrator to grant a CRM workspace and role.');
      } else if (tenants.length === 1) {
        navigate('/crm', { replace: true });
      } else {
        // Selection is a preference only. CRM authorization revalidates it server-side.
        setTenantChoices(tenants);
      }
      setIsCheckingSession(false);
    }).catch(() => {
      if (active) {
        setAccessDenied(true);
        setError('CRM access could not be checked. Try signing in again.');
        setIsCheckingSession(false);
      }
    });
    return () => { active = false; };
  }, [sessionUserId, passwordFlow, navigate]);

  const handleSignOut = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setSessionUserId(null);
      setAccessDenied(false);
      setTenantChoices([]);
      setPasswordFlow(null);
      navigate('/auth', { replace: true });
    } catch {
      setError('Could not sign out. Please try again.');
    } finally { setIsLoading(false); }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          setError('Invalid email or password. Please try again.');
        } else {
          setError(signInError.message);
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Login links are only for existing invited users. Never create CRM users
  // from this public screen; tenant permissions remain server-side.
  const handleEmailLink = async () => {
    if (!email.trim()) {
      setError('Enter your email address to receive a sign-in link.');
      return;
    }
    setError(null);
    setIsLoading(true);
    setLinkSent(false);
    try {
      const { error: linkError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: crmAuthReturnUrl(window.location.origin),
        },
      });
      if (linkError) {
        setError('Could not send a sign-in link. Check your account invitation or try again.');
      } else {
        setLinkSent(true);
      }
    } catch {
      setError('Could not send a sign-in link. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) { setError('Enter your email address to reset your password.'); return; }
    setError(null);
    setLinkSent(false);
    setIsLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: crmAuthReturnUrl(window.location.origin, 'recovery'),
      });
      if (resetError) throw resetError;
      setLinkSent(true);
    } catch {
      setError('Could not send a password reset link. Please try again.');
    } finally { setIsLoading(false); }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: crmAuthReturnUrl(window.location.origin) },
      });
      if (oauthError) {
        setError(oauthError.message);
        setIsLoading(false);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessionUserId && passwordFlow) {
    return <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4">
        <h1 className="text-2xl font-bold">{passwordFlow === 'invite' ? 'Welcome to ValorWell CRM' : 'Reset your CRM password'}</h1>
        <p className="text-sm text-muted-foreground">Set your password, then continue to your authorized CRM workspace.</p>
        <AccountSecurityPanel />
        <Button className="w-full" onClick={() => {
          setPasswordFlow(null);
          navigate('/auth', { replace: true });
        }}>Continue to CRM</Button>
      </div>
    </div>;
  }
  if (sessionUserId && (accessDenied || tenantChoices.length > 1)) {
    return <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>{accessDenied ? 'CRM access required' : 'Choose your CRM workspace'}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {tenantChoices.map((tenant, index) => <Button key={tenant} className="w-full" variant="outline" onClick={() => {
            try { window.localStorage.setItem('crm.currentTenantId', tenant); }
            catch { setError('Your browser could not save the workspace selection. Allow site storage and try again.'); return; }
            navigate('/crm', { replace: true });
          }}>Workspace {index + 1} · {tenant.slice(0, 8)}</Button>)}
          <Button variant="outline" disabled={isLoading} onClick={() => void handleSignOut()}>Sign out</Button>
        </CardContent>
      </Card>
    </div>;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Sign in</CardTitle>
          <CardDescription>
            Enter your credentials to access the CRM
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignIn} className="space-y-4">
            {linkSent && (
              <Alert>
                <AlertDescription>
                  If this address has an invited account, check your email for the requested link.
                </AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
                autoComplete="email"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </Button>

            <Button type="button" variant="outline" className="w-full" onClick={handleEmailLink} disabled={isLoading}>
              Email me a sign-in link
            </Button>

            <Button type="button" variant="ghost" className="w-full" onClick={handlePasswordReset} disabled={isLoading}>
              Reset my password
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
