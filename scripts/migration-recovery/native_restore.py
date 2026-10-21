"""Apply hash-bound, redacted candidate stages only to an owned native development stack."""
import hashlib
import json
import os
from pathlib import Path


def apply_batch(stack, statements):
    # Catch SQLSTATE only. Raw SQL/error strings are never retained or printed.
    # A statement failure rolls back that statement's subtransaction; dependencies
    # may resolve on the next pass without replacing functions with fake versions.
    payload = json.dumps(statements).replace("'", "''")
    command = """SET check_function_bodies=false; SET search_path=public,extensions;
CREATE TEMP TABLE retest_failures(idx integer, state text, catalog_reference text);
DO $retest$ DECLARE item record; diagnostic text; BEGIN
FOR item IN SELECT value AS sql, ordinality-1 AS idx FROM jsonb_array_elements_text('PAYLOAD'::jsonb) WITH ORDINALITY LOOP
  BEGIN EXECUTE item.sql;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS diagnostic = MESSAGE_TEXT;
    INSERT INTO retest_failures VALUES(item.idx, SQLSTATE,
      substring(diagnostic FROM '(?:relation|column|function|type|schema) "([A-Za-z0-9_.]+)"'));
  END;
END LOOP; END $retest$;
SELECT coalesce(jsonb_agg(jsonb_build_object('index',idx,'sqlstate',state,'catalog_reference',catalog_reference) ORDER BY idx),'[]'::jsonb) FROM retest_failures;
""".replace('PAYLOAD', payload)
    delimiter = '$retest_' + hashlib.sha256(payload.encode()).hexdigest()[:24] + '$'
    while delimiter in payload:
        delimiter = delimiter[:-1] + 'x$'
    command = command.replace('$retest$', delimiter)
    return json.loads(stack.sql(command).splitlines()[-1])


def verify_candidate(root):
    root = Path(root).resolve(strict=True)
    if root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077 or any(
            (p / '.git').exists() for p in [root, *root.parents]):
        raise ValueError('Owner-only candidate outside source required')
    manifest = json.loads((root / 'candidate-manifest.json').read_text())
    if manifest.get('strategy') != 'current-state-development-candidate' or manifest.get('release_eligible') is not False:
        raise ValueError('Explicit development candidate required; never production approval')
    for name, expected in manifest['stage_sha256'].items():
        path = root / 'stages' / name
        if Path(name).name != name or not name.endswith('.json') or path.is_symlink():
            raise ValueError('Private candidate stage identity changed')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Private candidate stage changed')
    if not manifest.get('catalog_sha256'):
        raise ValueError('Private candidate catalog manifest absent')
    for name, expected in manifest['catalog_sha256'].items():
        path = root / 'catalog' / name
        if Path(name).name != name or not name.endswith('.json') or path.is_symlink():
            raise ValueError('Private candidate catalog identity changed')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Private candidate catalog changed')
    return manifest


def restore_candidate(stack, root, diagnostic_start_at=None):
    root = Path(root)
    manifest = verify_candidate(root)
    results = []
    if stack.report.get('candidate_restore'):
        stack.report.setdefault('prior_candidate_restore_attempts', []).append(stack.report['candidate_restore'])
    started = diagnostic_start_at is None
    if diagnostic_start_at is not None:
        stack.report['candidate_clean_bootstrap'] = False
    for name, expected in manifest['stage_sha256'].items():
        source = (root / 'stages' / name).read_bytes()
        if hashlib.sha256(source).hexdigest() != expected:
            raise ValueError('Private candidate stage changed')
        if not started:
            started = name == diagnostic_start_at
            if not started:
                continue
        statements = json.loads(source)
        pending = list(enumerate(statements))
        attempts = 0
        errors = []
        for attempts in range(1, 9):
            errors = apply_batch(stack, [sql for _, sql in pending])
            unresolved = [pending[row['index']] for row in errors]
            if not errors or len(unresolved) == len(pending):
                break
            pending = unresolved
        results.append(dict(stage=name, total_statements=len(statements), attempts=attempts,
                            status='FAIL' if errors else 'PASS',
                            unresolved=[dict(sql_sha256=hashlib.sha256(pending[e['index']][1].encode()).hexdigest(),
                                             sqlstate=e['sqlstate'], catalog_reference=e.get('catalog_reference')) for e in errors]))
        stack.report['candidate_restore'] = results
        stack.save()
        if errors:
            # Stop dependent baseline stages, while caller can still run independent
            # foundational and source tests on separate generated fixtures.
            return False
    return True


