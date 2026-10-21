"""Produce review targets from private catalogs; heuristic flags are not findings."""
import argparse
import json
from pathlib import Path
from catalog_candidate import APP_SCHEMAS


def review(root):
    read = lambda name: json.loads((root / (name + '.json')).read_text())
    functions = read('functions')
    definers = [f for f in functions if f['prosecdef']]
    return dict(independent_owner_approval=False, automated_review_is_approval=False,
        security_definer_functions=len(definers),
        security_definer_without_explicit_search_path=[dict(schema=f['nspname'], name=f['proname'], args=f['identity_args'])
            for f in definers if 'search_path=' not in str(f.get('proconfig') or '')],
        unvalidated_constraints=[dict(schema=r['nspname'], table=r['relname'], name=r['conname'])
            for r in read('constraints') if r.get('convalidated') is False],
        invalid_indexes=[dict(schema=r['nspname'], name=r['indexname'])
            for r in read('indexes') if r.get('indisvalid') is False],
        application_tables_without_rls=[dict(schema=r['nspname'], name=r['relname'])
            for r in read('relations') if r['nspname'] in APP_SCHEMAS
            and r.get('relkind') in ['r', 'p'] and not r.get('relrowsecurity')],
        extension_requirements=read('extensions'),
        note='Catalog flags identify review work, not exploitability. Inspect the private ACL, dependency and strict parity records; no blanket approvals.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if any((p / '.git').exists() for p in [args.output.resolve(), *args.output.resolve().parents]):
        raise SystemExit('Private review output must be outside source')
    result = review(args.catalog)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    args.output.chmod(0o600)
    print(json.dumps({k: len(v) if isinstance(v, list) else v for k, v in result.items() if k != 'note'}))
