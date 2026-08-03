#!/usr/bin/env bash
set -euo pipefail

billing_hub_ref='ahqauomkgflopxgnlndd'
guard_path='.github/scripts/check-billing-hub-boundary.sh'

# Scan the complete tracked tree. The encoded value is the retired project
# reference as it appears inside legacy anon JWTs. Project IDs, credentials,
# repository names, and temporary operational endpoints are never allowed,
# including in historical migrations.
retired_identifier_pattern='asjhkidpuhqodryczuth|YXNqaGtpZHB1aHFvZHJ5Y3p1dGg|LEGACY_SUPABASE_URL|LEGACY_SUPABASE_ANON_KEY|LEGACY_SUPABASE_PUBLISHABLE_KEY|valorwell-backend|therapist-crm-retirement-(import|check)'

if git grep -n -I -i -E "$retired_identifier_pattern" -- . \
  ":(exclude)$guard_path"; then
  echo "Retired Supabase project or repository identifier detected." >&2
  exit 1
fi

# Applied migrations are immutable database history. These exact files document
# the one-time import and retirement sequence and must not be rewritten after
# application. All active source, generated types, fixtures, documentation,
# configuration, and every future migration remain subject to this check.
legacy_migration_exclusions=(
  ':(exclude)supabase/migrations/20260717225018_creator_community_interest_workflow.sql'
  ':(exclude)supabase/migrations/20260718112222_website_bty_nomination_intake.sql'
  ':(exclude)supabase/migrations/20260727090354_b13bd487-9887-402e-90dc-aabd7c2fb732.sql'
  ':(exclude)supabase/migrations/20260803083600_strengthen_billing_hub_campaign_and_provider_verification.sql'
  ':(exclude)supabase/migrations/20260803093000_archive_retired_project_and_migrate_donations.sql'
  ':(exclude)supabase/migrations/20260803121400_retire_legacy_auth_password_functions.sql'
  ':(exclude)supabase/migrations/20260803123500_remove_legacy_import_functions.sql'
)

# Catch human-readable, slug, and database-source variants such as spaces,
# hyphens, or underscores in the current operating tree.
if git grep -n -I -i -E 'therapist[[:space:]_-]*crm' -- . \
  ":(exclude)$guard_path" \
  "${legacy_migration_exclusions[@]}"; then
  echo "Retired project name detected in the current CRM operating tree." >&2
  exit 1
fi

unexpected_urls="$({
  git grep -n -I -E 'https://[a-z0-9]+\.(functions\.)?supabase\.co' -- . \
    ":(exclude)$guard_path" 2>/dev/null || true
} | grep -v "$billing_hub_ref" || true)"

if [[ -n "$unexpected_urls" ]]; then
  echo "A Supabase URL outside Billing Hub was detected:" >&2
  echo "$unexpected_urls" >&2
  exit 1
fi

if ! grep -qx "project_id = \"$billing_hub_ref\"" supabase/config.toml; then
  echo "CRM Supabase configuration must identify Billing Hub." >&2
  exit 1
fi

project_id_lines="$(grep -RIn --include='*.toml' -E '^[[:space:]]*project_id[[:space:]]*=' . 2>/dev/null || true)"
unexpected_project_ids="$(printf '%s\n' "$project_id_lines" | grep -v "$billing_hub_ref" || true)"
if [[ -n "$unexpected_project_ids" ]]; then
  echo "A non-Billing-Hub Supabase project_id was detected:" >&2
  echo "$unexpected_project_ids" >&2
  exit 1
fi

echo "Billing Hub repository boundary passed."
