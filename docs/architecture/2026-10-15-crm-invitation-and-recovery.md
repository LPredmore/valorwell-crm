# CRM invitation and recovery routing

Source implementation prepared in draft PR #154; not deployed or behaviorally verified. No invitation/reset email was sent, auth user created, role granted, shared Site URL changed or portal configuration changed during implementation.

## Cause and chosen contract

The observed dashboard invitation fell back to the shared Auth Site URL on the client portal. That portal requires a clinical client profile. CRM needs an explicit return URL and must independently check its own capability grants after authentication.

The operator script `scripts/invite-crm-user.mjs` uses `auth.admin.inviteUserByEmail(email, { redirectTo: 'https://crm.valorwell.org/auth?flow=invite' })`. It grants no tenant or role, has no existing-account resend fallback and is never bundled in the browser. Running it sends ONE invitation: execute only for an explicitly requested recipient from a trusted server/operator environment with the service-role key. It has NOT been run here.

CRM Auth now handles invitation/recovery password setup in the CRM app, sign-in links for existing users only, explicit CRM recovery returns and OAuth returns through CRM Auth. Subsequent navigation goes to `/crm`, whose existing index leads to the operational dashboard. Before entry, the server `get_crm_operating_context` must report a CRM capability for the signed-in user. An account with no CRM grant receives an access message instead of a redirect loop or automatic logout. Users with multiple authorized tenants choose one; the stored tenant is a preference that the existing CRM provider and DB permissions revalidate.

Neither query parameters nor user-editable auth metadata grant access. No arbitrary `next` destination is accepted. Client and clinician application routes and invite mechanisms are unchanged.

## Affected files and side effects

- `src/pages/Auth.tsx`: session/bootstrap, fixed CRM return destinations, recovery request, password flow and capability-gated entry. MEDIUM: session/event races or expired links could block sign-in; cancel stale effects and exercise callback cases during acceptance.
- `src/domain/auth/crm-auth-navigation.ts` plus tests: typed flow recognition and strict server tenant choice parsing; no permission mutation. LOW.
- `src/pages/Auth.test.tsx`: prepared tests for invitation/recovery, no-capability and multi-tenant behavior. NOT RUN.
- `scripts/invite-crm-user.mjs`: trusted operator-only explicit invitation issuance. HIGH if run for a wrong recipient; does not run automatically, print secrets, grant roles or alter shared Auth settings.
- Existing `AccountSecurityPanel`: reused unchanged; authenticated Supabase session still required by `auth.updateUser`.
- Shared Supabase Auth configuration: required deployment dependency; current Site URL, redirect allowlist and hosted invitation/recovery templates were NOT accessible through the available Supabase connector operations. Their live values therefore remain UNKNOWN. Do not claim this source change fixes the live dashboard invitation flow.

## Deployment checklist (deferred to Task 42)

### October 15 operator configuration tooling

`scripts/configure-crm-auth-redirects.mjs` now provides a read-only default report and an explicit `--apply-redirects` operation. The Management API endpoint and `uri_allow_list`, `mailer_templates_invite_content` and `mailer_templates_recovery_content` fields were inspected in the current Supabase OpenAPI document. The script retains the existing allowlist string verbatim and appends only missing exact CRM returns; its PATCH contains only `uri_allow_list`. It never writes Site URL or shared templates, sends messages, creates users or grants access. It reports template routing indicators without printing the sensitive Auth config or template bodies. Indicators still require shared-portal review; they are not proof a link works.

NOT RUN. Current workspace runtime reports no configured secrets or outbound identities, and available Supabase connector operations do not expose Auth config. Exact next action: configure a trusted `SUPABASE_ACCESS_TOKEN` with access to this project's Auth config, run the script without flags to inspect, then use `--apply-redirects` for additive allowlist configuration. Do not use a service-role key as a Management API credential. Inspect hosted template routing without changing shared client/clinician behavior. Record actual configuration evidence; private-browser/message acceptance remains deferred and requires explicitly approved recipients.

Pure plan/template-evidence test source is prepared in `src/domain/auth/crm-auth-config.test.ts`; it has not been executed. The script itself has not been executed, including its read-only mode.

1. Retain the existing shared Site URL and all client/clinician destinations. Add exact CRM allowed return URLs `https://crm.valorwell.org/auth`, `https://crm.valorwell.org/auth?flow=invite` and `https://crm.valorwell.org/auth?flow=recovery` if absent. Check query-string matching against the current hosted Auth configuration.
2. Inspect hosted invite/recovery templates. Prefer `{{ .ConfirmationURL }}` so Auth preserves validated `redirect_to`; ensure no template hardcodes `client.valorwell.org` or overrides the explicit return. Avoid rewriting templates shared by other portals without an audit.
3. Use the explicit script/API path for CRM invitation issuance; the generic Dashboard Invite action can still fall back to Site URL if it supplies no CRM redirect. Do not point Site URL globally to CRM.
4. Separately grant the intended CRM tenant membership and capability through the established admin process. Invitation/password setup must not grant a tenant or role automatically.
5. Run Auth/domain tests, lint, typecheck and build in the combined pass; private-browser invitation acceptance, expired link, recovery, magic link, OAuth, session switch, denied/no-role and multi-tenant selection. Use explicitly approved recipients only.
6. Verify client invitations/registration, clinician onboarding and existing password flows. Record actual published commit and Auth configuration evidence before closing the Todoist issue.

Rollback: revert the CRM source/script changes through GitHub; remove only newly added exact CRM allowlist entries if necessary. Do not remove other portal destinations or delete invited users/role assignments as an automatic rollback.

## Dashboard inspection instructions for the owner

1. Open https://supabase.com/dashboard/project/ahqauomkgflopxgnlndd/auth/url-configuration (Billing Hub project). In sidebar navigation this is Authentication → URL Configuration.
2. Copy the current **Site URL**. It may legitimately point to the client portal; retain it while inspecting shared flows.
3. Under **Redirect URLs**, check whether all three exact CRM returns are listed: `https://crm.valorwell.org/auth`, `https://crm.valorwell.org/auth?flow=invite`, `https://crm.valorwell.org/auth?flow=recovery`. Report present/missing and any existing CRM wildcard entry; preserve all other portal URLs.
4. Open https://supabase.com/dashboard/project/ahqauomkgflopxgnlndd/auth/templates. This is Authentication → Email Templates; some dashboard layouts label the section Email under Notifications. Open **Invite user**, then **Reset password**.
5. In each template's HTML/source, locate the clickable link (`href=`). Report whether it uses `{{ .ConfirmationURL }}`, hardcodes a portal URL, or constructs a URL using `{{ .SiteURL }}`, `{{ .RedirectTo }}` or `{{ .TokenHash }}`. Copy just the template link markup if unsure; template variable placeholders are sufficient. A custom token-hash link needs flow-specific review rather than automatic replacement.

These are configuration inspection steps, not an instruction to send an invitation/reset email or change shared templates/Site URL. Report the Site URL, CRM redirect entries and the two template link snippets. Never share service-role keys, access tokens, webhook secrets or an actual generated invitation/recovery link.
