#!/usr/bin/env bash
set -euo pipefail

billing_hub_ref='ahqauomkgflopxgnlndd'
guard_path='.github/scripts/check-billing-hub-boundary.sh'

# Scan the complete tracked tree. The encoded value is the retired project
# reference as it appears inside legacy anon JWTs.
retired_identifier_pattern='asjhkidpuhqodryczuth|YXNqaGtpZHB1aHFvZHJ5Y3p1dGg|LEGACY_SUPABASE_URL|LEGACY_SUPABASE_ANON_KEY|LEGACY_SUPABASE_PUBLISHABLE_KEY|valorwell-backend|therapist-crm-retirement-(import|check)'

if git grep -n -I -i -E "$retired_identifier_pattern" -- . \
  ":(exclude)$guard_path"; then
  echo "Retired Supabase project or repository identifier detected." >&2
  exit 1
fi

# Catch human-readable, slug, and database-source variants such as spaces,
# hyphens, or underscores. Historical references remain available in Git history.
if git grep -n -I -i -E 'therapist[[:space:]_-]*crm' -- . \
  ":(exclude)$guard_path"; then
  echo "Retired project name detected in the current CRM tree." >&2
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
