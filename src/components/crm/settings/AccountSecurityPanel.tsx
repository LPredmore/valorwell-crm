import { useState, type FormEvent } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Password changes require an existing authenticated Supabase session. */
export function AccountSecurityPanel() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (password.length < 12) {
      setError('Use a password with at least 12 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) throw authError;
      setPassword('');
      setConfirmation('');
      setNotice('Your password has been updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account password</CardTitle>
        <CardDescription>
          After signing in with an invitation or email link, set or change your CRM password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={updatePassword} className="space-y-4" autoComplete="off">
          <div className="space-y-2">
            <Label htmlFor="crm-new-password">New password</Label>
            <Input id="crm-new-password" type="password" value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="new-password" minLength={12} required disabled={saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-confirm-password">Confirm new password</Label>
            <Input id="crm-confirm-password" type="password" value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
              autoComplete="new-password" minLength={12} required disabled={saving} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm">{notice}</p>}
          <Button type="submit" disabled={saving}>{saving ? 'Updating password…' : 'Set / change password'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
