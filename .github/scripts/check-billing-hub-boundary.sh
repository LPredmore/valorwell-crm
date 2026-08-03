#!/usr/bin/env bash
set -euo pipefail

billing_hub_ref='ahqauomkgflopxgnlndd'
retired_pattern='asjhkidpuhqodryczuth|LEGACY_SUPABASE_URL|LEGACY_SUPABASE_ANON_KEY|LEGACY_SUPABASE_PUBLISHABLE_KEY'

if git grep -n -I -E "$retired_pattern" -- . \
  ':(exclude).github/scripts/check-billing-hub-boundary.sh'; then
  echo "Retired Therapist CRM infrastructure reference detected." >&2
  exit 1
fi

unexpected_urls="$({
  git grep -n -I -E 'https://[a-z0-9]+\.(functions\.)?supabase\.co' -- \
    .env src supabase docs .github 2>/dev/null || true
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

echo "Billing Hub repository boundary passed."
