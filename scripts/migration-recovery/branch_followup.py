"""Offline versioned branch evidence and source gates; no database/network access."""
from pathlib import Path

from branch_receipt import load_receipt, matches_contract
from private_restore import EXPORT_SHA256, EXPORT_BYTES, CONTACT_VERSION, CONTACT_SHA256
from recovery import RELEASE_ORDER, STEDI_VERSION, STRIPE_APPLIED_VERSION, digest

ROOT = Path(__file__).resolve().parents[2]
RECEIPT = ROOT / 'docs/architecture/migration-recovery-evidence/20261021-0341-branch-followup.json'
ACL_SQL = ROOT / 'supabase/tests/20261018_october_security_rollout_readonly.sql'
ACL_SHA256 = '2b932817a8f03f68a30382d71c0f8afc133e6cb2a3fbecd482f0af6e59791052'
# Labels belong to the existing sixteen-function gate, NOT the earlier 14/15 sets.
ACL_LABELS = (
    'stripe_payment_post', 'crm_idempotency_claim', 'crm_idempotency_record',
    'claim_submission_finalizer', 'stedi_submission_finalizer', 'payroll_reconciliation',
    'payroll_historical_gap', 'social_publish_enqueue', 'campaign_trigger_enqueue',
    'email_reply_correlate', 'campaign_concurrency', 'crm_automation_event',
    'crm_internal_tenant_check', 'crm_manual_enrollment_api', 'crm_donor_overview_api',
    'crm_legacy_replay_api',
)
AUTHENTICATED_APIS = {'crm_manual_enrollment_api', 'crm_donor_overview_api', 'crm_legacy_replay_api'}


def expected_metadata():
    return {
        'format_version': 2,
        'reported_at_utc': '2026-10-21T03:41:00Z',
        'provenance': 'user_report_of_ChatGPT_Supabase_checks_not_observed_here',
        'previous_receipt': '20261021-branch-recovery-receipt.json',
        'branch': {
            'project_ref': 'dskqovrvogmwrlmxsdjd', 'parent_ref': 'ahqauomkgflopxgnlndd',
            'name': 'valorwell-security-recovery-20261020', 'hourly_usd': '0.01344',
            'status': 'MIGRATIONS_FAILED', 'branch_ledger_count': 25, 'production_ledger_count': 966,
            'shadow_test_versions_canonical': False, 'merge_reset_rebase_allowed': False,
            'current_existence_or_total_cost_observed_here': False,
        },
        'restore': {
            'native_first_failure': '20251201181524', 'missing_dependency': 'public.set_updated_at()',
            'native_history_reproducible': False, 'schema_sha256': EXPORT_SHA256, 'schema_bytes': EXPORT_BYTES,
            'schema_batches': 12, 'pg_cron_branch_install': '1.6.4', 'clinical_rows_copied': False,
            'branch_cron_jobs': 0,
            'post_export': {'version': CONTACT_VERSION, 'sha256': CONTACT_SHA256, 'bytes': 4771,
                            'exact_export_time_ledger_supplied_here': False},
            'ordered_ten_source_versions': [version for _, version in RELEASE_ORDER],
            'separate_stedi_version': STEDI_VERSION, 'stedi_applied_branch_only': True,
            'ten_plus_stedi_stored_bodies_textually_equal_reported': True,
            'per_source_hashes_or_bodies_supplied_here': False,
            'stripe_source_version_do_not_reapply': '20261019000100',
            'stripe_production_applied_version': STRIPE_APPLIED_VERSION, 'stripe_reapplied': False,
        },
        'catalog': {
            'tables_by_schema': {'public': 361, 'private': 51, 'credentialing': 13}, 'tables': 425,
            'rls_enabled': 408, 'views': 37, 'enum_types': 67,
            'indexes_by_schema': {'public': 1385, 'private': 156, 'credentialing': 37}, 'indexes': 1578,
            'production_functions': 1122, 'branch_functions': 1123,
            'expected_extra_helper': 'private.claim_is_externally_submitted_internal_v1',
            'policies': 551, 'triggers': 368,
            'all_tables_indexes_fingerprints_match_reported': True,
            'all_credentialing_fingerprints_match_reported': True,
            'expected_change_categories': ['claim_functions', 'crm_functions', 'title_trigger', 'claim_lines_trigger'],
            'complete_per_object_diff_supplied_here': False, 'full_parity_proven_here': False,
            'unresolved_view': 'public.relationship_report_metrics_v',
            'omitted_managed_default_acls': 12, 'omitted_owner': 'supabase_admin',
            'managed_privileges_resolved': False,
            'pg_net_production': '0.19.5', 'pg_net_branch': '0.20.4', 'pg_net_mismatch_resolved': False,
        },
        'checks': {
            'october_acl_sql_sha256': ACL_SHA256, 'gate_size': 16,
            'production_pass': 4, 'production_fail': 12, 'branch_pass': 16, 'branch_fail': 0,
            'per_rpc_results_supplied_here': False, 'method': 'read_only_SQL_catalog_not_signed_JWT',
            'repository_do_contracts_reported_pass': [
                'claim_payroll_internal_rpc_acl', 'crm_idempotency_internal_acl_contract',
                'crm_automation_event_emitter_acl', 'internal_campaign_social_worker_acl',
                'legacy_donor_attribution_acl_contract'],
            'catalog_assertions_reported_pass': ['campaign_missing_foreign_403_marker', 'claim_line_tenant_trigger',
                                                'donor_transaction_view_browser_denial', 'title_trigger_search_path'],
            'stedi': {'passed': 4, 'total': 6, 'enabled_or_unclosed_routes': 0, 'active_cron': 0,
                      'retirement_constraint_present': True, 'historical_attempts_events_checks_failed': 2,
                      'branch_history_rows': 0, 'production_data_loss_proven': False,
                      'synthetic_fixture_acceptance_run_here': False},
        },
        'advisors': {
            'production_total': 480, 'branch_total': 464, 'production_auth_executable_definers': 318,
            'branch_auth_executable_definers': 306, 'production_anon_executable_definers': 15,
            'branch_anon_executable_definers': 15, 'production_rls_no_policy_info': 144,
            'branch_rls_no_policy_info': 143, 'all_findings_resolved': False,
            'branch_auth_settings_prove_production_settings': False, 'blanket_revocations_authorized': False,
        },
        'release_gate': {
            'source_only': True, 'supabase_calls_here': False, 'branch_deleted_here': False,
            'raw_export_or_credentials_shared': False, 'signed_jwt_acceptance_pass': False,
            'real_provider_actions': False, 'production_released': False, 'production_authorized': False,
            'source_merge_requires_review_and_hosted_green': True,
        },
    }


