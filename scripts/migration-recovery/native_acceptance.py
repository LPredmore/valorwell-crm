"""Native transport/RLS and captured Storage policy tests using only synthetic data."""
import base64
import json
import secrets
import uuid
from native_stack import jwt


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def foundation_matrix(stack):
    identities = []
    tenants = [str(uuid.uuid4()), str(uuid.uuid4())]
    password = 'Synthetic-' + secrets.token_urlsafe(24)
    for persona, tenant in [('client', 0), ('clinician', 0), ('administrator', 0), ('billing', 0),
                            ('crm_operator', 0), ('readonly', 0), ('crm_only', 0),
                            ('multi_role', 0), ('foreign_client', 1), ('foreign_operator', 1),
                            ('foreign_billing', 1), ('foreign_clinician', 1), ('foreign_administrator', 1)]:
        email = 'retest-' + str(uuid.uuid4()) + '@example.invalid'
        status, user = stack.request('auth', '/admin/users', dict(email=email, password=password,
            email_confirm=True, app_metadata=dict(current_tenant_id=tenants[tenant], retest_persona=persona)),
            stack.service_key)
        if status not in (200, 201) or not user.get('id'):
            raise ValueError('Synthetic GoTrue identity creation failed')
        status, session = stack.request('auth', '/token?grant_type=password', dict(email=email, password=password))
        if status != 200 or not session.get('access_token'):
            raise ValueError('Native GoTrue password exchange failed')
        identities.append(dict(persona=persona, tenant=tenants[tenant], id=user['id'], email=email,
                               token=session['access_token']))
    (stack.root / 'synthetic-identities-private.json').write_text(json.dumps(identities, indent=2) + '\n')
    rows = []
    def record(name, condition):
        rows.append(dict(name=name, status='PASS' if condition else 'FAIL'))
    stack.sql("""CREATE TABLE public.retest_native_probe(id uuid PRIMARY KEY,tenant_id uuid NOT NULL);
ALTER TABLE public.retest_native_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retest_native_probe FROM PUBLIC,anon;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.retest_native_probe TO authenticated,service_role;
CREATE POLICY retest_native_own_read ON public.retest_native_probe FOR SELECT TO authenticated
USING(tenant_id = (auth.jwt()->'app_metadata'->>'current_tenant_id')::uuid);
CREATE POLICY retest_native_own_insert ON public.retest_native_probe FOR INSERT TO authenticated
WITH CHECK(tenant_id = (auth.jwt()->'app_metadata'->>'current_tenant_id')::uuid
AND auth.jwt()->'app_metadata'->>'retest_persona' IN ('administrator','billing','crm_operator','clinician','multi_role','foreign_operator'));
NOTIFY pgrst,'reload schema';""")
    import time
    time.sleep(1)
    try:
        objects = [str(uuid.uuid4()), str(uuid.uuid4())]
        stack.sql('INSERT INTO public.retest_native_probe VALUES ' + ','.join(
            '(' + literal(i) + ',' + literal(t) + ')' for i, t in zip(objects, tenants)) + ';')
        for identity in identities:
            code, data = stack.request('rest', '/retest_native_probe?select=id,tenant_id', token=identity['token'])
            record(identity['persona'] + ': genuine GoTrue token own-tenant SELECT', code == 200 and len(data) == 1 and data[0]['tenant_id'] == identity['tenant'])
            other = tenants[1] if identity['tenant'] == tenants[0] else tenants[0]
            code, data = stack.request('rest', '/retest_native_probe', dict(id=str(uuid.uuid4()), tenant_id=other), identity['token'])
            record(identity['persona'] + ': foreign tenant INSERT denied', code == 403)
        own = identities[0]
        code, data = stack.request('rest', '/retest_native_probe?id=eq.' + str(uuid.uuid4()), token=own['token'])
        record('Missing synthetic record returns empty set', code == 200 and data == [])
        for label, token in [('anonymous', None), ('invalid signature', own['token'][:-5] + 'aaaaa'),
                             ('expired signature', jwt(stack.secret, 'authenticated', dict(sub=own['id'], exp=int(time.time()) - 60)))]:
            code, _ = stack.request('rest', '/retest_native_probe', token=token)
            record(label + ': native PostgREST rejects access', code in (401, 403))
        record('Service role sees exactly two synthetic tenants',
               len(stack.request('rest', '/retest_native_probe', token=stack.service_key)[1]) == 2)
        code, _ = stack.request('rest', '/retest_native_probe', dict(id=str(uuid.uuid4()), tenant_id=tenants[0]), identities[5]['token'])
        record('Readonly fixture role cannot write', code == 403)
    finally:
        stack.sql('DROP TABLE public.retest_native_probe; NOTIFY pgrst,\'reload schema\';')
    stack.report['foundation_assertions'] = rows
    stack.report['foundation_scope'] = 'Actual GoTrue/PostgREST and generated probe RLS; not production application authorization or catalog parity.'
    stack.save()
    return identities


