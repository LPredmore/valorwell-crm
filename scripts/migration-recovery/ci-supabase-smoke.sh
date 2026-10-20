#!/usr/bin/env bash
# Reproduce the first migration dependency failure in a real, temporary Supabase stack.
# NO hosted project URL, project ref, API key, service_role secret, or production data needed.
set -Eeuo pipefail
export SUPABASE_DISABLE_TELEMETRY=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_ROOT="$(mktemp -d "${RUNNER_TEMP:-/tmp}/vw-supabase-smoke-XXXXXXXX")"
WORK="$RUN_ROOT/isolated-project"
mkdir -p "$WORK"
OUT="$RUN_ROOT/summary.json"
STARTED=0
cleanup() {
  local code=$?
  if [[ "$STARTED" -eq 1 ]]; then
    (cd "$WORK" && supabase stop --no-backup >/dev/null 2>&1) || {
      echo "WARNING: local Supabase cleanup failed; inspect owned CI runner containers." >&2
      code=1
    }
  fi
  rm -rf -- "$RUN_ROOT"
  exit "$code"
}
trap cleanup EXIT
cd "$WORK"
supabase init --yes >/dev/null
# Use a collision-resistant local project id; never link to hosted production.
python3 - <<'PY'
from pathlib import Path
import os,uuid,re
p=Path('supabase/config.toml')
old=p.read_text()
identifier='vw-replay-smoke-'+uuid.uuid4().hex[:10]
new,n=re.subn(r'(?m)^project_id\s*=.*$',f'project_id = "{identifier}"',old,count=1)
if n!=1: raise SystemExit('Missing project_id in fresh local config')
p.write_text(new)
print('Ephemeral project initialized; no remote project linked')
PY
STARTED=1
# Only Auth, Storage, PostgREST and the PostgreSQL managed foundations are needed.
# No edge runtime, cron dispatches, live provider workers, mail servers or UI.
# Captured private log is removed with the owned scratch directory, never uploaded.
if ! timeout 18m supabase start --exclude studio,inbucket,imgproxy,logflare,vector,realtime,edge-runtime,supavisor >"$RUN_ROOT/startup.log" 2>&1; then
  echo "Could not start disposable Supabase. Startup log retained only until runner cleanup." >&2
  exit 1
fi
PROJECT_ID="$(sed -nE 's/^project_id[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' supabase/config.toml | head -1)"
DB_CONTAINER="supabase_db_$PROJECT_ID"
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Owned Supabase database container not present" >&2
  exit 1
fi
# No production credentials exist on this runner. Test the real managed dependencies.
check_sql="SELECT (to_regclass('auth.users') IS NOT NULL
 AND to_regclass('storage.objects') IS NOT NULL
 AND to_regprocedure('auth.uid()') IS NOT NULL
 AND (SELECT count(*)=3 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))::text;"
deps="$(docker exec "$DB_CONTAINER" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$check_sql" | tr -d '[:space:]')"
[[ "$deps" == 'true' ]] || { echo "Actual Supabase Auth/Storage/database roles not present" >&2; exit 1; }
# First historical ledger migration is run in ONE TRANSACTION that fails and rolls back.
# No legacy objects persist. The exact SQL was copied from the live migration ledger
# for fixture purposes only. We expect it to fail at the missing set_updated_at().
set +e
{ printf 'BEGIN;\n'; cat "$ROOT/scripts/migration-recovery/fixtures/20251201181524_first_replay_witness.sql"; } |
 docker exec -i "$DB_CONTAINER" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 >"$RUN_ROOT/witness-stdout.log" 2>"$RUN_ROOT/witness-stderr.log"
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  echo "Historical witness unexpectedly succeeded; the expected first replay failure was not reproduced." >&2
  exit 1
fi
if ! grep -Eq 'function public\.set_updated_at\(\) does not exist|function public\.set_updated_at\(\) is not defined' "$RUN_ROOT/witness-stderr.log"; then
  echo "Historical replay failed for a different reason; requires inspection in an authorized runner." >&2
  # Do not print raw SQL or logs in case future migrations contain sensitive metadata.
  exit 1
fi
# Running in transaction + ON_ERROR_STOP means the failed migration is rolled back.
legacy="$(docker exec "$DB_CONTAINER" psql -X -qAt -U postgres -d postgres -c "SELECT (to_regclass('public.user_roles') IS NULL AND to_regtype('public.app_role') IS NULL)::text;" | tr -d '[:space:]')"
[[ "$legacy" == 'true' ]] || { echo "Historical witness left database objects; cleanup check failed" >&2; exit 1; }
cat > "$OUT" <<'JSON'
{
  "test_scope":"genuine disposable Supabase baseline smoke",
  "managed_auth_storage_roles":"PASS",
  "historical_first_migration":"EXPECTED_FAIL_missing_set_updated_at",
  "rollback_clean":"PASS",
  "full_962_migration_replay":"NOT_RUN_no_reviewed_bootstrap",
  "ten_pending_security_migrations":"NOT_RUN_no_reviewed_baseline",
  "production_changed":false,
  "provider_calls":false
}
JSON
cat "$OUT"
