"""Run unchanged source worker assertions over the owned native bridge."""
import os
from pathlib import Path
import subprocess


def worker_suites(stack, repositories, resend_module):
    loader = Path(__file__).parent / 'native/fixture-loader.mjs'
    suites = [
        ('crm_workers', repositories['crm-draft193'], 'crm-db.test.mjs', 'VALORWELL_RUN_AUTHORITY_DB', 'true'),
        ('stripe_database', repositories['billing'], 'stripe-db.test.mjs', 'VALORWELL_RECOVERED_DB_TEST', '1'),
    ]
    for name, repository, file, flag, value in suites:
        env = {k: v for k, v in os.environ.items() if k in ['PATH', 'HOME']}
        env.update({flag: value, 'VALORWELL_NATIVE_RUN': str(stack.root), 'VALORWELL_NATIVE_RESEND_MODULE': str(resend_module)})
        log = stack.root / (name + '.log')
        try:
            with log.open('w') as stream:
                result = subprocess.run(['node', '--experimental-vm-modules', '--experimental-loader', str(loader),
                                         '--test', 'scripts/worker-integration/' + file], cwd=repository, env=env,
                                        stdout=stream, stderr=subprocess.STDOUT, timeout=300)
            stack.report.setdefault('worker_suites', {})[name] = dict(status='PASS' if result.returncode == 0 else 'FAIL', exit_code=result.returncode,
                scope='actual native database/Auth; provider transport simulated and external egress denied')
        except Exception as error:
            stack.report.setdefault('worker_suites', {})[name] = dict(status='BLOCKED', reason=type(error).__name__)
        stack.save()
