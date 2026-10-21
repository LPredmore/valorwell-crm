"""Private stdin/stdout bridge for SDK fixture SQL and actual isolated HTTP."""
import argparse
import json
import sys
import subprocess
import re
from native_stack import NativeStack, DOCKER, run


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-run',required=True)
    args=parser.parse_args()
    try:
        stack=NativeStack.attach(args.private_run)
        item=json.load(sys.stdin)
        if item['action']=='http':
            request=item['request']
            if request.get('service') not in stack.ports:
                raise ValueError('Unowned HTTP service')
            response=json.loads(run(DOCKER+['exec','-i',stack.containers['transport'],'node','/retest/http-bridge.mjs'],json.dumps(request)))
            result={'ok':True,'http':response}
        elif item['action']=='sql':
            role=item.get('role','postgres')
            if role not in ['postgres','service_role','authenticated','anon']:
                raise ValueError('Unknown fixture role')
            sql="BEGIN; SELECT 1/CASE WHEN current_setting('valorwell.acceptance_disposable',true)='true' THEN 1 ELSE 0 END; SET LOCAL ROLE \""+role+'\"; '+item['sql']+'; COMMIT;'
            data=stack.sql('\\set VERBOSITY sqlstate\n' + sql).splitlines()
            result={'ok':True,'data':json.loads(data[-1])}
        else:
            raise ValueError('Unsupported fixture operation')
        print(json.dumps(result))
        return 0
    except subprocess.CalledProcessError as error:
        state = re.search(r'ERROR:\s+([0-9A-Z]{5})', error.stderr or '')
        code = state.group(1) if state else 'UNKNOWN'
        print(json.dumps({'ok': False, 'error': 'permission denied (42501)' if code == '42501' else 'Owned SQL failed (' + code + ')'}))
        return 2
    except Exception:
        # Error diagnostics can include private function/trigger definitions.
        print('{"ok":false,"error":"Owned native operation failed; raw diagnostics suppressed"}')
        return 2


if __name__=='__main__':
    raise SystemExit(main())
