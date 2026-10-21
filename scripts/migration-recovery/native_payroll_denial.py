"""Stage a hash-bound private forward fix, without publishing function bodies."""
import hashlib
import json
from pathlib import Path
from native_restore import verify_candidate

SOURCE_SHA256 = '94a270c6385aa7102c875ec6f6590bd343afc9bbb804419ecfe2ebd84838650e'
SIGNATURE = 'public.staff_get_payroll_statement_v2(date,date,uuid)'


def stage_denial_fix(stack, candidate):
    verify_candidate(candidate)
    functions = json.loads((Path(candidate) / 'catalog/functions.json').read_text())
    source = next(f['definition'] for f in functions if f['nspname'] == 'public' and f['proname'] == 'staff_get_payroll_statement_v2')
    actual = stack.sql("SELECT pg_get_functiondef('" + SIGNATURE + "'::regprocedure);")
    digest = lambda text: hashlib.sha256(text.rstrip().encode()).hexdigest()
    if hashlib.sha256(source.encode()).hexdigest() != SOURCE_SHA256 or digest(actual) != digest(source):
        raise ValueError('Payroll denial fix preimage changed; no replacement applied')
    old = "raise exception 'STAFF_NOT_FOUND' using errcode='P0002'"
    new = "raise exception 'STAFF_NOT_FOUND' using errcode='42501'"
    if source.count(old) != 1:
        raise ValueError('Expected exactly one payroll denial branch')
    sql = source.replace(old, new)
    ownership = "SELECT jsonb_build_object('owner',proowner::regrole::text,'acl',proacl) FROM pg_proc WHERE oid='" + SIGNATURE + "'::regprocedure;"
    before = stack.sql(ownership)
    folder = stack.root / 'derived-source-private'
    folder.mkdir(mode=0o700, exist_ok=True)
    path = folder / 'payroll_staff_foreign_denial_candidate.sql'
    path.write_text(sql)
    path.chmod(0o600)
    stack.sql(sql)
    if stack.sql(ownership) != before:
        raise ValueError('Payroll ownership or ACL changed unexpectedly')
    stack.report['payroll_denial_candidate'] = dict(status='APPLIED_ONLY_TO_DEVELOPMENT_STACK',
        source_definition_sha256=SOURCE_SHA256, candidate_sql_sha256=hashlib.sha256(sql.encode()).hexdigest(),
        owner_and_acl_unchanged=True, scope='Only STAFF_NOT_FOUND P0002 becomes 42501; private function body remains outside Git')
    stack.save()
