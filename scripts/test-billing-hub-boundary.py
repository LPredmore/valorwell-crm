#!/usr/bin/env python3
"""Exercise the real boundary script in disposable tracked Git repositories."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
GUARD = ROOT / '.github/scripts/check-billing-hub-boundary.sh'
INVENTORIES = [
    'docs/architecture/migration-recovery-evidence/20261020-cross-repo-inventory.json',
    'docs/architecture/migration-recovery-evidence/20261020-ledger-metadata.json',
]


class RepositoryBoundary(unittest.TestCase):
    def check_payload(self, path, payload, expected):
        with tempfile.TemporaryDirectory(prefix='crm-boundary-') as directory:
            root = pathlib.Path(directory)
            subprocess.run(['git', 'init', '-q', directory], check=True)
            config = root / 'supabase/config.toml'
            config.parent.mkdir(parents=True)
            config.write_text('project_id = "ahqauomkgflopxgnlndd"\n')
            guard = root / '.github/scripts/check-billing-hub-boundary.sh'
            guard.parent.mkdir(parents=True)
            guard.write_text(GUARD.read_text())
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(payload)
            subprocess.run(['git', 'add', '.'], cwd=root, check=True)
            result = subprocess.run(['bash', str(guard)], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, expected, result.stdout + result.stderr)

    def test_exact_historical_names_are_allowed(self):
        for inventory in INVENTORIES:
            with self.subTest(inventory=inventory):
                self.check_payload(inventory, '{"name":"therapist' + '_crm_importer"}', 0)

    def test_operating_names_and_new_inventory_remain_denied(self):
        for path in ['src/active.ts', 'docs/active.md', INVENTORIES[0].replace('20261020', '20261021')]:
            for separator in ['_', '-', ' ']:
                with self.subTest(path=path, separator=separator):
                    self.check_payload(path, 'therapist' + separator + 'crm', 1)

    def test_hard_identifiers_and_credentials_still_denied_in_inventories(self):
        payloads = [
            'asjhkidpuhqodry' + 'czuth',
            'YXNqaGtpZHB1aHFv' + 'ZHJ5Y3p1dGg',
            'LEGACY_SUPABASE_' + 'URL',
            'LEGACY_SUPABASE_' + 'ANON_KEY',
            'LEGACY_SUPABASE_' + 'PUBLISHABLE_KEY',
            'valorwell-' + 'backend',
            'therapist-' + 'crm-retirement-import',
            'https://' + 'foreignproject.supabase.co',
            'https://' + 'foreignproject.functions.supabase.co',
        ]
        for inventory in INVENTORIES:
            for payload in payloads:
                with self.subTest(inventory=inventory, payload=payload):
                    self.check_payload(inventory, payload, 1)


if __name__ == '__main__':
    unittest.main()
