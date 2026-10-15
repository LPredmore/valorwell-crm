// Trusted operator only. Default: read and report. Never sends auth messages.
import { planCrmAuthRedirects, templateRoutingEvidence } from './lib/crm-auth-config.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply-redirects')) {
  console.error('Usage: node scripts/configure-crm-auth-redirects.mjs [--apply-redirects]');
  process.exit(1);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN with project Auth configuration access is required in the trusted operator environment. A service-role key is not a management credential.');
  process.exit(1);
}
const endpoint = 'https://api.supabase.com/v1/projects/ahqauomkgflopxgnlndd/config/auth';
async function request(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Do not log response bodies: full Auth config includes sensitive provider settings.
  if (!response.ok) throw new Error(`Auth configuration ${method} failed (HTTP ${response.status}).`);
  return response.json();
}
try {
  const config = await request('GET');
  const plan = planCrmAuthRedirects(config);
  console.log(JSON.stringify({
    project: 'ahqauomkgflopxgnlndd', mode: args.length ? 'apply_redirects' : 'read_only',
    missingCrmRedirects: plan.missing,
    inviteTemplate: templateRoutingEvidence(config.mailer_templates_invite_content),
    recoveryTemplate: templateRoutingEvidence(config.mailer_templates_recovery_content),
  }, null, 2));
  if (args.length && plan.patch) {
    // Shared Site URL, templates and all pre-existing portal redirects are retained.
    await request('PATCH', plan.patch);
    console.log('CRM redirect additions submitted. Runtime acceptance remains deferred to Task 42.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Auth configuration operation failed.');
  process.exitCode = 1;
}
