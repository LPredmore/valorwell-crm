"""Offline validation of one sanitized operator receipt; never database acceptance.

No connections, environment credentials, SQL, or diagnostic payloads are read.
The closed metadata contract intentionally rejects extra fields and raw evidence.
Changing reported facts requires an audited source change, not runtime overrides.
"""
import argparse
import json
from pathlib import Path

from private_restore import EXPORT_SHA256, EXPORT_BYTES, CONTACT_VERSION
from recovery import RELEASE_ORDER, STRIPE_APPLIED_VERSION


RECEIPT = Path(__file__).resolve().parents[2] / 'docs/architecture/migration-recovery-evidence/20261021-branch-recovery-receipt.json'


def expected_metadata():
    """Frozen operator-reported contract, independent of the checked-in JSON."""
    return {
        'format_version': 1,
        'reported_at_utc': '2026-10-21T02:02:00Z',
        'provenance': 'operator_report_not_independently_observed',
        'branch': dict(project_ref='dskqovrvogmwrlmxsdjd', parent_ref='ahqauomkgflopxgnlndd',
                       name='valorwell-security-recovery-20261020', uuid='cbf4bf6f-b2c9-4cd5-96cd-899fee2acc46',
                       authorized_by_operator=True, hourly_usd='0.01344',
                       control_plane_status='MIGRATIONS_FAILED', rebase_reset_merge_allowed=False),
        'native_replay': dict(failed_version='20251201181524', missing_function='public.set_updated_at()',
                              applied_migrations=0, application_tables=0, restored_966_step_replay=False),
        'reconstruction': dict(schema_sha256=EXPORT_SHA256, schema_bytes=EXPORT_BYTES,
                               ordered_branch_only_batches=12, pg_cron_version='1.6.4',
                               counts=dict(base_tables=425, functions=1122, views=37, policies=551,
                                           noninternal_triggers=368, enum_types=67),
                               omitted_default_acl_statements=12, omitted_acl_owner='supabase_admin',
                               omission_reason='postgres_role_membership', branch_ledger_versions=24,
                               production_historical_ledger_versions=966, historical_ledger_fabricated=False,
                               data_imported=dict(tenants=False, clients=False, claims=False, auth_users=False)),
        'branch_application': dict(post_snapshot_version=CONTACT_VERSION,
                                   ordered_security_claims_versions=[version for _, version in RELEASE_ORDER],
                                   all_ten_applied=True, already_applied_production_stripe_version=STRIPE_APPLIED_VERSION,
                                   stripe_reapplied=False, stedi_retirement_applied=False),
        'parity': dict(column_definitions_md5_matches=6188, rls_policy_matches=551,
                       index_matches=1578, table_constraint_matches=2399,
                       base_table_view_rls_schema_counts_match=True,
                       view_difference=dict(identity='public.relationship_report_metrics_v',
                                            pg_get_viewdef_fingerprint_differs=True, type_and_invoker_match=True,
                                            canonical_aliasing_hypothesis_only=True, review_resolved=False),
                       pg_net=dict(branch_version='0.20.4', branch_schema='extensions',
                                   production_version='0.19.5', production_schema='public', review_resolved=False),
                       full_object_parity_proven=False),
        'security_checks': dict(targeted_security_definer_count=15, targeted_signatures_supplied=False,
                                anon_blocked=15, service_role_allowed=15, authenticated_blocked=14,
                                authenticated_read_only_exception='public.claim_is_externally_submitted_v1',
                                membership_column='tenant_memberships.profile_id', authorized_operator_guard_retained=True,
                                claim_status_protection_triggers_attached_enabled=3,
                                runtime_method='SET ROLE_not_signed_JWT_PostgREST',
                                anon_billing_identity_context='NULL', anon_crm_operating_context='crm_none',
                                anon_crm_capabilities=0, authenticated_campaign_without_membership_sqlstate='42501',
                                authenticated_campaign_without_membership_result='unauthorized'),
        'advisor': dict(anon_executable_security_definer_flagged=15,
                        authenticated_executable_security_definer_flagged=306,
                        further_review_required=True, new_breach_proven=False),
        'acceptance': dict(independent_signed_jwt_postgrest_cross_tenant=False, real_stripe_workflow=False,
                           real_claim_md_workflow=False, real_edge_workflow=False, production_deployed=False,
                           production_release_authorized=False, source_follow_up_supabase_calls=False,
                           private_sql_shared_with_lovable_or_github=False),
    }


def matches_contract(actual, expected):
    # bool is a subclass of int: exact types prevent 1/0 from forging attestations.
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return (actual.keys() == expected.keys()
                and all(matches_contract(actual[key], value) for key, value in expected.items()))
    if isinstance(expected, list):
        return (len(actual) == len(expected)
                and all(matches_contract(a, b) for a, b in zip(actual, expected)))
    return actual == expected


def validate_receipt(receipt):
    """Return fixed categories only; never echo unknown input or private content."""
    expected = expected_metadata()
    if type(receipt) is not dict or receipt.keys() != expected.keys():
        return ['receipt_shape']
    return [key for key, value in expected.items() if not matches_contract(receipt[key], value)]


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate metadata key')
        result[key] = value
    return result


def load_receipt(path):
    # This entry point accepts sanitized JSON only, not raw SQL or private bundles.
    if path.suffix != '.json' or path.stat().st_size > 32768:
        raise ValueError('Sanitized JSON required')
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', type=Path, default=RECEIPT,
                        help='Sanitized operator receipt JSON only; never a private export')
    args = parser.parse_args()
    try:
        if validate_receipt(load_receipt(args.receipt)):
            raise ValueError('Receipt contract differs')
    except Exception:
        print('BLOCKED: sanitized receipt invalid; no input diagnostics emitted')
        return 2
    print('SANITIZED_RECEIPT_VALID; operator-reported SQL checks only; signed-JWT acceptance and production release NOT proven')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())