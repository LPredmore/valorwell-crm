"""Operator-only private evidence checks. No database access, SQL output or uploads."""
import json
import os
import re
import stat
from pathlib import Path
from recovery import baseline_gate, compare_catalogs, digest, evidence_digest, review_baseline

EXPORT_SHA256 = '4da55b28809507eaa9438a0cb27a7f4335a884ea92dea87551890c0e6ef8230f'
EXPORT_BYTES = 5442397
LATEST_COUNT = 966
CONTACT_VERSION = '20261020214527'
CONTACT_SHA256 = 'a87ad8a61a2e78674df7b757e499d24097b34f6181c167325d4b0df47d9af01f'
EXTENSIONS = {'pg_cron': '1.6.4', 'pg_net': '0.19.5', 'pg_stat_statements': '1.11',
              'pgcrypto': '1.3', 'supabase_vault': '0.3.1', 'uuid-ossp': '1.1', 'plpgsql': '1.0'}
COUNTS = {'public': {'tables': 361, 'functions': 794, 'views': 33, 'policies': 550, 'triggers': 353},
          'private': {'tables': 51, 'functions': 307, 'views': 4, 'policies': 1, 'triggers': 13},
          'credentialing': {'tables': 13, 'functions': 21, 'triggers': 2}}
SHA = re.compile(r'^[0-9a-f]{64}$')


def private_path(path, repository, directory=False):
    """Reject symlinks, tracked roots, permissive POSIX files, and network shares."""
    path = Path(path).absolute()
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('Private paths must not contain symlinks')
    path = path.resolve()
    if path.is_relative_to(Path(repository).resolve()):
        raise ValueError('Private inputs and output must be outside the repository')
    if str(path).startswith(('//', '\\\\')):
        raise ValueError('Private paths must be local, not network shares')
    if not (path.is_dir() if directory else path.is_file()):
        raise ValueError('Required private input missing')
    if os.name == 'posix' and (path.stat().st_uid != os.getuid() or stat.S_IMODE(path.stat().st_mode) & 0o077):
        raise ValueError('Private inputs require owner-only permissions (directory 700, files 600)')
    return path


def ledger_versions(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError('Captured ledger must be a nonempty array')
    versions = [r.get('version') for r in rows if isinstance(r, dict)]
    if len(versions) != len(rows) or any(not isinstance(v, str) or not re.fullmatch(r'\d{14}', v) for v in versions):
        raise ValueError('Captured ledger versions must be exact fourteen-digit strings')
    if len(set(versions)) != len(versions):
        raise ValueError('Duplicate captured ledger version')
    return sorted(versions)


def validate_catalog(rows):
    if not isinstance(rows, list) or not rows:
        raise ValueError('Complete private catalog required')
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'kind', 'identity', 'fingerprint'}:
            raise ValueError('Catalog may contain only kind, identity and fingerprint')
        if not all(isinstance(row[k], str) and row[k] for k in row):
            raise ValueError('Invalid catalog metadata')
        if not re.fullmatch(r'[0-9a-f]{32}', row['fingerprint']):
            raise ValueError('Invalid catalog fingerprint')
    compare_catalogs(rows, rows)  # duplicate identities fail closed


def validate_export_counts(actual):
    if actual.get('rls_enabled_tables') != 408 or actual.get('security_definer_count') != 924:
        raise ValueError('Restored RLS/SECURITY DEFINER counts differ from private export')
    for schema, counts in COUNTS.items():
        if any(actual.get('counts', {}).get(schema, {}).get(key) != value for key, value in counts.items()):
            raise ValueError('Restored schema counts differ from reported export')


def boundary_gate(manifest, baseline_ledger, latest_ledger, increments):
    old, latest = ledger_versions(baseline_ledger), ledger_versions(latest_ledger)
    if len(latest) != LATEST_COUNT or latest[-1] != CONTACT_VERSION:
        raise ValueError('Latest reported ledger must contain 966 versions ending 20261020214527; recapture/review if changed')
    if not set(old).issubset(latest) or manifest.get('superseded_versions') != old or manifest.get('cutover_version') != old[-1]:
        raise ValueError('Exact baseline-time ledger coverage required')
    if manifest.get('latest_ledger_sha256') != evidence_digest(latest_ledger):
        raise ValueError('Latest ledger hash differs')
    expected = sorted(set(latest) - set(old))
    supplied = [r['version'] for r in increments]
    if not expected or supplied != expected or any(v <= old[-1] for v in supplied):
        raise ValueError('Post-export increments must exactly cover latest minus baseline, in order; no historical replay')
    contact = next((r for r in increments if r['version'] == CONTACT_VERSION), None)
    if contact is None or contact.get('sha256') != CONTACT_SHA256 or contact.get('bytes') != 4771:
        raise ValueError('Reported 4771-byte post-export contact migration hash differs')
    for row in increments:
        if not SHA.fullmatch(row.get('sha256', '')) or row.get('human_reviewed') is not True:
            raise ValueError('Every incremental SQL needs exact hash and independent human review')


