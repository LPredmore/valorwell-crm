"""Import an already verified upstream rootfs with its original runtime config.

Packaging changes; upstream digest and source config remain separate provenance.
No application SQL, provider credentials or database records are included.
"""
import argparse
import json
import subprocess
from pathlib import Path


def import_image(rootfs, config, tag):
    if not tag.startswith('valorwell-local/'):
        raise ValueError('Only local development image tags permitted')
    data = json.loads(config.read_text())
    command = ['docker', '--host=unix:///var/run/docker.sock', 'import']
    for value in data['config'].get('Env', []):
        command.extend(['--change', 'ENV ' + value])
    for key in ['Entrypoint', 'Cmd']:
        if data['config'].get(key):
            command.extend(['--change', key.upper() + ' ' + json.dumps(data['config'][key])])
    for key in ['User', 'WorkingDir']:
        if data['config'].get(key):
            command.extend(['--change', ('WORKDIR' if key == 'WorkingDir' else 'USER') + ' ' + data['config'][key]])
    command.extend([str(rootfs), tag])
    return subprocess.run(command, capture_output=True, check=True).stdout.decode().strip()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rootfs', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--tag', required=True)
    args = parser.parse_args()
    print(import_image(args.rootfs, args.config, args.tag))
