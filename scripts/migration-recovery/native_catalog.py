"""Private native catalog capture and strict comparison; never allowlist drift."""
import json
from pathlib import Path
import subprocess
import sys
from catalog_candidate import read_queries


def compare_native(stack, billing, candidate):
    output = stack.root / 'catalog'
    output.mkdir(mode=0o700)
    blocked = []
    for name, query in read_queries(billing).items():
        try:
            text = stack.sql("BEGIN READ ONLY; SET LOCAL search_path=public,extensions; SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (" + query + ') x; COMMIT;')
            (output / (name + '.json')).write_text(json.dumps(json.loads(text)))
        except Exception as error:
            blocked.append(dict(category=name, reason=type(error).__name__))
    target = stack.root / 'strict-parity.json'
    result = subprocess.run([sys.executable, str(Path(billing) / 'scripts/reconcile-schema-baseline.py'),
                             str(Path(candidate) / 'catalog'), str(output), '--output', str(target)], capture_output=True)
    if target.exists():
        report = json.loads(target.read_text())
        summary = {name: dict(source_count=value['source_count'], restored_count=value['restored_count'],
                             differences=len(value['differences'])) for name, value in report.items()}
        stack.report['catalog_comparison'] = dict(status='PASS' if result.returncode == 0 else 'FAIL', categories=summary, blocked=blocked,
            comparison_scope='Strict catalog before security deltas and application fixtures. Managed drift and redactions remain differences.')
    else:
        stack.report['catalog_comparison'] = dict(status='BLOCKED', blocked=blocked, exit_code=result.returncode)
    stack.save()
