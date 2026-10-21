"""Synthetic metadata regressions; no branch, secrets, SQL, or network needed."""
import contextlib
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import branch_receipt as receipt


class BranchReceiptRules(unittest.TestCase):
    def setUp(self):
        self.evidence = receipt.load_receipt(receipt.RECEIPT)

    def reject(self, section, field, value):
        changed = copy.deepcopy(self.evidence)
        changed[section][field] = value
        self.assertIn(section, receipt.validate_receipt(changed))

    def test_checked_in_sanitized_receipt_validates(self):
        self.assertEqual(receipt.validate_receipt(self.evidence), [])

    def test_operator_report_cannot_become_independent_observation(self):
        changed = copy.deepcopy(self.evidence)
        changed['provenance'] = 'independently_verified'
        self.assertIn('provenance', receipt.validate_receipt(changed))

    def test_exact_private_export_hash_and_size(self):
        self.assertEqual(self.evidence['reconstruction']['schema_bytes'], 5442397)
        self.assertEqual(self.evidence['reconstruction']['schema_sha256'],
                         '4da55b28809507eaa9438a0cb27a7f4335a884ea92dea87551890c0e6ef8230f')
        self.reject('reconstruction', 'schema_sha256', '0' * 64)
        self.reject('reconstruction', 'schema_bytes', 5442396)

    def test_native_failure_does_not_become_966_step_success(self):
        self.reject('native_replay', 'applied_migrations', 966)
        self.reject('native_replay', 'application_tables', 425)
        self.reject('native_replay', 'restored_966_step_replay', True)

    def test_exact_12_reconstruction_batches(self):
        self.reject('reconstruction', 'ordered_branch_only_batches', 11)

    def test_branch_24_ledger_never_impersonates_production_966(self):
        self.assertEqual(self.evidence['reconstruction']['branch_ledger_versions'], 24)
        self.assertEqual(self.evidence['reconstruction']['production_historical_ledger_versions'], 966)
        self.reject('reconstruction', 'branch_ledger_versions', 966)
        self.reject('reconstruction', 'historical_ledger_fabricated', True)

    def test_exact_restored_schema_counts(self):
        expected = dict(base_tables=425, functions=1122, views=37, policies=551,
                        noninternal_triggers=368, enum_types=67)
        self.assertEqual(self.evidence['reconstruction']['counts'], expected)
        for field in expected:
            with self.subTest(field=field):
                changed = dict(expected)
                changed[field] += 1
                self.reject('reconstruction', 'counts', changed)

    def test_twelve_omitted_managed_acls_remain_drift(self):
        self.reject('reconstruction', 'omitted_default_acl_statements', 0)
        self.reject('reconstruction', 'omitted_acl_owner', 'postgres')

    def test_exact_parity_comparison_counts(self):
        for field, value in [('column_definitions_md5_matches', 6188), ('rls_policy_matches', 551),
                             ('index_matches', 1578), ('table_constraint_matches', 2399)]:
            with self.subTest(field=field):
                self.assertEqual(self.evidence['parity'][field], value)
                self.reject('parity', field, value - 1)

    def test_view_aliasing_is_hypothesis_not_resolved_parity(self):
        drift = copy.deepcopy(self.evidence['parity']['view_difference'])
        drift['review_resolved'] = True
        self.reject('parity', 'view_difference', drift)
        self.reject('parity', 'full_object_parity_proven', True)

    def test_pg_net_version_and_schema_drift_preserved(self):
        self.assertEqual(self.evidence['parity']['pg_net'], dict(branch_version='0.20.4', branch_schema='extensions',
                         production_version='0.19.5', production_schema='public', review_resolved=False))
        drift = copy.deepcopy(self.evidence['parity']['pg_net'])
        drift['branch_version'] = '0.19.5'
        self.reject('parity', 'pg_net', drift)

    def test_membership_correction_immediately_after_00310_not_timestamp_sorted(self):
        versions = self.evidence['branch_application']['ordered_security_claims_versions']
        self.assertEqual(len(versions), 10)
        self.assertEqual(versions[versions.index('20261019000310') + 1], '20261019165842')
        self.reject('branch_application', 'ordered_security_claims_versions', sorted(versions))

    def test_no_duplicate_stripe_or_unrelated_stedi(self):
        self.assertEqual(self.evidence['branch_application']['already_applied_production_stripe_version'], '20261019232604')
        self.reject('branch_application', 'stripe_reapplied', True)
        self.reject('branch_application', 'stedi_retirement_applied', True)

    def test_post_snapshot_increment_not_omitted(self):
        self.assertEqual(self.evidence['branch_application']['post_snapshot_version'], '20261020214527')
        self.reject('branch_application', 'post_snapshot_version', '')

    def test_targeted_15_rpc_acl_counts_not_old_14_gate(self):
        for field, value in [('targeted_security_definer_count', 15), ('anon_blocked', 15),
                             ('service_role_allowed', 15), ('authenticated_blocked', 14)]:
            with self.subTest(field=field):
                self.assertEqual(self.evidence['security_checks'][field], value)
                self.reject('security_checks', field, value - 1)
        self.reject('security_checks', 'authenticated_read_only_exception', 'all_functions')
        self.reject('security_checks', 'targeted_signatures_supplied', True)

    def test_profile_id_contract_and_operator_guard_retained(self):
        self.reject('security_checks', 'membership_column', 'tenant_memberships.user_id')
        self.reject('security_checks', 'authorized_operator_guard_retained', False)

    def test_three_enabled_claim_submission_protection_triggers(self):
        self.reject('security_checks', 'claim_status_protection_triggers_attached_enabled', 2)

    def test_anon_runtime_contexts_remain_fail_closed(self):
        self.reject('security_checks', 'anon_billing_identity_context', 'tenant')
        self.reject('security_checks', 'anon_crm_operating_context', 'crm_staff')
        self.reject('security_checks', 'anon_crm_capabilities', 1)

    def test_missing_membership_returns_42501(self):
        self.assertEqual(self.evidence['security_checks']['authenticated_campaign_without_membership_sqlstate'], '42501')
        self.reject('security_checks', 'authenticated_campaign_without_membership_sqlstate', '00000')

    def test_set_role_is_not_signed_jwt_postgrest(self):
        self.reject('security_checks', 'runtime_method', 'signed_JWT_PostgREST')
        self.reject('acceptance', 'independent_signed_jwt_postgrest_cross_tenant', True)

    def test_no_imported_tenant_client_claim_or_auth_data(self):
        for field in ['tenants', 'clients', 'claims', 'auth_users']:
            with self.subTest(field=field):
                data = copy.deepcopy(self.evidence['reconstruction']['data_imported'])
                data[field] = True
                self.reject('reconstruction', 'data_imported', data)

    def test_advisor_counts_not_proven_breach_or_closed_review(self):
        self.assertEqual(self.evidence['advisor']['anon_executable_security_definer_flagged'], 15)
        self.assertEqual(self.evidence['advisor']['authenticated_executable_security_definer_flagged'], 306)
        self.reject('advisor', 'new_breach_proven', True)
        self.reject('advisor', 'further_review_required', False)

    def test_failed_branch_no_rebase_reset_merge(self):
        self.reject('branch', 'control_plane_status', 'ACTIVE')
        self.reject('branch', 'rebase_reset_merge_allowed', True)

    def test_exact_authorized_branch_identity_and_price(self):
        self.assertEqual(self.evidence['branch']['project_ref'], 'dskqovrvogmwrlmxsdjd')
        self.assertEqual(self.evidence['branch']['hourly_usd'], '0.01344')
        self.reject('branch', 'project_ref', 'ahqauomkgflopxgnlndd')

    def test_no_provider_edge_or_production_acceptance(self):
        for field in ['real_stripe_workflow', 'real_claim_md_workflow', 'real_edge_workflow',
                      'production_deployed', 'production_release_authorized', 'source_follow_up_supabase_calls',
                      'private_sql_shared_with_lovable_or_github']:
            with self.subTest(field=field):
                self.reject('acceptance', field, True)

    def test_unknown_fields_cannot_persist_sql_secrets_or_phi(self):
        changed = copy.deepcopy(self.evidence)
        changed['raw_sql'] = 'synthetic-private-marker'
        self.assertEqual(receipt.validate_receipt(changed), ['receipt_shape'])
        self.reject('branch', 'raw_diagnostics', 'synthetic-private-marker')

    def test_boolean_attestations_require_exact_type(self):
        self.reject('branch', 'authorized_by_operator', 1)
        self.reject('acceptance', 'production_deployed', 'false')
        self.reject('reconstruction', 'branch_ledger_versions', 24.0)

    def test_cli_invalid_input_never_echoes_diagnostics(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'receipt.json'
            path.write_text('{"private": "synthetic-private-marker", INVALID}')
            output = io.StringIO()
            with patch.object(sys, 'argv', ['branch_receipt.py', '--receipt', str(path)]), contextlib.redirect_stdout(output):
                self.assertEqual(receipt.main(), 2)
            self.assertNotIn('synthetic-private-marker', output.getvalue())
            self.assertNotIn(str(path), output.getvalue())

    def test_duplicate_keys_rejected_not_silently_overwritten(self):
        with self.assertRaises(ValueError):
            json.loads('{"format_version": 0, "format_version": 1}', object_pairs_hook=receipt.unique_object)

    def test_missing_evidence_rejected(self):
        changed = copy.deepcopy(self.evidence)
        del changed['parity']
        self.assertEqual(receipt.validate_receipt(changed), ['receipt_shape'])


if __name__ == '__main__':
    unittest.main()