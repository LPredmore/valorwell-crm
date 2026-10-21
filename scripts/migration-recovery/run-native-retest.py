"""Provision, validate, restore and clean a private nonproduction native candidate.

All external providers remain disabled. Missing/failed stages do not stop independent
checks, and no successful development check implies owner approval or release parity.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from native_stack import NativeStack
from native_acceptance import foundation_matrix, seed_application_roles, storage_matrix
from native_restore import restore_candidate, reconcile_foundations, reconcile_application_publication
from recovery import release_sources
from native_suites import worker_suites
from native_history import stedi_preservation
from native_catalog import compare_native
from native_behavior import signup_probe, realtime_probe
from native_payroll import payroll_matrix


def checks(stack, repositories, candidate, with_security=True, resend_module=None):
    identities = foundation_matrix(stack)
    reconcile_foundations(stack, candidate)
    baseline_ok = restore_candidate(stack, candidate)
    stack.report['candidate_restored'] = baseline_ok
    stack.report['independent_owner_approval'] = False
    stack.report['complete_schema_parity'] = 'NOT_VERIFIED'
    if not baseline_ok:
        stack.report['gates']['application_acceptance'] = 'BLOCKED: candidate restore failed; independent source/foundation results retained'
        stack.save()
        return
    reconcile_application_publication(stack, candidate)
    compare_native(stack, repositories['billing'], candidate)
    # Only the reviewed ordering function selects release SQL; no historical push.
    if with_security:
        for entry in release_sources(repositories):
            data = Path(entry['path']).read_bytes()
            if hashlib.sha256(data).hexdigest() != entry['sha256']:
                raise ValueError('Ordered source changed')
            stack.sql(data.decode())
            stack.report.setdefault('isolated_security_deltas', []).append(
                dict(version=entry['version'], sha256=entry['sha256'], status='APPLIED_ONLY_TO_DEVELOPMENT_STACK'))
            stack.save()
    seed_application_roles(stack, identities)
    for probe in [lambda: signup_probe(stack), lambda: realtime_probe(stack, identities[0])]:
        try:
            probe()
        except Exception as error:
            stack.report.setdefault('independent_probe_errors', []).append(type(error).__name__)
    try:
        stack.sql((Path(repositories['billing']) / 'supabase/tests/claim_payroll_internal_rpc_acl.sql').read_text())
        stack.report['claim_payroll_rpc_acl'] = 'PASS: actual native catalog, four internal RPCs; not provider acceptance'
    except Exception as error:
        stack.report['claim_payroll_rpc_acl'] = 'FAIL: ' + type(error).__name__
    stack.save()
    storage_matrix(stack, identities, 'captured_current_policies')
    try:
        payroll_matrix(stack, identities)
    except Exception as error:
        stack.report['payroll_database_error'] = dict(status='BLOCKED', reason=type(error).__name__)
        stack.save()
    if resend_module:
        worker_suites(stack, repositories, resend_module)
    else:
        stack.report['gates']['worker_suites'] = 'BLOCKED: pinned Resend SDK module not configured'
    if repositories.get('billing-draft34'):
        try:
            sources = release_sources(repositories, with_stedi=True)
            stedi_preservation(stack, sources[0]['path'])
        except Exception as error:
            stack.report['stedi_preservation'] = dict(status='BLOCKED', reason=type(error).__name__)
    try:
        policy = Path(__file__).resolve().parents[2] / 'supabase/verification/crm_public_asset_tenant_metadata_candidate.sql'
        stack.sql(policy.read_text())
        storage_matrix(stack, identities, 'tenant_metadata_development_candidate', tenant_bound=True)
    except Exception as error:
        stack.report['tenant_storage_candidate'] = dict(status='BLOCKED', reason=type(error).__name__)
    stack.report['gates']['provider'] = 'BLOCKED: genuine designated sandbox credentials/acknowledgement absent; no provider request made'
    stack.report['gates']['release'] = 'BLOCKED: P6 excluded; candidate review, complete parity and full acceptance remain required'
    stack.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-run', type=Path, required=True, help='Fresh owner-only run directory outside all source trees')
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--repo', action='append', required=True, help='Reviewed alias=path, as in recovery.py')
    parser.add_argument('--retain-for-diagnosis', action='store_true', help='Retain only this run; cleanup command is printed without credentials')
    parser.add_argument('--resend-module', type=Path, help='Pinned Resend 6.18.0 dist/index.mjs installed from native/sdk-runtime lock')
    args = parser.parse_args()
    stack = None
    code = 2
    try:
        repositories = dict(value.split('=', 1) for value in args.repo)
        # Missing/drifting SQL or candidate hashes fail before any container setup.
        release_sources(repositories)
        manifest = json.loads((args.candidate / 'candidate-manifest.json').read_text())
        for name, expected in manifest['stage_sha256'].items():
            if hashlib.sha256((args.candidate / 'stages' / name).read_bytes()).hexdigest() != expected:
                raise ValueError('Candidate bytes drifted')
        stack = NativeStack(args.private_run)
        stack.report['candidate_manifest_sha256'] = hashlib.sha256((args.candidate / 'candidate-manifest.json').read_bytes()).hexdigest()
        stack.start()
        checks(stack, repositories, args.candidate, resend_module=args.resend_module)
        # Completion is deliberately nonzero until all mandatory gates are proven.
        print('DEVELOPMENT_CHECKS_FINISHED; inspect redacted metadata; full acceptance/release NOT established')
    except Exception as error:
        if stack:
            stack.report['failure_type'] = type(error).__name__
            stack.report['status'] = 'BLOCKED'
            stack.save()
        print('BLOCKED: native candidate prerequisites or assertions failed; no raw diagnostics emitted', file=sys.stderr)
    finally:
        if stack:
            if args.retain_for_diagnosis:
                stack.report['cleanup'] = 'RETAINED_OWNED_STACK'
                stack.save()
                print('Owned private stack retained; use cleanup-native-retest.py --private-run with this run directory')
            elif stack.cleanup():
                code = 2
    return code


if __name__ == '__main__':
    raise SystemExit(main())
