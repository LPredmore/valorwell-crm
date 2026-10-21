"""Prepare and verify private development captures; never approve or deploy them.

Uses the existing Billing catalog queries and renderer. Remote queries are READ ONLY,
return no application records, and redact recognized capabilities before transport.
The resulting candidate requires independent owner review for release use.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

APP_SCHEMAS = {'public', 'private', 'credentialing', 'import',
               'backup_20260710_pre_ehr_work', 'backup_20260712_pre_overhaul_table_changes_v1'}
MANAGED_SCHEMAS = {'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'net',
                   'realtime', '_realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'vault'}
REDACTIONS = [
    (r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', 'REDACTED_JWT'),
    (r'''https?://[^[:space:]"'\\]+''', 'http://127.0.0.1:9/REDACTED_TRANSPORT'),
    (r'\m(sk_live_|sk_test_|re_|whsec_|AKIA)[A-Za-z0-9]{16,}', 'REDACTED_PROVIDER_KEY'),
    (r'''postgres(ql)?://[^[:space:]"'\\]+''', 'REDACTED_CONNECTION'),
    (r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'synthetic@example.invalid'),
    (r'[A-Za-z0-9+/]{40,}={0,2}', 'REDACTED_OPAQUE_LITERAL'),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_queries(billing):
    queries = {}
    for path in sorted((Path(billing) / 'scripts/schema-baseline').glob('*queries.json')):
        queries.update(json.loads(path.read_text()))
    if not queries:
        raise ValueError('Catalog query sources absent')
    # MCP/JavaScript JSON numbers cannot represent PostgreSQL signed int64 maxima.
    # Preserve exact values before the connector crosses that boundary.
    queries['sequences'] = queries['sequences'].replace(
        's.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache',
        's.seqstart::text AS seqstart,s.seqincrement::text AS seqincrement,s.seqmax::text AS seqmax,s.seqmin::text AS seqmin,s.seqcache::text AS seqcache')
    for query in queries.values():
        if not query.startswith('SELECT ') or ';' in query or re.search(r'\b(pg_authid|secrets|decrypted_secrets)\b', query, re.I):
            raise ValueError('Unreviewed/non-catalog query rejected')
    return queries


def capture_sql(name, query):
    if not re.fullmatch('[a-z_]+', name):
        raise ValueError('Invalid category')
    clean = 'raw::text'
    for pattern, replacement in REDACTIONS:
        clean = f"regexp_replace({clean}, $pattern${pattern}$pattern$, '{replacement}', 'g')"
    return f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=public,extensions;
WITH source AS ({query}), rows AS (SELECT to_jsonb(source) AS raw FROM source),
safe AS (SELECT raw,({clean})::jsonb AS data FROM rows)
SELECT jsonb_build_object('category','{name}','captured_at',clock_timestamp(),
'ledger_count',(SELECT count(*) FROM supabase_migrations.schema_migrations),
'ledger_max',(SELECT max(version) FROM supabase_migrations.schema_migrations),
'ledger_sha256',(SELECT encode(sha256(convert_to(string_agg(version,',' ORDER BY version),'UTF8')),'hex') FROM supabase_migrations.schema_migrations),
'rows',coalesce(jsonb_agg(jsonb_build_object('data',data,'source_sha256',
encode(sha256(convert_to(raw::text,'UTF8')),'hex'),'redacted',raw<>data)),'[]'::jsonb)) AS capture
FROM safe; COMMIT;"""


def load_captures(root, expected):
    data, provenance = {}, {}
    ledger_boundaries = set()
    for name in expected:
        path = root / (name + '.capture.json')
        value = json.loads(path.read_text())
        if value['category'] != name or not isinstance(value['rows'], list):
            raise ValueError('Wrong capture category')
        ledger_boundaries.add((value['ledger_count'], value['ledger_max'], value['ledger_sha256']))
        for row in value['rows']:
            if set(row) != {'data', 'source_sha256', 'redacted'} or not isinstance(row['data'], dict):
                raise ValueError('Invalid capture row')
            if not re.fullmatch('[0-9a-f]{64}', row['source_sha256']) or type(row['redacted']) is not bool:
                raise ValueError('Invalid source hash/redaction flag')
        data[name] = [r['data'] for r in value['rows']]
        provenance[name] = dict(file_sha256=sha(path.read_bytes()), rows=len(value['rows']),
                                redacted_rows=sum(r['redacted'] for r in value['rows']),
                                captured_at=value['captured_at'],
                                executed_query_sha256=value.get('executed_query_sha256'))
    if len(ledger_boundaries) != 1:
        raise ValueError('Ledger changed during non-atomic catalog capture; recapture')
    return data, provenance, next(iter(ledger_boundaries))


