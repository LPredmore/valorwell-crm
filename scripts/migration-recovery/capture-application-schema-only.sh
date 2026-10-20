#!/usr/bin/env bash
# ValorWell schema-only inventory capture. Reads schema, never data rows.
# Run only in a trusted operator environment, after authorization.
# This is not an automatic migration and does NOT repair migration history.
set -euo pipefail
umask 077

if ! command -v pg_dump >/dev/null 2>&1; then
  echo 'pg_dump is required (use a version compatible with the remote Postgres server).' >&2
  exit 2
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  echo 'sha256sum is required.' >&2
  exit 2
fi
if [[ -z "${PGHOST:-}" || -z "${PGDATABASE:-}" || -z "${PGUSER:-}" ]]; then
  echo 'Set PGHOST, PGDATABASE and PGUSER in the authorized environment. Supply credentials via .pgpass or PGPASSWORD; never put them in commands, issue comments, or source control.' >&2
  exit 2
fi

# Capture application schema only; Supabase-owned built-ins (auth/storage/roles/
# extensions) need separate dependency/ownership review before baseline replay.
# Function definitions may embed credentials or proprietary information despite
# --schema-only. Never commit/share this raw dump without a security review.
private_dir="$(mktemp -d "${TMPDIR:-/tmp}/valorwell-schema-XXXXXX")"
trap 'rm -rf -- "$private_dir"' ERR INT TERM
out="$private_dir/application-schema-only.sql"
PGSSLMODE="${PGSSLMODE:-require}" pg_dump \
  --schema-only --no-password --format=plain \
  --schema=public --schema=private --schema=credentialing \
  --file="$out"
chmod 600 "$out"
echo 'Schema-only export completed (no table data selected).'
printf 'Private local file (DO NOT COMMIT): %s\n' "$out"
sha256sum "$out"
pg_dump --version
echo 'This is a partial application-schema snapshot, NOT a replayable Supabase baseline.'
echo 'Keep the file private; inspect functions/ACLs and reconcile missing extensions, built-in schemas, roles and migrations before use.'
