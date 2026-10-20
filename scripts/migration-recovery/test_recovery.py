import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('recovery', Path(__file__).with_name('recovery.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class RecoveryRules(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def repo(self, name, version, body):
        root = self.root / name
        folder = root / 'supabase/migrations'
        folder.mkdir(parents=True, exist_ok=True)
        (folder/f'{version}_test.sql').write_bytes(body)
        return root

    def test_same_version_different_bytes_blocks(self):
        a=self.repo('a','20261019000310',b'SELECT 1;\n')
        b=self.repo('b','20261019000310',b'SELECT 2;\n')
        self.assertEqual([r['version'] for r in recovery.inventory({'a':a,'b':b})['collisions']],['20261019000310'])

    def test_identical_duplicates_preserve_both_sources(self):
        a=self.repo('a','20261019000310',b'SELECT 1;\n')
        b=self.repo('b','20261019000310',b'SELECT 1;\n')
        result=recovery.inventory({'a':a,'b':b})
        self.assertEqual(result['identical_duplicates'],['20261019000310'])
        self.assertEqual(result['source_files'],2)
        self.assertEqual(result['collisions'],[])

    def test_membership_is_immediately_after_00310(self):
        versions=[v for _,v in recovery.RELEASE_ORDER]
        self.assertEqual(versions[versions.index('20261019000310')+1],'20261019165842')
        self.assertEqual(len(versions),10)

    def test_stedi_and_already_applied_stripe_are_not_pending_ten(self):
        versions=[v for _,v in recovery.RELEASE_ORDER]
        self.assertNotIn('20261018235900',versions)
        self.assertNotIn('20261019000100',versions)
        self.assertEqual(recovery.STRIPE_APPLIED_VERSION,'20261019232604')

    def test_missing_draft_cannot_silently_skip(self):
        with self.assertRaisesRegex(ValueError,'Expected exactly one reviewed'):
            recovery.release_sources({})

    def test_reviewed_membership_rejects_changed_bytes(self):
        p=self.root/'correction.sql';p.write_text('select 1;')
        with self.assertRaisesRegex(ValueError,'unchanged reviewed'):
            recovery.reviewed_membership(p)

    def test_all_eight_bodyless_versions_keep_unproved_status(self):
        ledger=[dict(version=v,statement_count=None,body_md5='') for v in recovery.BODYLESS_VERSIONS]
        result=recovery.inventory({},ledger)
        self.assertEqual(len(result['bodyless_candidates']),8)
        self.assertTrue(all(r['status']=='BODYLESS_CANDIDATE_NOT_APPLIED_BYTE_PROOF' for r in result['ledger_mapping']))

    def test_secret_scan_reports_category_not_value(self):
        p=self.root/'schema.sql';p.write_text('postgresql://operator:do-not-print@host/db')
        result=recovery.review_baseline(p)
        self.assertEqual(result['scan_findings'],['credential_uri'])
        self.assertNotIn('do-not-print',json.dumps(result))

    def test_data_copy_is_rejected(self):
        p=self.root/'schema.sql';p.write_text('COPY public.clients (id) FROM stdin;\n')
        self.assertEqual(recovery.review_baseline(p)['scan_findings'],['data_copy'])

    def test_parity_detects_acl_changes_and_missing_objects(self):
        a=[dict(kind='function',identity='rpc()',fingerprint='before'),dict(kind='table',identity='clients',fingerprint='x')]
        b=[dict(kind='function',identity='rpc()',fingerprint='after')]
        self.assertEqual(recovery.compare_catalogs(a,b),dict(missing=[['table','clients']],extra=[],changed=[['function','rpc()']]))

    def test_partial_history_coverage_blocks_cutover(self):
        p=self.root/'schema.sql';p.write_text('-- schema-only\n')
        manifest=dict(strategy='current-schema-cutover',schema_sha256=recovery.digest(p.read_bytes()),
                      human_secret_reviewed=True,cutover_version='20261019232604',
                      superseded_versions=['20261019232604'],managed_dependencies_reviewed=True,
                      owners_and_grants_reviewed=True,storage_auth_integration_reviewed=True)
        ledger=[dict(version='20251201181524'),dict(version='20261019232604')]
        self.assertIn('exact historical-version coverage missing',recovery.baseline_gate(manifest,p,ledger,dict(missing=[],extra=[],changed=[])))

    def test_catalog_parity_does_not_bypass_human_review(self):
        p=self.root/'schema.sql';p.write_text('-- schema-only\n')
        blockers=recovery.baseline_gate({},p,[dict(version='20261019232604')],dict(missing=[],extra=[],changed=[]))
        self.assertIn('human secret review missing',blockers)


if __name__ == '__main__':
    unittest.main()