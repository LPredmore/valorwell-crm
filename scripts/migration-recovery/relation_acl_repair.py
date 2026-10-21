"""Render a branch-only, exact-preimage ACL repair from sanitized catalog captures.

Offline only: no connection, credentials, function bodies, or production SQL runner.
Never put the generated repair in the shared production migration directory.
"""
import argparse
import json
import re
from pathlib import Path

TEST_PROJECT = 'dskqovrvogmwrlmxsdjd'
PRIVILEGES = dict(a='INSERT', r='SELECT', w='UPDATE', d='DELETE', D='TRUNCATE',
                  x='REFERENCES', t='TRIGGER', m='MAINTAIN')


def indexed(rows):
    result = {}
    for row in rows:
        if set(row) != {'identity', 'kind', 'owner', 'acl'}:
            raise ValueError('Unexpected catalog shape')
        identity = row['identity']
        if not re.fullmatch(r'(public|private|credentialing)\.[a-z_][a-z_0-9]*', identity):
            raise ValueError('Unreviewed relation identity')
        if row['kind'] not in ('r', 'p', 'v', 'm') or row['owner'] != 'postgres':
            raise ValueError('Unreviewed owner or relation kind')
        if identity in result:
            raise ValueError('Duplicate relation')
        acl = {}
        for item in row['acl']:
            match = re.fullmatch(r'(postgres|anon|authenticated|service_role)=([arwdDxtm]+)/postgres', item)
            if not match or match[1] in acl or len(set(match[2])) != len(match[2]):
                raise ValueError('Unreviewed ACL, grantor or grant option')
            acl[match[1]] = set(match[2])
        result[identity] = (row, acl)
    return result


def render(production, branch, project):
    if project != TEST_PROJECT:
        raise ValueError('Only the authorized recovery branch may be targeted')
    source, target = indexed(production), indexed(branch)
    if source.keys() != target.keys():
        raise ValueError('Relation coverage differs')
    changes, operations = [], []
    for identity in sorted(source):
        desired, desired_acl = source[identity]
        actual, actual_acl = target[identity]
        if desired['kind'] != actual['kind']:
            raise ValueError('Relation kind differs')
        if sorted(desired['acl']) == sorted(actual['acl']):
            continue
        changes.append(dict(identity=identity, before=sorted(actual['acl']), after=sorted(desired['acl'])))
        for role in sorted(desired_acl.keys() | actual_acl.keys()):
            # An absent owner ACL is PostgreSQL's implicit default, not lost access.
            before = actual_acl.get(role, set(PRIVILEGES) if role == 'postgres' and not actual_acl else set())
            after = desired_acl.get(role, set())
            for mode, letters in [('REVOKE', before-after), ('GRANT', after-before)]:
                if letters:
                    privileges = ', '.join(PRIVILEGES[c] for c in sorted(letters))
                    operations.append(f'{mode} {privileges} ON TABLE {identity} {"FROM" if mode == "REVOKE" else "TO"} {role};')
        # Materialize source's explicit owner entry when target used default ACLs.
        if not actual['acl'] and desired['acl'] == ['postgres=arwdDxtm/postgres']:
            operations.append(f'GRANT ALL PRIVILEGES ON TABLE {identity} TO postgres;')
    payload = json.dumps(changes, sort_keys=True, separators=(',', ':'))
    check = """
  FOR item IN SELECT value FROM jsonb_array_elements(manifest) LOOP
    relation := to_regclass(item->>'identity');
    IF relation IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid=relation AND relowner='postgres'::regrole
    ) THEN RAISE EXCEPTION 'Recovery ACL identity/owner mismatch'; END IF;
    SELECT coalesce(jsonb_agg(v::text ORDER BY v::text),'[]'::jsonb)
      INTO observed FROM pg_class c LEFT JOIN LATERAL unnest(c.relacl) v ON true
      WHERE c.oid=relation AND v IS NOT NULL;
    IF observed <> item->'PHASE' THEN
      RAISE EXCEPTION 'Recovery ACL PHASE mismatch on %', item->>'identity';
    END IF;
  END LOOP;
"""
    # One DO block makes a failed preimage/postimage check atomic, even under a
    # caller using autocommit. No application rows or functions are touched.
    return (f'-- BRANCH ONLY: {TEST_PROJECT}; never apply to production.\n'
            '-- Restore captured relation grants; preserve reviewed function migrations.\n'
            'DO $acl_recovery$\nDECLARE item jsonb; relation regclass; observed jsonb;\n'
            f"  manifest jsonb := '{payload}'::jsonb;\nBEGIN\n"
            "  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Expected captured grantor postgres'; END IF;\n"
            +check.replace('PHASE', 'before')+'\n  '+'\n  '.join(operations)+'\n'
            +check.replace('PHASE', 'after')+'END $acl_recovery$;\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--production-capture', type=Path, required=True)
    parser.add_argument('--branch-capture', type=Path, required=True)
    parser.add_argument('--target-project', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # Capture files contain only relation identity/kind/owner/ACL, never SQL.
    sql = render(json.loads(args.production_capture.read_text()),
                 json.loads(args.branch_capture.read_text()), args.target_project)
    with args.output.open('x') as output:
        output.write(sql)


if __name__ == '__main__':
    main()
