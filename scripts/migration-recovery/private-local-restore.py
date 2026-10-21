"""Private operator CLI. Default is source-only checking; --execute is explicit."""
import argparse
import os
import subprocess
import sys
from pathlib import Path
from private_restore import load_private_bundle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-root', type=Path, required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--keep-stack-for-signed-tests', action='store_true')
    parser.add_argument('--security-release', action='store_true')
    parser.add_argument('--repo', action='append', default=[])
    parser.add_argument('--with-stedi', action='store_true')
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    os.umask(0o077)
    try:
        bundle = load_private_bundle(args.private_root, repository)
        if not args.execute:
            print('PRIVATE_SOURCE_CHECK_PASS; restore and signed-JWT acceptance NOT RUN')
            return
        if os.name != 'posix':
            raise ValueError('Execute in WSL2/Linux with owner-only files; native Windows execution is unsupported')
        manifest_path = bundle['root'] / 'reviewed-cutover.json'
        command = [sys.executable, str(Path(__file__).with_name('isolated-replay.py')),
                   '--baseline', str(bundle['baseline']), '--cutover-manifest', str(manifest_path),
                   '--ledger', str(bundle['ledger']), '--source-catalog', str(bundle['catalog']),
                   '--reviewed-parity-diff', str(bundle['parity']), '--private-bundle', str(bundle['root']),
                   '--output-dir', str(bundle['root'] / 'isolated-results')]
        if not args.security_release:
            command.append('--restore-only')
        if args.keep_stack_for_signed_tests:
            command.append('--keep-stack-for-signed-tests')
        for repo in args.repo:
            command.extend(['--repo', repo])
        if args.with_stedi:
            command.append('--with-stedi')
        # Child prints only fixed status text; all command diagnostics are captured.
        result = subprocess.run(command, text=True, capture_output=True)
        if result.returncode:
            raise ValueError('Isolated execution blocked; inspect metadata-only results privately, not raw SQL logs')
        print('ISOLATED_SQL_CHECK_FINISHED; independent signed-JWT acceptance still required; production NOT authorized')
    except Exception:
        # JSON/parsing/OS exceptions may quote private content or file paths.
        print('BLOCKED: private evidence or local prerequisites failed; no raw diagnostics emitted', file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == '__main__':
    main()