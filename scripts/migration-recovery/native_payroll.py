"""Actual payroll rate/statement arithmetic and failed-attempt reconciliation.

Only synthetic unpaid lines and failed attempts are created. No transaction ID,
provider acknowledgment, external payment or settlement is manufactured.
"""
import json
from decimal import Decimal
import uuid
from native_acceptance import literal


def payroll_matrix(stack, identities):
    rows = []
    own = next(x for x in identities if x['persona'] == 'clinician')
    foreign = next(x for x in identities if x['persona'] == 'foreign_clinician')
    staff = {}
    for actor in [own, foreign]:
        staff[actor['id']] = stack.sql('SELECT id FROM public.staff WHERE profile_id=' + literal(actor['id']) + ';')
    sid = staff[own['id']]
    tenant = own['tenant']
    stack.sql("INSERT INTO public.payroll_rate_configs(tenant_id,status_code,rate_amount,effective_from,effective_to) VALUES " +
              '(' + literal(tenant) + ",'documented',100.25,'2026-01-01','2026-12-31')," +
              '(' + literal(tenant) + ",'late_cancel',25.75,'2026-01-01','2026-12-31');" +
              'INSERT INTO public.staff_rate_overrides(tenant_id,staff_id,status_code,rate_amount,effective_from,effective_to) VALUES ' +
              '(' + literal(tenant) + ',' + literal(sid) + ",'documented',110.50,'2026-02-01','2026-06-30')," +
              '(' + literal(tenant) + ',' + literal(sid) + ",'late_cancel/noshow',30.25,'2026-02-01','2026-06-30');")
    def record(name, passed, **metadata):
        rows.append(dict(name=name, status='PASS' if passed else 'FAIL', **metadata))
        stack.report['payroll_database_assertions'] = rows
        stack.save()
    for status, date, expected in [('documented', '2026-01-31', '100.25'),
                                   ('documented', '2026-02-01', '110.50'),
                                   ('documented', '2026-06-30', '110.50'),
                                   ('documented', '2026-07-01', '100.25'),
                                   ('late_cancel', '2026-03-01', '30.25'),
                                   ('noshow', '2026-03-01', '30.25')]:
        value = json.loads(stack.sql('SELECT private.resolve_service_payroll_rate_v1(' + ','.join(
            literal(x) for x in [tenant, sid, status, date]) + ');'))
        record(status + ' effective-date rate ' + date, Decimal(str(value['rate'])) == Decimal(expected))
    runs = [str(uuid.uuid4()), str(uuid.uuid4())]
    lines = [str(uuid.uuid4()), str(uuid.uuid4())]
    for i, kind in enumerate(['standard', 'correction']):
        stack.sql('INSERT INTO public.payroll_runs(id,tenant_id,period_start,period_end,run_type) VALUES (' +
                  ','.join(literal(x) for x in [runs[i], tenant, '2026-01-01', '2026-01-07', kind]) + ');')
    stack.sql('INSERT INTO public.payroll_line_items(id,tenant_id,payroll_run_id,staff_id,documented_count,documented_rate,documented_amount,late_cancel_count,late_cancel_rate,late_cancel_amount,total_amount) VALUES ' +
              '(' + ','.join(literal(x) for x in [lines[0], tenant, runs[0], sid]) + ',2,40.05,80.10,1,20.20,20.20,100.30),' +
              '(' + ','.join(literal(x) for x in [lines[1], tenant, runs[1], sid]) + ',1,0.05,0.05,0,0,0,0.05);')
    args = ','.join(literal(x) for x in [tenant, sid, '2026-01-01', '2026-01-07'])
    statement = json.loads(stack.sql('SELECT private.payroll_build_statement_v2(' + args + ');'))
    amounts = statement['amounts']
    for key, expected in [('statementAmount', '100.35'), ('documentedAmount', '80.15'), ('lateCancelNoShowAmount', '20.20')]:
        record('statement exact decimal sum ' + key, Decimal(str(amounts[key])) == Decimal(expected))
    request = {'p_period_start': '2026-01-01', 'p_period_end': '2026-01-07', 'p_staff_id': sid}
    code, value = stack.request('rest', '/rpc/staff_get_payroll_statement_v2', request, own['token'])
    record('signed clinician reads own statement', code == 200 and Decimal(str(value.get('amounts', {}).get('statementAmount', '-1'))) == Decimal('100.35'), http=code)
    code, _ = stack.request('rest', '/rpc/staff_get_payroll_statement_v2', request, foreign['token'])
    record('signed foreign clinician cannot read statement', code in (401, 403), http=code)
    # No successful provider evidence: failed attempt has a NULL transaction ID.
    stack.sql('INSERT INTO public.payroll_payment_attempts(tenant_id,line_item_id,payroll_run_id,idempotency_key,proxy_http_status,error_class) VALUES (' +
              ','.join(literal(x) for x in [tenant, lines[0], runs[0], 'synthetic-failed-' + lines[0]]) + ",503,'network_error');")
    for index in range(2):
        code, value = stack.request('rest', '/rpc/reconcile_payroll_line_items_from_attempts', {'p_payroll_run_id': runs[0]}, stack.service_key)
        record('failed-attempt reconciliation is not payment evidence, replay ' + str(index), code == 200 and value.get('healed') == 0, http=code)
    value = json.loads(stack.sql('SELECT jsonb_build_object(\'amount\',total_amount,\'transaction\',mercury_transaction_id,\'attempts\',(SELECT count(*) FROM public.payroll_payment_attempts WHERE line_item_id=' + literal(lines[0]) + ')) FROM public.payroll_line_items WHERE id=' + literal(lines[0]) + ';'))
    record('reconciliation preserves amount, null provider ID and one attempt', Decimal(str(value['amount'])) == Decimal('100.30') and value['transaction'] is None and value['attempts'] == 1)
    return rows