def seed_application_roles(stack, identities):
    tenants = list(dict.fromkeys(x['tenant'] for x in identities))
    sql = 'INSERT INTO public.tenants(id,name,slug) VALUES ' + ','.join(
        '(' + literal(t) + ", 'Synthetic acceptance', " + literal('retest-' + t) + ')' for t in tenants) + ';'
    sql += 'INSERT INTO public.profiles(id,email) VALUES ' + ','.join(
        '(' + literal(x['id']) + ',' + literal(x['email']) + ')' for x in identities) + ';'
    sql += 'INSERT INTO public.tenant_memberships(tenant_id,profile_id) VALUES ' + ','.join(
        '(' + literal(x['tenant']) + ',' + literal(x['id']) + ')' for x in identities) + ';'
    roles = {'administrator': 'crm_admin', 'crm_operator': 'crm_operator', 'readonly': 'crm_readonly',
             'crm_only': 'crm_operator', 'multi_role': 'crm_admin', 'foreign_operator': 'crm_operator', 'foreign_administrator': 'crm_admin'}
    sql += 'INSERT INTO public.crm_user_capabilities(tenant_id,profile_id,crm_role) VALUES ' + ','.join(
        '(' + literal(x['tenant']) + ',' + literal(x['id']) + ',' + literal(roles[x['persona']]) + ')'
        for x in identities if x['persona'] in roles) + ';'
    sql += 'INSERT INTO public.user_roles(user_id,role) VALUES ' + ','.join(
        '(' + literal(x['id']) + ',' + literal('admin' if x['persona'] in ['administrator', 'multi_role', 'foreign_administrator'] else 'staff' if x['persona'] in ['clinician', 'billing', 'foreign_clinician', 'foreign_billing'] else 'client') + ')'
        for x in identities) + ';'
    stack.sql(sql)
    role_rows = [('CLINICIAN', True), ('BILLING', False), ('ADMIN', False)]
    stack.sql('INSERT INTO public.staff_roles(code,name,description,is_clinical) VALUES ' + ','.join(
        '(' + literal(code) + ',' + literal('Synthetic ' + code) + ",'Synthetic acceptance role'," + str(clinical).lower() + ')'
        for code, clinical in role_rows) + ';')
    for identity in identities:
        assignments = {'clinician': ['CLINICIAN'], 'billing': ['BILLING'],
                       'administrator': ['ADMIN'], 'multi_role': ['CLINICIAN', 'BILLING'],
                       'foreign_billing': ['BILLING'], 'foreign_clinician': ['CLINICIAN'], 'foreign_administrator': ['ADMIN']}.get(identity['persona'], [])
        if not assignments:
            continue
        staff_id = str(uuid.uuid4())
        stack.sql('INSERT INTO public.staff(id,tenant_id,profile_id) VALUES (' + literal(staff_id) + ',' + literal(identity['tenant']) + ',' + literal(identity['id']) + ');' +
                  'INSERT INTO public.staff_role_assignments(tenant_id,staff_id,staff_role_id) SELECT ' + literal(identity['tenant']) + ',' + literal(staff_id) +
                  ' ,id FROM public.staff_roles WHERE code IN (' + ','.join(literal(x) for x in assignments) + ');')
    rows = []
    for identity in identities:
        for target in tenants:
            expected = target == identity['tenant'] and identity['persona'] in ['billing', 'administrator', 'multi_role', 'foreign_billing', 'foreign_administrator']
            code, value = stack.request('rest', '/rpc/has_billing_role',
                                       {'_user_id': identity['id'], '_tenant_id': target}, identity['token'])
            rows.append(dict(persona=identity['persona'], own_tenant=target == identity['tenant'],
                             status='PASS' if code == 200 and value is expected else 'FAIL', http=code))
    stack.report['application_billing_role_assertions'] = rows
    stack.save()


