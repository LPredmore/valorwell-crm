"""Safety regressions for private captures and owned native runtime boundaries."""
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from catalog_candidate import capture_sql, load_captures, application_subset, read_queries
from native_stack import assert_owned, LABEL
from native_restore import restore_candidate


class CaptureSafety(unittest.TestCase):
    def test_unknown_application_namespace_cannot_be_silently_omitted(self):
        with self.assertRaisesRegex(ValueError, 'Unclassified source schema'):
            application_subset({'schemas': [{'nspname': 'new_application_module'}]})

    def test_postgres_int64_sequence_values_cross_connector_as_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts/schema-baseline').mkdir(parents=True)
            (root / 'scripts/schema-baseline/catalog-queries.json').write_text(json.dumps({
                'sequences': 'SELECT s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache FROM pg_sequence s'}))
            query = read_queries(root)['sequences']
            for field in ['seqstart', 'seqincrement', 'seqmax', 'seqmin', 'seqcache']:
                self.assertIn('s.' + field + '::text AS ' + field, query)

    def test_redaction_occurs_on_server_before_transfer(self):
        query = capture_sql('functions', 'SELECT 1 AS oid')
        self.assertIn('READ ONLY', query)
        self.assertIn('regexp_replace(raw::text', query)
        self.assertIn('source_sha256', query)
        self.assertNotIn('pg_authid', query)
        self.assertIn('REDACTED_JWT', query)
        self.assertIn('REDACTED_CONNECTION', query)

    def test_changed_ledger_blocks_mixed_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, maximum in [('functions', '20260101000000'), ('history', '20260102000000')]:
                (root / (name + '.capture.json')).write_text(json.dumps(dict(category=name, rows=[],
                    captured_at='2026-10-21', ledger_count=1, ledger_max=maximum, ledger_sha256='a'*64)))
            with self.assertRaisesRegex(ValueError, 'Ledger changed'):
                load_captures(root, ['functions', 'history'])

    def test_managed_inventory_is_not_faked_as_application_ddl(self):
        data = {'functions': [dict(nspname='auth'), dict(nspname='public')],
                'policies': [dict(nspname='storage'), dict(nspname='public')],
                'triggers': [dict(nspname='auth', tgname='on_auth_user_created'),
                             dict(nspname='auth', tgname='managed_internal')],
                'publications': [dict(pubname='supabase_realtime'), dict(pubname='managed_realtime')]}
        result = application_subset(data)
        self.assertEqual(result['functions'], [dict(nspname='public')])
        self.assertEqual(len(result['policies']), 2)
        self.assertEqual(len(result['triggers']), 1)
        self.assertEqual(result['publications'], [dict(pubname='supabase_realtime')])

    def test_changed_stage_fails_before_database_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'stages').mkdir()
            (root / 'stages/00.json').write_text('["SELECT 1"]')
            (root / 'candidate-manifest.json').write_text(json.dumps(dict(
                strategy='current-state-development-candidate', release_eligible=False,
                stage_sha256={'00.json': '0'*64})))
            with patch('native_restore.apply_batch') as sql, self.assertRaisesRegex(ValueError, 'changed'):
                restore_candidate(None, root)
            sql.assert_not_called()

    def test_changed_comparison_catalog_fails_before_database_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'stages').mkdir()
            (root / 'catalog').mkdir()
            data = b'["SELECT 1"]'
            (root / 'stages/00.json').write_bytes(data)
            (root / 'catalog/roles.json').write_text('[]')
            (root / 'candidate-manifest.json').write_text(json.dumps(dict(
                strategy='current-state-development-candidate', release_eligible=False,
                stage_sha256={'00.json': hashlib.sha256(data).hexdigest()},
                catalog_sha256={'roles.json': '0'*64})))
            with patch('native_restore.apply_batch') as sql, self.assertRaisesRegex(ValueError, 'catalog changed'):
                restore_candidate(None, root)
            sql.assert_not_called()


class NativeBoundary(unittest.TestCase):
    def item(self):
        return dict(Config=dict(Labels={LABEL: 'vw-native-synthetic'}, Env=['HTTPS_PROXY=']),
                    HostConfig=dict(LogConfig=dict(Type='none'), Privileged=False, ExtraHosts=[]),
                    NetworkSettings=dict(Networks={'synthetic-internal': {}}, Ports={'9999/tcp': [{'HostIp': '127.0.0.1'}]}))

    def test_ownership_blocks_cleanup_of_other_resources(self):
        with self.assertRaisesRegex(ValueError, 'ownership'):
            assert_owned(self.item(), 'vw-native-other')

    def test_rejects_proxy_or_external_network_before_sql(self):
        item = self.item()
        item['Config']['Env'] = ['HTTPS_PROXY=http://synthetic.invalid']
        with self.assertRaisesRegex(ValueError, 'proxy'):
            assert_owned(item, 'vw-native-synthetic', 'synthetic-internal')
        item = self.item()
        item['NetworkSettings']['Networks']['bridge'] = {}
        with self.assertRaisesRegex(ValueError, 'External network'):
            assert_owned(item, 'vw-native-synthetic', 'synthetic-internal')

    def test_rejects_host_ports_and_privileged_containers(self):
        item = self.item()
        item['HostConfig']['Privileged'] = True
        with self.assertRaisesRegex(ValueError, 'privileges'):
            assert_owned(item, 'vw-native-synthetic', 'synthetic-internal')
        item = self.item()
        item['NetworkSettings']['Ports']['9999/tcp'][0]['HostIp'] = '0.0.0.0'
        with self.assertRaisesRegex(ValueError, 'Nonloopback'):
            assert_owned(item, 'vw-native-synthetic', 'synthetic-internal')
