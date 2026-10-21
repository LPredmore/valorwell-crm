"""Offline provenance consistency, never authentication of a hosted observation."""
import hashlib
import json
from pathlib import Path
import unittest

from recovery import RELEASE_ORDER, MEMBERSHIP_SHA256, STEDI_VERSION

ROOT = Path(__file__).resolve().parents[2]
RECEIPT = ROOT / 'docs/architecture/migration-recovery-evidence/20261021-independent-verification.json'


class IndependentEvidenceConsistency(unittest.TestCase):
    def setUp(self):
        self.receipt = json.loads(RECEIPT.read_text())

    def test_query_bytes_remain_bound_to_observed_receipt(self):
        for name, expected in self.receipt['query_sha256'].items():
            path = ROOT / 'scripts/migration-recovery' / name
            self.assertEqual(path.parent, ROOT / 'scripts/migration-recovery')
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected)

    def test_exact_order_and_available_source_bytes_remain_bound(self):
        rows = self.receipt['release_sources']
        self.assertEqual([r['version'] for r in rows], [STEDI_VERSION]+[v for _, v in RELEASE_ORDER])
        for row in rows:
            self.assertIs(row['recorded_branch_bytes_match'], True)
            if row['repository'] == 'crm':
                data = (ROOT / row['path']).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), row['sha256'])
                self.assertEqual(hashlib.md5(data).hexdigest(), row['body_md5'])
                self.assertEqual(len(data), row['bytes'])
            elif row['repository'] == 'crm-draft193':
                self.assertEqual(row['sha256'], MEMBERSHIP_SHA256)

    def test_receipt_cannot_upgrade_blocked_acceptance(self):
        for key in ['historical_replay_success', 'full_signed_acceptance_executed',
                    'provider_acceptance_executed', 'production_mutated']:
            self.assertIs(self.receipt[key], False)
        self.assertEqual(self.receipt['control_plane_status'], 'MIGRATIONS_FAILED')
        self.assertEqual(self.receipt['production_project'], 'ahqauomkgflopxgnlndd')
        self.assertEqual(self.receipt['test_project'], 'dskqovrvogmwrlmxsdjd')
        self.assertEqual(self.receipt['test_ledger_count_before'], 25)
        self.assertEqual(self.receipt['test_ledger_count_after'], 28)
        self.assertEqual(self.receipt['production_ledger_count'], 966)

    def test_failed_retention_assertions_and_missing_managed_policies_are_retained(self):
        rows = self.receipt['stedi_postdeploy']
        self.assertEqual(sum(r['verdict']=='PASS' for r in rows), 4)
        self.assertEqual(sum(r['verdict']=='FAIL' for r in rows), 2)
        missing = self.receipt['postrepair_raw_diff']['missing']
        policies = [x for x in missing if x['kind']=='policy']
        self.assertEqual(len(policies), 19)
        self.assertTrue(all(x['identity'].startswith('storage.objects.') for x in policies))

    def test_no_executable_schema_is_embedded_in_published_receipt(self):
        serialized = json.dumps(self.receipt).lower()
        for forbidden in ['create or replace function', 'create trigger ', 'api_key',
                          'jwt_secret', 'service_role_key', 'postgresql://']:
            self.assertNotIn(forbidden, serialized)


if __name__ == '__main__':
    unittest.main()