def load_private_bundle(root, repository):
    root = private_path(root, repository, directory=True)
    def path(name):
        if not isinstance(name, str) or Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Manifest inputs must be relative private-root paths')
        return private_path(root / name, repository)
    def read_json(p):
        return json.loads(p.read_text(encoding='utf-8'))
    manifest = read_json(path('reviewed-cutover.json'))
    baseline = path(manifest['baseline_file'])
    # Read only in the operator environment; never return or print SQL.
    data = baseline.read_bytes()
    if len(data) != EXPORT_BYTES or digest(data) != EXPORT_SHA256 or manifest.get('schema_sha256') != EXPORT_SHA256:
        raise ValueError('Private export does not match operator-reported SHA256 and 5442397 bytes')
    baseline_ledger_path = path(manifest['baseline_ledger_file'])
    baseline_ledger = read_json(baseline_ledger_path)
    latest_ledger = read_json(path(manifest['latest_ledger_file']))
    parity_path = path(manifest['parity_file'])
    parity = read_json(parity_path)
    blockers = baseline_gate(manifest, baseline, baseline_ledger, parity)
    if blockers:
        raise ValueError('Reviewed baseline gate failed')
    if manifest.get('reviewed_parity_sha256') != evidence_digest(parity):
        raise ValueError('Reviewed parity hash differs')
    review_path = path(manifest['human_review_receipt_file'])
    if digest(review_path.read_bytes()) != manifest.get('human_review_receipt_sha256'):
        raise ValueError('Private human review receipt hash differs')
    review = read_json(review_path)
    if not review.get('reviewer') or not review.get('reviewed_at') or review.get('schema_sha256') != EXPORT_SHA256:
        raise ValueError('Named and dated private human review required')
    for key in ['human_secret_reviewed', 'managed_dependencies_reviewed', 'owners_and_grants_reviewed',
                'storage_auth_integration_reviewed']:
        if review.get(key) is not True:
            raise ValueError('Private receipt must explicitly approve each human review scope')
    for key in ['ledger_sha256', 'latest_ledger_sha256', 'source_catalog_sha256', 'managed_dependencies_sha256']:
        if review.get(key) != manifest.get(key):
            raise ValueError('Private review receipt must bind ledger, catalog and managed reconciliation hashes')
    catalog_path = path(manifest['source_catalog_file'])
    catalog = read_json(catalog_path)
    validate_catalog(catalog)
    if manifest.get('source_catalog_sha256') != evidence_digest(catalog):
        raise ValueError('Baseline-time complete catalog hash differs')
    if manifest.get('reported_counts') != COUNTS or manifest.get('rls_enabled_tables') != 408 or manifest.get('security_definer_count') != 924:
        raise ValueError('Reported export counts differ; counts are not object parity proof')
    if manifest.get('required_extensions') != EXTENSIONS:
        raise ValueError('All seven exact production extension versions required')
    if not manifest.get('supabase_cli_version') or not manifest.get('supabase_database_image') or manifest.get('postgres_version') != '17.6':
        raise ValueError('Reviewed genuine Supabase stack and PostgreSQL 17.6 required')
    managed = path(manifest['managed_dependencies_file'])
    if digest(managed.read_bytes()) != manifest.get('managed_dependencies_sha256') or review_baseline(managed)['scan_findings']:
        raise ValueError('Reviewed managed dependency SQL hash/scan failed')
    # Managed foundations must come from genuine Supabase; SQL only reconciles exact
    # extension installations, app-owned managed hooks, owners and grants.
    increments = manifest.get('incremental_sources', [])
    boundary_gate(manifest, baseline_ledger, latest_ledger, increments)
    resolved = []
    for row in increments:
        p = path(row['file'])
        b = p.read_bytes()
        if digest(b) != row['sha256'] or len(b) != row.get('bytes'):
            raise ValueError('Incremental SQL bytes differ')
        resolved.append(dict(row, path=str(p)))
    for key, p in [('catalog_query_sha256', Path(__file__).with_name('catalog-fingerprints.sql')),
                   ('counts_query_sha256', Path(__file__).with_name('export-counts.sql')),
                   ('acl_query_sha256', Path(repository) / 'docs/architecture/2026-10-19-security-acl-acceptance.sql')]:
        if manifest.get(key) != digest(p.read_bytes()):
            raise ValueError('Reviewed verification query bytes differ')
    return dict(root=root, manifest=manifest, baseline=baseline, ledger=baseline_ledger_path, catalog_rows=catalog,
                latest_versions=ledger_versions(latest_ledger), catalog=catalog_path, parity=parity_path,
                managed=managed, increments=resolved)


def owned_container_gate(items, identifier, network):
    owned = [item for item in items if item['Name'].endswith('_' + identifier)]
    if not owned or not any(item['Name'] == '/supabase_db_' + identifier for item in owned):
        raise ValueError('Owned database container missing')
    for item in owned:
        if set(item['NetworkSettings']['Networks']) != {network}:
            raise ValueError('Owned container has additional network access')
        if item['HostConfig']['LogConfig']['Type'] != 'none':
            raise ValueError('Owned container logging must be disabled')
        for bindings in item['NetworkSettings']['Ports'].values():
            if any(b.get('HostIp') not in ('127.0.0.1', '::1') for b in bindings or []):
                raise ValueError('Owned container exposes non-loopback ports')


def cleanup_owned(run, root, network, started, network_created):
    """Attempt both resources even when one command fails; never persist errors."""
    blockers = []
    if started:
        try:
            run(['supabase', 'stop', '--workdir', str(root), '--no-backup'])
        except Exception:
            blockers.append('owned Supabase cleanup failed')
    if network_created:
        try:
            run(['docker', 'network', 'rm', network])
        except Exception:
            blockers.append('owned network cleanup failed')
    return blockers