def reconcile_foundations(stack, root):
    """Install real captured extensions and missing ACL principals on this owned stack.

    No managed role memberships, relaxed policies, replacement helpers or new
    superuser roles are granted. Existing managed-role drift remains reportable.
    """
    root = Path(root)
    manifest = json.loads((root / 'candidate-manifest.json').read_text())
    catalog = root / 'catalog'
    for name in ['extensions.json', 'roles.json']:
        data = (catalog / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest['catalog_sha256'][name]:
            raise ValueError('Managed catalog bytes changed')
    quote = lambda value: '"' + value.replace('"', '""') + '"'
    literal = lambda value: "'" + value.replace("'", "''") + "'"
    extensions = json.loads((catalog / 'extensions.json').read_text())
    existing = json.loads(stack.sql("SELECT coalesce(jsonb_agg(extname),'[]') FROM pg_extension;"))
    for ext in extensions:
        if ext['extname'] not in existing:
            stack.sql('CREATE EXTENSION ' + quote(ext['extname']) + ' WITH SCHEMA ' + quote(ext['nspname']) +
                      ' VERSION ' + literal(ext['extversion']) + ';')
    roles = json.loads((catalog / 'roles.json').read_text())
    existing = json.loads(stack.sql("SELECT jsonb_agg(rolname) FROM pg_roles;"))
    created = []
    for role in roles:
        if role['rolname'] in existing or role['rolname'].startswith('pg_'):
            continue
        if role['rolsuper']:
            raise ValueError('New superuser principal refused')
        flags = ' '.join(('' if role[key] else 'NO') + flag for key, flag in
                         [('rolinherit', 'INHERIT'), ('rolcreaterole', 'CREATEROLE'),
                          ('rolcreatedb', 'CREATEDB'), ('rolcanlogin', 'LOGIN'),
                          ('rolreplication', 'REPLICATION'), ('rolbypassrls', 'BYPASSRLS')])
        stack.sql('CREATE ROLE ' + quote(role['rolname']) + ' NOSUPERUSER ' + flags + ';')
        created.append(role['rolname'])
    actual = json.loads(stack.sql("SELECT jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) ORDER BY e.extname) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace;"))
    stack.report['foundation_extensions'] = actual
    stack.report['created_source_acl_principals'] = created
    stack.report['managed_role_memberships_granted'] = False
    stack.save()


def reconcile_application_publication(stack, root):
    """Exact captured application publication, preserving native managed publications."""
    root = Path(root)
    manifest = json.loads((root / 'candidate-manifest.json').read_text())
    data = {}
    for name in ['publications', 'publication_memberships', 'publication_tables']:
        path = root / 'catalog' / (name + '.json')
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest['catalog_sha256'][path.name]:
            raise ValueError('Publication capture changed')
        data[name] = json.loads(path.read_text())
    expected = next(p for p in data['publications'] if p['pubname'] == 'supabase_realtime')
    current = json.loads(stack.sql("SELECT jsonb_build_object('pubname',p.pubname,'owner',pg_get_userbyid(p.pubowner),'puballtables',p.puballtables,'pubinsert',p.pubinsert,'pubupdate',p.pubupdate,'pubdelete',p.pubdelete,'pubtruncate',p.pubtruncate,'pubviaroot',p.pubviaroot) FROM pg_publication p WHERE p.pubname='supabase_realtime';"))
    if current != expected:
        raise ValueError('Application publication configuration differs; no blanket repair')
    before = json.loads(stack.sql("SELECT coalesce(jsonb_agg(format('%I.%I',n.nspname,c.relname)),'[]') FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid JOIN pg_class c ON c.oid=pr.prrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE p.pubname='supabase_realtime';"))
    targets = [p for p in data['publication_memberships'] if p['pubname'] == 'supabase_realtime']
    # regclass deparsing omits public when it is visible in the captured search
    # path. Bind any bare identity to the independently captured namespace row.
    targets = [dict(p) for p in targets]
    for target in targets:
        if '.' not in target['relation']:
            candidates = [p for p in data['publication_tables'] if p['pubname'] == 'supabase_realtime'
                          and p['tablename'] == target['relation'] and p['schemaname'] == 'public']
            if len(candidates) != 1:
                raise ValueError('Unqualified publication identity is ambiguous')
            target['relation'] = 'public.' + target['relation']
    if not set(before) <= {p['relation'] for p in targets}:
        raise ValueError('Unexpected preexisting application publication member')
    for target in targets:
        relation = target['relation']
        import re
        if not re.fullmatch(r'public\.[a-z_][a-z0-9_]*', relation) or target.get('rowfilter') or target.get('attnames'):
            raise ValueError('Review nonstandard publication member before applying')
        if relation not in before:
            stack.sql('ALTER PUBLICATION supabase_realtime ADD TABLE ' + relation + ';')
    stack.report['application_publication_members'] = [p['relation'] for p in targets]
    stack.save()
