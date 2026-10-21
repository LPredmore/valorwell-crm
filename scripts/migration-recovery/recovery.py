"""Read-only source/baseline gates. Never connects to a database or repairs history."""
import argparse
import hashlib
import json
import re
from pathlib import Path

MEMBERSHIP_VERSION = '20261019165842'
MEMBERSHIP_SHA256 = '89404791b3d91e1d9585c82e4b2ef4bd329f92c67b9da9102322bbc46dab08da'
RELEASE_ORDER = [
    ('crm', '20261019000200'), ('billing', '20261019000300'),
    ('crm', '20261019000310'), ('crm-draft193', MEMBERSHIP_VERSION),
    ('crm', '20261019000400'), ('crm', '20261019000410'),
    ('crm', '20261019000500'), ('crm', '20261019000600'),
    ('crm', '20261019000800'), ('billing', '20261019085103'),
]
STEDI_VERSION = '20261018235900'
STRIPE_SOURCE_VERSION = '20261019000100'
STRIPE_APPLIED_VERSION = '20261019232604'
BODYLESS_VERSIONS = [
    '20260813090700', '20260813090800', '20260813090900',
    '20260813091500', '20260813091600', '20260813093500',
    '20260813100500', '20261015015000',
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def evidence_digest(value):
    return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def validate_acl_rows(rows, signatures):
    expected = {signature + '|ACL_PASS' for signature in signatures}
    return len(signatures) == 14 and len(rows) == 14 and len(expected) == 14 and set(rows) == expected


def inventory(repositories, ledger=None):
    """Preserve original bytes: same version/different hash is a blocking collision."""
    rows = []
    invalid_names = []
    for name, root in sorted(repositories.items()):
        folder = Path(root) / 'supabase' / 'migrations'
        if not folder.is_dir():
            raise ValueError(f'Missing migration directory: {name}')
        for path in sorted(folder.glob('*.sql')):
            match = re.match(r'^(\d{14})(?:_|-|\.)', path.name)
            data = path.read_bytes()
            if not match:
                invalid_names.append(dict(repository=name,path=f'supabase/migrations/{path.name}',
                                          sha256=digest(data),bytes=len(data),
                                          status='UNRECONCILED_VERSION_DO_NOT_INVENT_TIMESTAMP'))
                continue
            rows.append(dict(repository=name, path=f'supabase/migrations/{path.name}',
                             version=match[1], bytes=len(data), sha256=digest(data),
                             git_blob_sha1=hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest(),
                             body_md5=hashlib.md5(data).hexdigest()))
    groups = {}
    for row in rows:
        groups.setdefault(row['version'], []).append(row)
    collisions = [dict(version=v, sources=entries) for v, entries in sorted(groups.items())
                  if len({r['sha256'] for r in entries}) > 1]
    result = dict(format_version=1, source_files=len(rows)+len(invalid_names), unique_versions=len(groups),
                  invalid_names=invalid_names,
                  sources=rows, collisions=collisions,
                  identical_duplicates=[v for v, entries in sorted(groups.items())
                                        if len(entries)>1 and len({r['sha256'] for r in entries})==1],
                  earliest_missing_bootstrap='20251201181524' not in groups,
                  bodyless_candidates={v: groups.get(v, []) for v in BODYLESS_VERSIONS})
    if ledger is not None:
        if len({r['version'] for r in ledger}) != len(ledger):
            raise ValueError('Duplicate ledger versions')
        result['ledger_mapping'] = [dict(
            **row, source_candidates=groups.get(row['version'], []),
            status=('BODYLESS_CANDIDATE_NOT_APPLIED_BYTE_PROOF' if not row.get('statement_count')
                    else 'EXACT_MD5_MATCH' if any(r['body_md5']==row.get('body_md5')
                                               for r in groups.get(row['version'], []))
                    else 'SOURCE_BYTES_DIFFER_OR_MISSING')) for row in ledger]
        result['ledger_count'] = len(ledger)
    return result


def release_sources(repositories, with_stedi=False):
    order = ([('billing-draft34', STEDI_VERSION)] if with_stedi else []) + RELEASE_ORDER
    result = []
    for name, version in order:
        root = repositories.get(name)
        paths = sorted((Path(root)/'supabase/migrations').glob(f'{version}_*.sql')) if root else []
        if len(paths) != 1:
            raise ValueError(f'Expected exactly one reviewed {name} source for {version}; got {len(paths)}')
        data = paths[0].read_bytes()
        if version == MEMBERSHIP_VERSION and digest(data) != MEMBERSHIP_SHA256:
            raise ValueError('Draft #193 source drift: membership correction hash differs')
        result.append(dict(repository=name, version=version, sha256=digest(data),
                           path=str(paths[0].resolve())))
    return result


def reviewed_membership(path):
    path = Path(path)
    if not path.is_file() or digest(path.read_bytes()) != MEMBERSHIP_SHA256:
        raise ValueError('Supply the unchanged reviewed PR #193 membership correction; never add user_id to the fixture')
    return path


def review_baseline(path):
    """Conservative secret/data gate, NOT a substitute for human SQL review."""
    data = Path(path).read_bytes()
    text = data.decode('utf-8')
    findings = []
    patterns = {
        'private_key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        'jwt_literal': r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}',
        'credential_uri': r'postgres(?:ql)?://[^\s/]+:[^\s@]+@',
        'provider_key': r'\b(?:sk_live_|sk_test_|AKIA)[A-Za-z0-9]{12,}',
        'data_copy': r'(?im)^\s*COPY\b',
        'data_mutation': r'(?im)^\s*(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|MERGE\s+INTO)\b',
        'data_section': r'(?im)^-- Data for Name:',
        'psql_include_or_shell': r'(?m)^\s*\\(?!(?:restrict|unrestrict)\s)[^\s]+',
        'cron_activation': r'(?im)^\s*(?:SELECT|INSERT).*cron\.(?:schedule|job)',
    }
    for category, pattern in patterns.items():
        if re.search(pattern, text):
            findings.append(category)  # Never expose matched text or credentials.
    return dict(sha256=digest(data), bytes=len(data), scan_findings=findings,
                automated_scan_pass=not findings, human_secret_review_required=True,
                replayable_baseline_proven=False)


def compare_catalogs(left, right):
    def keyed(rows):
        result = {}
        for row in rows:
            key = (row['kind'], row['identity'])
            if key in result:
                raise ValueError(f'Duplicate catalog identity: {key}')
            result[key] = row['fingerprint']
        return result
    a, b = keyed(left), keyed(right)
    return dict(missing=[list(k) for k in sorted(a.keys()-b.keys())],
                extra=[list(k) for k in sorted(b.keys()-a.keys())],
                changed=[list(k) for k in sorted(a.keys() & b.keys()) if a[k]!=b[k]])


def baseline_gate(manifest, baseline, ledger, catalog_diff):
    blockers = []
    if manifest.get('strategy') != 'current-schema-cutover':
        blockers.append('explicit current-schema cutover required')
    scan = review_baseline(baseline)
    if scan['scan_findings']:
        blockers.append('secret/data scan failed')
    if manifest.get('schema_sha256') != scan['sha256']:
        blockers.append('baseline bytes differ')
    if manifest.get('human_secret_reviewed') is not True:
        blockers.append('human secret review missing')
    actual = sorted(r['version'] for r in ledger)
    if manifest.get('ledger_sha256') != evidence_digest(ledger):
        blockers.append('captured ledger hash differs or missing')
    if manifest.get('superseded_versions') != actual or len(actual)!=len(set(actual)):
        blockers.append('exact historical-version coverage missing')
    if not actual or manifest.get('cutover_version') != max(actual):
        blockers.append('cutover boundary differs from actual ledger')
    if set(catalog_diff) != {'missing', 'extra', 'changed'} or not all(isinstance(v, list) for v in catalog_diff.values()):
        blockers.append('exact parity evidence schema required')
    if any(catalog_diff.values()):
        blockers.append('object-level catalog parity failed')
    for key in ['managed_dependencies_reviewed', 'owners_and_grants_reviewed', 'storage_auth_integration_reviewed']:
        if manifest.get(key) is not True:
            blockers.append(f'{key} missing')
    return blockers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inventory', 'release', 'review-baseline', 'compare-catalogs'])
    parser.add_argument('--repo', action='append', default=[], metavar='NAME=PATH')
    parser.add_argument('--ledger', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--candidate-catalog', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--with-stedi', action='store_true')
    args = parser.parse_args()
    repos = dict(v.split('=',1) for v in args.repo)
    if args.action == 'inventory':
        result = inventory(repos, json.loads(args.ledger.read_text()) if args.ledger else None)
    elif args.action == 'release':
        result = release_sources(repos, args.with_stedi)
    elif args.action == 'review-baseline':
        if args.baseline is None: parser.error('--baseline required')
        result = review_baseline(args.baseline)
    else:
        if args.catalog is None or args.candidate_catalog is None: parser.error('both catalogs required')
        result = compare_catalogs(json.loads(args.catalog.read_text()), json.loads(args.candidate_catalog.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    blocked = isinstance(result, dict) and (result.get('collisions') or result.get('invalid_names') or result.get('scan_findings')
                                           or (args.ledger and (result.get('earliest_missing_bootstrap') or any(r['status'] != 'EXACT_MD5_MATCH' for r in result.get('ledger_mapping', []))))
                                           or any(result.get(k) for k in ['missing','extra','changed']))
    print('BLOCKED' if blocked else 'Source check passed; database acceptance NOT implied')
    raise SystemExit(2 if blocked else 0)


if __name__ == '__main__':
    main()