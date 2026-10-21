"""Prepare pinned genuine images; flatten large rootfs images for vfs Docker.

Requires crane on PATH. Downloads contain public image files only. No credentials
or schema artifacts are accepted. Network use ends before isolated tests start.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from flatten_image import import_image

SOURCES = {
    'db': ('public.ecr.aws/supabase/postgres@sha256:4863d039faf67e794b3e1d0255e8ceafe476feb43e53c6da2979c00900e39a14', '5b447ecb99300d8c6c546cfea34fe493ee96224abbbb3c586a219525c95f50f0'),
    'storage': ('supabase/storage-api@sha256:98ffec5d0678803783c30e404c27f4ec65e97efbe014088f2a86b4b8b54b9f54', 'fc239553c124b27b72ee35cb81cd22d052da5e7730a8244ea2293d478cff6128'),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    lock = json.loads((Path(__file__).parent / 'native/image-lock.json').read_text())
    for name in ['db', 'auth', 'rest', 'storage', 'realtime']:
        tag = lock[name]['tag']
        if name in SOURCES:
            source, expected = SOURCES[name]
            tar = args.cache / (name + '.tar')
            config = args.cache / (name + '.json')
            subprocess.run(['crane', 'export', '--platform=linux/amd64', source, str(tar)], check=True)
            digest = hashlib.file_digest(tar.open('rb'), 'sha256').hexdigest()
            if digest != expected:
                raise ValueError('Upstream flattened rootfs checksum mismatch')
            config.write_bytes(subprocess.check_output(['crane', 'config', '--platform=linux/amd64', source]))
            import_image(tar, config, tag)
        else:
            source = lock[name]['repo_digests'][0]
            subprocess.run(['docker', '--host=unix:///var/run/docker.sock', 'pull', '--platform=linux/amd64', source], check=True)
            subprocess.run(['docker', '--host=unix:///var/run/docker.sock', 'tag', source, tag], check=True)
    print('Pinned native images prepared; full schema parity remains a separate gate')


if __name__ == '__main__':
    main()