def validate_receipt(actual):
    expected = expected_metadata()
    if type(actual) is not dict or actual.keys() != expected.keys():
        return ['receipt_shape']
    return [key for key in expected if not matches_contract(actual[key], expected[key])]


def validate_acl_results(rows):
    """Closed offline result contract; passing never authenticates a reported run.

    Only fixed labels, PASS and role booleans. No SQL, identities, tokens or PHI.
    """
    if type(rows) is not list or len(rows) != 16:
        return False
    expected = [{'label': label, 'acl_result': 'PASS', 'anon_execute': False,
                 'authenticated_execute': label in AUTHENTICATED_APIS, 'service_execute': True}
                for label in ACL_LABELS]
    if any(type(row) is not dict or type(row.get('label')) is not str for row in rows):
        return False
    return matches_contract(sorted(rows, key=lambda row: row['label']),
                            sorted(expected, key=lambda row: row['label']))


def source_gate(root=ROOT):
    """Pin reviewed query and available increment; do not infer absent cross-repo bytes."""
    root = Path(root)
    blockers = []
    sql = root / 'supabase/tests/20261018_october_security_rollout_readonly.sql'
    if digest(sql.read_bytes()) != ACL_SHA256:
        blockers.append('october_16_query_source_drift')
    increments = list((root / 'supabase/migrations').glob(CONTACT_VERSION + '_*.sql'))
    if len(increments) != 1:
        blockers.append('postexport_source_cardinality')
    else:
        data = increments[0].read_bytes()
        if len(data) != 4771 or digest(data) != CONTACT_SHA256:
            blockers.append('postexport_source_drift')
    return blockers


def main():
    try:
        if validate_receipt(load_receipt(RECEIPT)) or source_gate():
            raise ValueError('Invalid source evidence')
    except Exception:
        print('BLOCKED: follow-up source evidence invalid; no input diagnostics emitted')
        return 2
    print('FOLLOWUP_SOURCE_PASS; reported catalog 16/16 only; JWT, full parity, native replay and release NOT proven')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
