"""Concrete source/evidence regression rules, entirely offline and synthetic."""
import copy
import tempfile
import unittest
from pathlib import Path

import branch_followup as gate
from branch_receipt import load_receipt


class UpdatedEvidenceRules(unittest.TestCase):
    def setUp(self):
        self.evidence = load_receipt(gate.RECEIPT)

    def reject(self, section, field, value):
        changed = copy.deepcopy(self.evidence)
        changed[section][field] = value
        self.assertIn(section, gate.validate_receipt(changed))

    def test_checked_in_versioned_receipt(self):
        self.assertEqual(gate.validate_receipt(self.evidence), [])
        self.assertEqual(self.evidence['format_version'], 2)

    def test_current_25_is_not_966_or_previous_24(self):
        self.assertEqual(self.evidence['branch']['branch_ledger_count'], 25)
        self.reject('branch', 'branch_ledger_count', 24)
        self.reject('branch', 'branch_ledger_count', 966)

    def test_shadow_test_versions_not_canonical(self):
        self.reject('branch', 'shadow_test_versions_canonical', True)

    def test_never_merge_reset_rebase_failed_branch(self):
        self.reject('branch', 'merge_reset_rebase_allowed', True)
        self.reject('branch', 'status', 'ACTIVE')

    def test_branch_price_and_identity(self):
        self.reject('branch', 'hourly_usd', '0')
        self.reject('branch', 'project_ref', 'ahqauomkgflopxgnlndd')

    def test_native_history_still_not_reproducible(self):
        self.reject('restore', 'native_history_reproducible', True)
        self.reject('restore', 'native_first_failure', '20261020214527')

    def test_twelve_private_batches_not_source_history(self):
        self.reject('restore', 'schema_batches', 13)
        self.reject('restore', 'schema_sha256', '0' * 64)
        self.reject('restore', 'schema_bytes', 0)

    def test_stedi_now_branch_only_without_rewriting_earlier_receipt(self):
        self.assertTrue(self.evidence['restore']['stedi_applied_branch_only'])
        earlier = load_receipt(gate.ROOT / 'docs/architecture/migration-recovery-evidence/20261021-branch-recovery-receipt.json')
        self.assertFalse(earlier['branch_application']['stedi_retirement_applied'])
        self.reject('restore', 'stedi_applied_branch_only', False)

    def test_membership_after_00310_and_ten_sources(self):
        values = self.evidence['restore']['ordered_ten_source_versions']
        self.assertEqual(len(values), 10)
        self.assertEqual(values[values.index('20261019000310') + 1], '20261019165842')
        self.reject('restore', 'ordered_ten_source_versions', sorted(values))

    def test_stripe_must_not_reapply(self):
        self.reject('restore', 'stripe_reapplied', True)

    def test_reported_textual_identity_not_invented_source_hashes(self):
        self.reject('restore', 'per_source_hashes_or_bodies_supplied_here', True)
        self.reject('restore', 'ten_plus_stedi_stored_bodies_textually_equal_reported', False)

    def test_postexport_hash_not_exact_cutover_proof(self):
        self.assertEqual(self.evidence['restore']['post_export']['bytes'], 4771)
        value = copy.deepcopy(self.evidence['restore']['post_export'])
        value['exact_export_time_ledger_supplied_here'] = True
        self.reject('restore', 'post_export', value)

    def test_1123_functions_expected_extra_helper(self):
        self.reject('catalog', 'branch_functions', 1122)
        self.reject('catalog', 'expected_extra_helper', 'dummy_helper')

    def test_indexes_resolve_typo_from_exact_schema_counts(self):
        self.assertEqual(sum(self.evidence['catalog']['indexes_by_schema'].values()), 1578)
        self.reject('catalog', 'indexes', 158)

    def test_table_rls_policy_trigger_counts(self):
        for field, value in [('tables', 425), ('rls_enabled', 408), ('views', 37), ('enum_types', 67), ('policies', 551), ('triggers', 368)]:
            with self.subTest(field=field):
                self.assertEqual(self.evidence['catalog'][field], value)
                self.reject('catalog', field, value - 1)

    def test_view_and_expected_diffs_do_not_prove_full_parity(self):
        self.reject('catalog', 'full_parity_proven_here', True)
        self.reject('catalog', 'complete_per_object_diff_supplied_here', True)
        self.reject('catalog', 'unresolved_view', '')

    def test_twelve_managed_acls_unresolved(self):
        self.reject('catalog', 'omitted_managed_default_acls', 0)
        self.reject('catalog', 'managed_privileges_resolved', True)

    def test_pg_net_mismatch_retained(self):
        self.assertEqual(self.evidence['catalog']['pg_net_branch'], '0.20.4')
        self.assertEqual(self.evidence['catalog']['pg_net_production'], '0.19.5')
        self.reject('catalog', 'pg_net_mismatch_resolved', True)

    def test_16_catalog_gate_not_previous_14_or_15(self):
        self.reject('checks', 'gate_size', 14)
        self.reject('checks', 'gate_size', 15)
        self.reject('checks', 'branch_pass', 15)
        self.reject('checks', 'production_pass', 16)

    def test_catalog_is_not_jwt(self):
        self.reject('checks', 'method', 'signed_JWT')
        self.reject('release_gate', 'signed_jwt_acceptance_pass', True)

    def test_empty_stedi_history_not_production_loss(self):
        value = copy.deepcopy(self.evidence['checks']['stedi'])
        self.assertEqual((value['passed'], value['total'], value['historical_attempts_events_checks_failed']), (4, 6, 2))
        value['production_data_loss_proven'] = True
        self.reject('checks', 'stedi', value)

    def test_cron_empty_and_no_clinical_copy(self):
        self.reject('restore', 'branch_cron_jobs', 1)
        self.reject('restore', 'clinical_rows_copied', True)

    def test_advisor_delta_not_zero_risk_or_auth_settings_proof(self):
        self.assertEqual((self.evidence['advisors']['production_total'], self.evidence['advisors']['branch_total']), (480, 464))
        for field in ['all_findings_resolved', 'branch_auth_settings_prove_production_settings', 'blanket_revocations_authorized']:
            self.reject('advisors', field, True)

    def test_no_prod_provider_credentials_or_deletion(self):
        for field in ['supabase_calls_here', 'branch_deleted_here', 'raw_export_or_credentials_shared', 'real_provider_actions', 'production_released', 'production_authorized']:
            self.reject('release_gate', field, True)

    def test_unknown_private_fields_rejected(self):
        self.reject('branch', 'credentials', 'synthetic-marker')
        changed = copy.deepcopy(self.evidence)
        changed['raw_dump'] = 'synthetic-marker'
        self.assertEqual(gate.validate_receipt(changed), ['receipt_shape'])

    def test_boolean_not_integer_attestation(self):
        self.reject('release_gate', 'source_only', 1)


