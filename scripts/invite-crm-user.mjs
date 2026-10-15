// Operator-only issuance. Never import this script into browser application code.
// No tenant membership or role is granted; those remain separate admin decisions.
import { createClient } from '@supabase/supabase-js';
const email = process.argv[2]?.trim();
if (!email || process.argv.length !== 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=<server secret> node scripts/invite-crm-user.mjs <email>');
  process.exit(1);
}
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY is required in the operator environment.'); process.exit(1); }
const client = createClient('https://ahqauomkgflopxgnlndd.supabase.co', key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
  redirectTo: 'https://crm.valorwell.org/auth?flow=invite',
});
if (error) {
  // No automatic create/update/recovery fallback; avoid duplicate or unintended messages.
  console.error('CRM invitation was not issued:', error.message);
  process.exit(1);
}
console.log('CRM invitation issued. CRM tenant membership and role must be assigned separately.');
console.log('Invited account ID:', data.user?.id ?? 'not returned');
