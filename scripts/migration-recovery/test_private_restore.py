"""Synthetic metadata/source tests only. Never private export or Docker acceptance."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import private_restore as private
from recovery import baseline_gate, digest, evidence_digest


class PrivateRestoreRules(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old = [dict(version=f'202601{i:08d}') for i in range(965)]
        self.latest = self.old + [dict(version='20261020214527')]
        self.increment = dict(version='20261020214527', sha256=private.CONTACT_SHA256, bytes=4771, human_reviewed=True)
        self.manifest = dict(superseded_versions=private.ledger_versions(self.old),
                             cutover_version=private.ledger_versions(self.old)[-1],
                             latest_ledger_sha256=evidence_digest(self.latest))

    def test_reported_export_hash_and_size_are_exact(self):
        self.assertEqual(private.EXPORT_SHA256, '4da55b28809507eaa9438a0cb27a7f4335a884ea92dea87551890c0e6ef8230f')
        self.assertEqual(private.EXPORT_BYTES, 5442397)

    def test_reported_extension_versions_are_not_substitutable(self):
        self.assertEqual(private.EXTENSIONS, {'pg_cron':'1.6.4','pg_net':'0.19.5','pg_stat_statements':'1.11',
                         'pgcrypto':'1.3','supabase_vault':'0.3.1','uuid-ossp':'1.1','plpgsql':'1.0'})

    def test_reported_schema_counts_are_exact(self):
        self.assertEqual(private.COUNTS['public'], dict(tables=361, functions=794, views=33, policies=550, triggers=353))
        self.assertEqual(private.COUNTS['private'], dict(tables=51, functions=307, views=4, policies=1, triggers=13))
        self.assertEqual(private.COUNTS['credentialing'], dict(tables=13, functions=21, triggers=2))

    def test_actual_restored_rls_counts_cannot_be_manifest_assertions_only(self):
        actual=dict(counts=private.COUNTS,rls_enabled_tables=408,security_definer_count=924)
        private.validate_export_counts(actual)
        with self.assertRaisesRegex(ValueError,'RLS'):
            private.validate_export_counts(dict(actual,rls_enabled_tables=407))

    def test_actual_restored_security_definer_count_required(self):
        with self.assertRaisesRegex(ValueError,'SECURITY DEFINER'):
            private.validate_export_counts(dict(counts=private.COUNTS,rls_enabled_tables=408,security_definer_count=923))

    def test_actual_restored_table_count_required(self):
        counts=json.loads(json.dumps(private.COUNTS));counts['public']['tables']=360
        with self.assertRaisesRegex(ValueError,'schema counts'):
            private.validate_export_counts(dict(counts=counts,rls_enabled_tables=408,security_definer_count=924))

    def test_exact_post_export_delta_passes_without_ledger_writes(self):
        before = json.dumps(self.latest)
        private.boundary_gate(self.manifest, self.old, self.latest, [self.increment])
        self.assertEqual(json.dumps(self.latest), before)

    def test_latest_ledger_966_required(self):
        with self.assertRaisesRegex(ValueError, '966'):
            private.boundary_gate(self.manifest, self.old, self.latest[:-1], [])

    def test_unknown_baseline_boundary_cannot_use_latest_ledger(self):
        with self.assertRaisesRegex(ValueError, 'baseline-time'):
            private.boundary_gate(self.manifest, self.latest, self.latest, [self.increment])

    def test_missing_increment_blocks(self):
        with self.assertRaisesRegex(ValueError, 'exactly cover'):
            private.boundary_gate(self.manifest, self.old, self.latest, [])

    def test_historical_replay_blocks(self):
        with self.assertRaisesRegex(ValueError, 'historical replay'):
            private.boundary_gate(self.manifest, self.old, self.latest, [dict(self.increment,version=self.old[0]['version']),self.increment])

    def test_increment_hash_and_size_required(self):
        for row in [dict(self.increment,sha256='0'*64),dict(self.increment,bytes=4770)]:
            with self.subTest(row=row), self.assertRaisesRegex(ValueError, '4771-byte'):
                private.boundary_gate(self.manifest, self.old, self.latest, [row])

    def test_increment_human_review_required(self):
        with self.assertRaisesRegex(ValueError, 'human review'):
            private.boundary_gate(self.manifest,self.old,self.latest,[dict(self.increment,human_reviewed=False)])

    def test_latest_ledger_hash_is_bound(self):
        with self.assertRaisesRegex(ValueError, 'ledger hash'):
            private.boundary_gate(dict(self.manifest,latest_ledger_sha256='0'*64),self.old,self.latest,[self.increment])

    def test_duplicate_ledger_rejected(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            private.ledger_versions([self.old[0],self.old[0]])

    def test_catalog_rejects_raw_function_bodies(self):
        with self.assertRaisesRegex(ValueError,'only kind'):
            private.validate_catalog([dict(kind='function',identity='rpc()',fingerprint='a'*32,body='PRIVATE')])

    def test_catalog_duplicate_identity_rejected(self):
        row=dict(kind='function',identity='rpc()',fingerprint='a'*32)
        with self.assertRaisesRegex(ValueError,'Duplicate'):
            private.validate_catalog([row,row])

    def test_catalog_valid_fingerprint(self):
        private.validate_catalog([dict(kind='function',identity='rpc()',fingerprint='a'*32)])

    def container(self):
        return dict(Name='/supabase_db_fixture',HostConfig=dict(LogConfig=dict(Type='none')),
                    NetworkSettings=dict(Networks={'fixture-internal':{}},Ports={'5432/tcp':[dict(HostIp='127.0.0.1')]}))

    def test_owned_loopback_internal_no_logging_gate(self):
        private.owned_container_gate([self.container()],'fixture','fixture-internal')

    def test_owned_external_network_rejected(self):
        item=self.container();item['NetworkSettings']['Networks']['bridge']={}
        with self.assertRaisesRegex(ValueError,'network'):
            private.owned_container_gate([item],'fixture','fixture-internal')

    def test_owned_external_ports_rejected(self):
        item=self.container();item['NetworkSettings']['Ports']['5432/tcp'][0]['HostIp']='0.0.0.0'
        with self.assertRaisesRegex(ValueError,'non-loopback'):
            private.owned_container_gate([item],'fixture','fixture-internal')

    def test_owned_logging_rejected(self):
        item=self.container();item['HostConfig']['LogConfig']['Type']='json-file'
        with self.assertRaisesRegex(ValueError,'logging'):
            private.owned_container_gate([item],'fixture','fixture-internal')

    def test_unowned_containers_ignored_but_owned_database_required(self):
        item=self.container();item['Name']='/supabase_db_other'
        with self.assertRaisesRegex(ValueError,'missing'):
            private.owned_container_gate([item],'fixture','fixture-internal')

    def test_partial_start_cleanup_attempts_both_after_any_exception(self):
        calls=[]
        def run(command):
            calls.append(command)
            raise OSError('PRIVATE_CANARY_CLEANUP')
        blockers=private.cleanup_owned(run,self.root,'fixture-internal',True,True)
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[0][0:2],['supabase','stop'])
        self.assertEqual(calls[1],['docker','network','rm','fixture-internal'])
        self.assertNotIn('PRIVATE_CANARY_CLEANUP',json.dumps(blockers))
        self.assertEqual(len(blockers),2)

    def test_cleanup_never_stops_unstarted_stack(self):
        calls=[]
        self.assertEqual(private.cleanup_owned(calls.append,self.root,'fixture-internal',False,True),[])
        self.assertEqual(calls,[['docker','network','rm','fixture-internal']])

    def test_repository_inputs_rejected(self):
        p=self.root/'input.sql';p.write_text('-- synthetic');p.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'outside'):
            private.private_path(p,self.root)

    @unittest.skipUnless(os.name=='posix','POSIX permissions')
    def test_world_readable_input_rejected(self):
        p=self.root/'input.sql';p.write_text('-- synthetic');p.chmod(0o644)
        with self.assertRaisesRegex(ValueError,'owner-only'):
            private.private_path(p,self.root/'repo')

    @unittest.skipUnless(os.name=='posix','POSIX symlinks')
    def test_symlink_input_rejected(self):
        p=self.root/'input.sql';p.write_text('-- synthetic');p.chmod(0o600)
        link=self.root/'linked.sql';link.symlink_to(p)
        with self.assertRaisesRegex(ValueError,'symlinks'):
            private.private_path(link,self.root/'repo')

    def test_human_and_managed_review_are_not_bypassed(self):
        p=self.root/'input.sql';p.write_text('-- synthetic')
        blockers=baseline_gate({},p,self.old,dict(missing=[],extra=[],changed=[]))
        self.assertIn('human secret review missing',blockers)
        self.assertIn('managed_dependencies_reviewed missing',blockers)

    def test_string_false_cannot_fake_human_review(self):
        p=self.root/'input.sql';p.write_text('-- synthetic')
        blockers=baseline_gate(dict(human_secret_reviewed='false',managed_dependencies_reviewed='false'),
                               p,self.old,dict(missing=[],extra=[],changed=[]))
        self.assertIn('human secret review missing',blockers)
        self.assertIn('managed_dependencies_reviewed missing',blockers)

    def test_operator_failure_does_not_echo_private_json(self):
        p=self.root/'reviewed-cutover.json';p.write_text('{"PRIVATE_CANARY_1": broken}')
        p.chmod(0o600)
        result=subprocess.run([sys.executable,str(Path(__file__).with_name('private-local-restore.py')),
                               '--private-root',str(self.root)],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertNotIn('PRIVATE_CANARY_1',result.stdout+result.stderr)
        self.assertNotIn('Traceback',result.stderr)

    def test_bundle_synthetic_end_to_end_source_check(self):
        # Patch only known export hash/size to use a tiny synthetic DDL fixture.
        # This does not claim actual export validation or Supabase restore.
        repository=Path(__file__).resolve().parents[2]
        baseline=b'-- synthetic schema only\n';managed=b'-- synthetic review only\n'
        catalog=[dict(kind='function',identity='public.fixture()',fingerprint='a'*32)]
        parity=dict(missing=[],extra=[],changed=[])
        receipt=dict(reviewer='synthetic reviewer',reviewed_at='2026-10-21',schema_sha256=digest(baseline))
        increment_bytes=b'-- synthetic increment\n'
        manifest=dict(self.manifest, strategy='current-schema-cutover',schema_sha256=digest(baseline),
            ledger_sha256=evidence_digest(self.old),human_secret_reviewed=True,managed_dependencies_reviewed=True,
            owners_and_grants_reviewed=True,storage_auth_integration_reviewed=True,baseline_file='baseline.sql',
            baseline_ledger_file='old.json',latest_ledger_file='latest.json',parity_file='parity.json',
            reviewed_parity_sha256=evidence_digest(parity),human_review_receipt_file='review.json',
            source_catalog_file='catalog.json',source_catalog_sha256=evidence_digest(catalog),
            reported_counts=private.COUNTS,rls_enabled_tables=408,security_definer_count=924,
            required_extensions=private.EXTENSIONS,supabase_cli_version='2.58.5',
            supabase_database_image='synthetic-never-run',postgres_version='17.6',managed_dependencies_file='managed.sql',
            managed_dependencies_sha256=digest(managed),incremental_sources=[dict(self.increment,file='increment.sql',
                sha256=digest(increment_bytes),bytes=len(increment_bytes))])
        for key in ['human_secret_reviewed','managed_dependencies_reviewed','owners_and_grants_reviewed',
                    'storage_auth_integration_reviewed','ledger_sha256','latest_ledger_sha256',
                    'source_catalog_sha256','managed_dependencies_sha256']:
            receipt[key]=manifest[key]
        manifest['human_review_receipt_sha256']=digest(json.dumps(receipt).encode())
        for key,file in [('catalog_query_sha256','catalog-fingerprints.sql'),('counts_query_sha256','export-counts.sql')]:
            manifest[key]=digest(Path(__file__).with_name(file).read_bytes())
        manifest['acl_query_sha256']=digest((repository/'docs/architecture/2026-10-19-security-acl-acceptance.sql').read_bytes())
        for name,value in [('reviewed-cutover.json',manifest),('old.json',self.old),('latest.json',self.latest),
                           ('parity.json',parity),('review.json',receipt),('catalog.json',catalog)]:
            p=self.root/name;p.write_text(json.dumps(value));p.chmod(0o600)
        for name,value in [('baseline.sql',baseline),('managed.sql',managed),('increment.sql',increment_bytes)]:
            p=self.root/name;p.write_bytes(value);p.chmod(0o600)
        with patch.object(private,'EXPORT_SHA256',digest(baseline)),patch.object(private,'EXPORT_BYTES',len(baseline)),\
             patch.object(private,'boundary_gate') as boundary:
            bundle=private.load_private_bundle(self.root,repository)
            boundary.assert_called_once()
            self.assertEqual(bundle['baseline'],self.root/'baseline.sql')
            self.assertEqual(bundle['increments'][0]['path'],str(self.root/'increment.sql'))
            # Parity hash binding cannot be bypassed even with valid empty arrays.
            manifest['reviewed_parity_sha256']='0'*64
            (self.root/'reviewed-cutover.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'parity hash'):
                private.load_private_bundle(self.root,repository)


if __name__=='__main__':
    unittest.main()