class SourceAndACLRules(unittest.TestCase):
    def rows(self):
        return [{'label': label, 'acl_result': 'PASS', 'anon_execute': False,
                 'authenticated_execute': label in gate.AUTHENTICATED_APIS, 'service_execute': True}
                for label in gate.ACL_LABELS]

    def test_available_query_and_increment_hashes(self):
        self.assertEqual(gate.source_gate(), [])

    def test_altered_source_hash_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            sql = root / 'supabase/tests/20261018_october_security_rollout_readonly.sql'
            sql.parent.mkdir(parents=True)
            sql.write_bytes(gate.ACL_SQL.read_bytes() + b'\n')
            self.assertIn('october_16_query_source_drift', gate.source_gate(root))
            self.assertIn('postexport_source_cardinality', gate.source_gate(root))

    def test_exact_16_rows_accept_in_any_order(self):
        self.assertTrue(gate.validate_acl_results(list(reversed(self.rows()))))

    def test_missing_or_duplicate_or_unknown_rpc_rejected(self):
        rows = self.rows()
        self.assertFalse(gate.validate_acl_results(rows[:-1]))
        rows[-1] = copy.deepcopy(rows[0])
        self.assertFalse(gate.validate_acl_results(rows))
        rows[-1]['label'] = 'invented_rpc'
        self.assertFalse(gate.validate_acl_results(rows))

    def test_fail_and_role_acl_regressions_rejected(self):
        for key, value in [('acl_result', 'FAIL'), ('anon_execute', True), ('authenticated_execute', True), ('service_execute', False), ('anon_execute', 0)]:
            rows = self.rows()
            rows[0][key] = value
            self.assertFalse(gate.validate_acl_results(rows))

    def test_only_three_intentional_browser_api_exceptions(self):
        rows = self.rows()
        self.assertEqual(sum(row['authenticated_execute'] for row in rows), 3)
        rows[-1]['authenticated_execute'] = False
        self.assertFalse(gate.validate_acl_results(rows))

    def test_result_payload_cannot_include_diagnostics(self):
        rows = self.rows()
        rows[0]['raw_sql'] = 'synthetic-marker'
        self.assertFalse(gate.validate_acl_results(rows))


if __name__ == '__main__':
    unittest.main()
