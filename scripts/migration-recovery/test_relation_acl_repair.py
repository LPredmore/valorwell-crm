import copy
import unittest

from relation_acl_repair import render, TEST_PROJECT


class BranchAclRecovery(unittest.TestCase):
    def setUp(self):
        self.source = [dict(identity='public.synthetic', kind='r', owner='postgres',
                            acl=['postgres=arwdDxtm/postgres', 'authenticated=rw/postgres'])]
        self.branch = copy.deepcopy(self.source)
        self.branch[0]['acl'][1] = 'authenticated=rwDxtm/postgres'
        self.branch[0]['acl'].append('anon=Dxtm/postgres')

    def test_restore_only_excess_privileges_preserves_legitimate_access(self):
        sql = render(self.source, self.branch, TEST_PROJECT)
        self.assertIn('REVOKE TRUNCATE, MAINTAIN, TRIGGER, REFERENCES ON TABLE public.synthetic FROM anon;', sql)
        self.assertNotIn('REVOKE SELECT', sql)
        self.assertNotIn('REVOKE UPDATE', sql)
        self.assertNotIn('ON FUNCTION', sql)
        self.assertIn("item->'before'", sql)
        self.assertIn("item->'after'", sql)
        self.assertIn('Recovery ACL identity/owner mismatch', sql)

    def test_reject_production(self):
        with self.assertRaises(ValueError):
            render(self.source, self.branch, 'ahqauomkgflopxgnlndd')

    def test_reject_changed_owner_grantor_options_and_injected_identifiers(self):
        for field, value in [('owner', 'supabase_admin'), ('identity', 'public.x; DROP TABLE x'),
                             ('acl', ['anon=r*/postgres']), ('acl', ['anon=r/other'])]:
            rows = copy.deepcopy(self.branch)
            rows[0][field] = value
            with self.assertRaises(ValueError):
                render(self.source, rows, TEST_PROJECT)

    def test_missing_duplicate_and_different_kind_block(self):
        for rows in [[], self.branch*2, [dict(self.branch[0], kind='v')]]:
            with self.assertRaises(ValueError):
                render(self.source, rows, TEST_PROJECT)

    def test_grant_order_does_not_create_false_repair(self):
        rows = copy.deepcopy(self.source)
        rows[0]['acl'].reverse()
        sql = render(self.source, rows, TEST_PROJECT)
        self.assertNotIn('REVOKE ', sql)
        self.assertNotIn('GRANT ', sql)

    def test_explicit_owner_entry_can_be_reconstituted(self):
        source = [dict(self.source[0], acl=['postgres=arwdDxtm/postgres'])]
        branch = [dict(self.source[0], acl=[])]
        self.assertIn('GRANT ALL PRIVILEGES ON TABLE public.synthetic TO postgres;',
                      render(source, branch, TEST_PROJECT))


if __name__ == '__main__':
    unittest.main()