def storage_matrix(stack, identities, label, tenant_bound=False):
    rows = []
    own = next(x for x in identities if x['persona'] == 'crm_operator')
    foreign = next(x for x in identities if x['persona'] == 'foreign_client')
    foreign_operator = next(x for x in identities if x['persona'] == 'foreign_operator')
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
    headers = {'Content-Type': 'image/png'}
    if tenant_bound:
        headers['x-metadata'] = base64.b64encode(json.dumps({'tenant_id': own['tenant']}).encode()).decode()
    for bucket in ['org-logos', 'training-covers', 'email-signatures']:
        code, _ = stack.request('storage', '/bucket', dict(id=bucket, name=bucket, public=True), stack.service_key)
        if code not in (200, 201, 400, 409):
            rows.append(dict(name=bucket + ': synthetic bucket creation', status='FAIL', http=code))
            continue
        path = 'retest-' + str(uuid.uuid4()) + '.png'  # Flat-path contract is preserved.
        endpoint = '/object/' + bucket + '/' + path
        code, _ = stack.request('storage', endpoint, png, own['token'], headers=headers)
        rows.append(dict(name=bucket + ': own CRM operator upload', status='PASS' if code in (200, 201) else 'FAIL', http=code))
        if code not in (200, 201):
            rows.append(dict(name=bucket + ': negative checks require successful synthetic upload', status='BLOCKED'))
            continue
        if tenant_bound:
            code, _ = stack.request('storage', endpoint, png, own['token'], method='PUT', headers=headers)
            rows.append(dict(name=bucket + ': own tenant replacement succeeds', status='PASS' if code == 200 else 'FAIL', http=code))
        for actor, operation, method in [(foreign, 'foreign client replacement', 'PUT'),
                                          (foreign_operator, 'foreign CRM operator replacement', 'PUT')]:
            code, response = stack.request('storage', endpoint, png, actor['token'], method=method,
                                    headers=headers)
            # A successful cross-tenant replacement is a failed security assertion,
            # even if it reproduces the captured production policy exactly.
            denied = code in (401, 403) or (isinstance(response, dict) and str(response.get('statusCode')) in ('401', '403'))
            rows.append(dict(name=bucket + ': deny ' + operation, status='PASS' if denied else 'FAIL', http=code,
                             storage_status=response.get('statusCode') if isinstance(response, dict) else None))
        code, response = stack.request('storage', endpoint, png, method='PUT', headers=headers)
        denied = code in (401, 403) or (isinstance(response, dict) and str(response.get('statusCode')) in ('401', '403'))
        denied = denied or (code == 400 and isinstance(response, dict) and response.get('code') == 'InvalidRequest' and response.get('message') == "headers must have required property 'authorization'")
        rows.append(dict(name=bucket + ': anonymous replacement denied', status='PASS' if denied else 'FAIL', http=code))
        for actor in [foreign, foreign_operator]:
            # Check actual persistence; Storage can return 200 with an empty list
            # when RLS filters a deletion. HTTP success alone is not a deletion.
            before = stack.request('storage', endpoint, token=stack.service_key)[0]
            code, _ = stack.request('storage', '/object/' + bucket, dict(prefixes=[path]), actor['token'], method='DELETE')
            after = stack.request('storage', endpoint, token=stack.service_key)[0]
            rows.append(dict(name=bucket + ': deny ' + actor['persona'] + ' deletion',
                             status='PASS' if before == 200 and after == 200 else 'FAIL', http=code))
            if after != 200:
                stack.request('storage', endpoint, png, own['token'], headers=headers)
        stack.request('storage', '/object/' + bucket, dict(prefixes=[path]), stack.service_key, method='DELETE')
    stack.report.setdefault('storage_assertions', {})[label] = rows
    stack.save()
    return rows