def application_subset(data):
    """Real app DDL plus captured app-owned managed hooks/policies, no fake foundations."""
    unknown = {row['nspname'] for row in data.get('schemas', [])} - APP_SCHEMAS - MANAGED_SCHEMAS
    if unknown:
        raise ValueError('Unclassified source schema requires explicit scope review')
    result = {}
    for category, rows in data.items():
        if category == 'triggers':
            result[category] = [r for r in rows if r['nspname'] in APP_SCHEMAS or
                                (r['nspname'] == 'auth' and r['tgname'] == 'on_auth_user_created')]
        elif category == 'policies':
            result[category] = [r for r in rows if r['nspname'] in APP_SCHEMAS | {'storage'}]
        elif category in {'publications', 'publication_memberships', 'publication_tables'}:
            # Native realtime service owns its managed publication. Reconciliation
            # occurs after bootstrap; preserve all memberships in private inventory.
            result[category] = [r for r in rows if r['pubname'] == 'supabase_realtime']
        elif category == 'event_triggers':
            result[category] = []  # Managed event triggers are compared, never faked.
        elif rows and 'nspname' in rows[0] and category not in {'extensions', 'default_acl', 'default_privileges'}:
            result[category] = [r for r in rows if r['nspname'] in APP_SCHEMAS]
        else:
            result[category] = rows
    return result


def finalize(captures, billing, output):
    queries = read_queries(billing)
    data, provenance, boundary = load_captures(captures, queries)
    if any((p / '.git').exists() for p in [output.resolve(), *output.resolve().parents]):
        raise ValueError('Private artifacts forbidden inside any source checkout')
    for name, query in queries.items():
        if provenance[name].get('executed_query_sha256') != sha(capture_sql(name, query).encode()):
            raise ValueError('Captured query provenance does not match reviewed source')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    canonical = output / 'catalog'
    canonical.mkdir(mode=0o700)
    subset = output / 'application'
    subset.mkdir(mode=0o700)
    for folder, values in [(canonical, data), (subset, application_subset(data))]:
        for name, rows in values.items():
            (folder / (name + '.json')).write_text(json.dumps(rows, indent=2) + '\n')
    manifest = dict(format_version=1, strategy='current-state-development-candidate',
                    production_writes=False, contains_application_records=False,
                    independent_owner_approval=False, replay_is_historical=False,
                    snapshot_consistency='Separate read-only transactions with identical ledger boundary; not one atomic snapshot.',
                    ledger=dict(count=boundary[0], maximum=boundary[1], ordered_versions_sha256=boundary[2]),
                    categories=provenance, redaction_rules=REDACTIONS,
                    managed_schema_inventory_complete=True, managed_runtime_parity='NOT_VERIFIED',
                    source_rows_with_redactions=sum(p['redacted_rows'] for p in provenance.values()),
                    restore_scope='all six inventoried application/import/legacy backup schemas plus captured Auth hook, Storage policies and application publication; genuine services supply managed foundations',
                    release_eligible=False)
    manifest['catalog_sha256'] = {p.name: sha(p.read_bytes()) for p in sorted(canonical.glob('*.json'))}
    manifest['query_sha256'] = {name: sha(capture_sql(name, q).encode()) for name, q in queries.items()}
    stages = output / 'stages'
    result = subprocess.run([sys.executable, str(Path(billing) / 'scripts/recover-schema-baseline.py'),
                             str(subset), str(stages)], capture_output=True)
    if result.returncode:
        raise ValueError('Existing renderer failed; no raw diagnostics retained')
    # Managed roles/extensions/default ACLs have real source inventory but must not
    # be recreated via elevated grants or extension substitutions in this mode.
    for name in ['01-roles', '02-database-owner', '03-extensions', '18-default-grants', '20-role-settings', '21-publications']:
        (stages / (name + '.json')).unlink(missing_ok=True)
    manifest['stage_sha256'] = {p.name: sha(p.read_bytes()) for p in sorted(stages.glob('*.json'))}
    (output / 'candidate-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--billing-repo', type=Path, required=True)
    parser.add_argument('--prepare-queries', type=Path)
    parser.add_argument('--captures', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.prepare_queries:
            with args.prepare_queries.open('x') as f:
                json.dump({name: capture_sql(name, q) for name, q in read_queries(args.billing_repo).items()}, f)
            print('READ_ONLY_REDACTING_QUERIES_PREPARED; capture is not approval')
        elif args.captures and args.output:
            if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
                raise ValueError('Private output must stay outside source')
            result = finalize(args.captures, args.billing_repo, args.output)
            print(json.dumps({'status': 'PRIVATE_DEVELOPMENT_CANDIDATE', 'categories': len(result['categories']),
                              'redacted_rows': result['source_rows_with_redactions'], 'release_eligible': False}))
        else:
            raise ValueError('Specify preparation or finalization inputs')
    except Exception:
        print('BLOCKED: catalog inputs/renderer failed; private details suppressed', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
