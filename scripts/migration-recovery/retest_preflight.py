"""Offline P0 preflight. Never provisions, connects, seeds, deploys or approves release."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from recovery import release_sources

DEPENDENCIES = {
    'source': [], 'baseline': ['source'], 'catalog': ['baseline'],
    'jwt': ['catalog'], 'worker': ['jwt'], 'stripe': ['worker'],
    'claims': ['worker'], 'stedi': ['catalog'], 'provider': ['claims', 'stripe'],
    'hosted-ui': ['worker'],
    'release': ['source', 'baseline', 'catalog', 'jwt', 'worker', 'stripe',
                'claims', 'stedi', 'provider', 'hosted-ui'],
}
BLOCKERS = {
    'baseline': ('DB-01/02', 'Schema owner: supply approved complete private baseline, review receipt, export-time ledger and fresh inventory.'),
    'catalog': ('DB-03/04', 'Platform owner: reconcile all ACLs, Auth hook, 19 Storage policies, both publication classes and engine/extensions on a new owned stack.'),
    'jwt': ('SEC-01', 'Test owner: run genuine GoTrue/PostgREST signed-role and two-tenant matrix on the isolated stack.'),
    'worker': ('CRM-01/INT-01', 'CRM owner: review #193 and run DB-backed worker and recovery scenarios; no hosted dispatch.'),
    'stripe': ('BILL-01', 'Billing owner: run native financial RPC/reconciliation and signed sandbox webhook suite; deployed v73 remains separate.'),
    'claims': ('BILL-02', 'Billing owner: run signed claims/payroll, uncertainty, deduplication and immutable-line DB scenarios.'),
    'stedi': ('STEDI-01', 'Billing owner: synthetic 4-attempt/6-event preservation fixtures plus separate read-only historic retention and uncertain-route review.'),
    'provider': ('INT-01', 'Provider owner: designate approved sandbox and obtain genuine acknowledgement/settlement evidence.'),
    'hosted-ui': ('INT-01', 'UAT owner: run CRM-only and multi-role UI scenarios against the verified isolated API.'),
    'release': ('RELEASE', 'Release owner: all acceptance gates plus separate production rollout authorizations; P6 is excluded.'),
}


def source_identity(root):
    root = Path(root).resolve()
    sha = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = bool(subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], text=True).strip())
    return {'sha': sha, 'dirty': dirty}


def build_manifest(repositories):
    """Hash real ordered SQL; missing/drifting required inputs stop before execution."""
    sources = release_sources(repositories, with_stedi=True)
    for row in sources:
        row['path'] = str(Path(row['path']).relative_to(Path(repositories[row['repository']]).resolve()))
    identities = {name: source_identity(root) for name, root in sorted(repositories.items())}
    tool_sha = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    gates = {}
    for name, deps in DEPENDENCIES.items():
        code, action = BLOCKERS.get(name, ('P0-SOURCE', 'Run source safety regressions; this is not application or database acceptance.'))
        gates[name] = {'status': 'BLOCKED', 'assertion_count': 0,
                       'counts': {'passed': 0, 'failed': 0, 'blocked': 0, 'skipped': 0},
                       'evidence_uri': None, 'environment_selector': 'none: no acceptance environment provisioned',
                       'schema_fingerprint': None, 'dependencies': deps,
                       'blocker': code, 'owner_action': action}
    return {'format_version': 1, 'scope': 'P0 offline preflight; P1-P5 not executed',
            'source': identities, 'tool_sha256': tool_sha,
            'baseline_sha256': None, 'gates': gates,
            'release_decision': 'NOT_READY', 'production_mutated': False,
            'proposed_release': {'status': 'BLOCKED_NOT_DEPLOYABLE',
                'refresh_production_ledger_before_packaging': True,
                'deployment_versions': None,
                'version_rule': 'CLI-generated versions strictly above freshly observed production maximum; preserve this input order.',
                'excluded_already_applied': ['20261019232604', '20261020214527'],
                'excluded_alias': ['20261019000100'],
                'optional_stedi_requires_separate_owner_approval': True,
                'reviewed_input_order': sources}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', action='append', required=True, help='name=path: crm, billing, crm-draft193, billing-draft34')
    parser.add_argument('--output', type=Path, required=True, help='New metadata-only JSON file; never raw SQL or logs')
    args = parser.parse_args()
    try:
        repositories = {}
        for value in args.repo:
            name, path = value.split('=', 1)
            if name not in {'crm', 'billing', 'crm-draft193', 'billing-draft34'} or name in repositories:
                raise ValueError('Invalid/duplicate repository alias')
            repositories[name] = Path(path)
        result = build_manifest(repositories)
        with args.output.open('x') as output:
            json.dump(result, output, indent=2)
            output.write('\n')
    except Exception:
        print('BLOCKED: source inputs unavailable/drifting or output unavailable; no raw diagnostics emitted', file=sys.stderr)
        return 2
    print('BLOCKED: P0 source inputs pinned; approved private baseline and native acceptance prerequisites remain unmet')
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
