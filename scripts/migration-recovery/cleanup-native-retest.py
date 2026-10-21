"""Destroy only the label-verified resources from one private native retest run."""
import argparse
import json
import os
from pathlib import Path
from native_stack import NativeStack


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-run',type=Path,required=True)
    args=parser.parse_args()
    try:
        root=args.private_run.resolve(strict=True)
        if root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o077:
            raise ValueError('Owner-only private run required')
        if any((p/'.git').exists() for p in [root,*root.parents]):
            raise ValueError('Private run must not be in source')
        data=json.loads((root/'runtime-private.json').read_text())
        stack=NativeStack.__new__(NativeStack)
        stack.root=root
        for key in ['identifier','network','containers','ports','service_key','anon_key']:
            setattr(stack,key,data[key])
        stack.secret=data['jwt_secret'];stack.password='';stack.network_created=True
        stack.report=json.loads((root/'results.json').read_text())
        result=stack.cleanup()
        print('BLOCKED_CLEANUP' if result else 'OWNED_CLEANUP_PASS')
        return 2 if result else 0
    except Exception:
        print('BLOCKED: ownership metadata unavailable; no unrelated resources touched')
        return 2


if __name__=='__main__':
    raise SystemExit(main())
