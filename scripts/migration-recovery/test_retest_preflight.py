"""Prevent source metadata from being promoted to integration or release evidence."""
import unittest
from unittest.mock import patch
from pathlib import Path
from retest_preflight import DEPENDENCIES, BLOCKERS, build_manifest


class RetestGateSafety(unittest.TestCase):
    def test_every_acceptance_gate_has_an_owner_and_prerequisites(self):
        self.assertEqual(set(DEPENDENCIES), {'source', 'catalog', 'baseline', 'jwt', 'worker', 'stripe', 'claims', 'stedi', 'provider', 'hosted-ui', 'release'})
        self.assertEqual(set(BLOCKERS), set(DEPENDENCIES) - {'source'})
        for gate, dependencies in DEPENDENCIES.items():
            self.assertNotIn(gate, dependencies)
            self.assertTrue(set(dependencies) <= DEPENDENCIES.keys())
        self.assertEqual(set(DEPENDENCIES['release']), set(DEPENDENCIES) - {'release'})

    def test_database_and_provider_acceptance_cannot_bypass_baseline(self):
        def ancestors(gate):
            return set(DEPENDENCIES[gate]).union(*(ancestors(d) for d in DEPENDENCIES[gate]))
        for gate in set(DEPENDENCIES) - {'source', 'baseline'}:
            self.assertIn('baseline', ancestors(gate))

    def test_hash_inventory_never_claims_executed_acceptance(self):
        with patch('retest_preflight.release_sources', return_value=[]), patch(
                'retest_preflight.source_identity', return_value={'sha': 'a'*40, 'dirty': False}):
            result = build_manifest({'crm': Path('/synthetic')})
        self.assertEqual(result['release_decision'], 'NOT_READY')
        self.assertIsNone(result['baseline_sha256'])
        self.assertFalse(result['production_mutated'])
        for gate in result['gates'].values():
            self.assertEqual(gate['status'], 'BLOCKED')
            self.assertEqual(gate['assertion_count'], 0)
            self.assertIsNone(gate['evidence_uri'])
            self.assertIsNone(gate['schema_fingerprint'])
        release = result['proposed_release']
        self.assertIsNone(release['deployment_versions'])
        self.assertIn('20261019000100', release['excluded_alias'])
        self.assertEqual(release['excluded_already_applied'], ['20261019232604', '20261020214527'])

    def test_missing_or_drifting_sql_stops_before_any_git_inspection(self):
        with patch('retest_preflight.release_sources', side_effect=ValueError('missing SQL')), patch(
                'retest_preflight.source_identity') as git:
            with self.assertRaises(ValueError):
                build_manifest({})
            git.assert_not_called()

    def test_receipt_uses_repository_relative_sql_paths(self):
        source = dict(repository='crm', version='20261019000200', sha256='a'*64,
                      path='/synthetic/supabase/migrations/input.sql')
        with patch('retest_preflight.release_sources', return_value=[source]), patch(
                'retest_preflight.source_identity', return_value={'sha': 'a'*40, 'dirty': False}):
            result = build_manifest({'crm': Path('/synthetic')})
        self.assertEqual(result['proposed_release']['reviewed_input_order'][0]['path'],
                         'supabase/migrations/input.sql')
