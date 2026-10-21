"""Owned native Supabase development stack. No remote database selector exists."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import threading
import urllib.error
import urllib.request
import uuid

DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
IMAGES = {'db': 'valorwell-local/postgres:17.6.1.052', 'auth': 'supabase/gotrue:v2.197.0',
          'rest': 'postgrest/postgrest:v14.18', 'storage': 'valorwell-local/storage-api:v1.81.0',
          'realtime': 'supabase/realtime:v2.143.3', 'transport': 'valorwell-local/storage-api:v1.81.0'}
LABEL = 'com.valorwell.retest.run'


def run(command, input_text=None, timeout=180):
    allowed = {'PATH', 'HOME', 'DOCKER_CONFIG', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS'}
    env = {k: v for k, v in os.environ.items() if k in allowed}
    return subprocess.run(command, input=input_text, text=True, capture_output=True,
                          check=True, timeout=timeout, env=env).stdout.strip()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def jwt(secret, role, extra=None):
    encode = lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')
    header = encode(b'{"alg":"HS256","typ":"JWT"}')
    claims = dict(role=role, aud='authenticated', iss='valorwell-development',
                  iat=int(time.time()), exp=int(time.time()) + 7200)
    claims.update(extra or {})
    payload = encode(json.dumps(claims).encode())
    return header + '.' + payload + '.' + encode(hmac.new(secret.encode(), (header + '.' + payload).encode(), hashlib.sha256).digest())


def assert_owned(item, identifier, network=None):
    if not identifier.startswith('vw-native-') or item.get('Config', {}).get('Labels', {}).get(LABEL) != identifier:
        raise ValueError('Resource ownership mismatch')
    if network is not None:
        if set(item['NetworkSettings']['Networks']) != {network}:
            raise ValueError('External network attached')
        if item['HostConfig']['LogConfig']['Type'] != 'none':
            raise ValueError('Private container logging enabled')
        if item['HostConfig'].get('Privileged') or item['HostConfig'].get('ExtraHosts'):
            raise ValueError('Additional host privileges/routes forbidden')
        for bindings in item['NetworkSettings']['Ports'].values():
            if any(p['HostIp'] != '127.0.0.1' for p in bindings or []):
                raise ValueError('Nonloopback publication forbidden')
        for value in item['Config'].get('Env', []):
            key, _, data = value.partition('=')
            if key.lower() in {'http_proxy', 'https_proxy', 'all_proxy'} and data:
                raise ValueError('Container proxy egress forbidden')


class NativeStack:
    def __init__(self, root):
        self.root = Path(root).absolute()
        repository = Path(__file__).resolve().parents[2]
        if any((parent / '.git').exists() for parent in [self.root, *self.root.parents]) or self.root.is_relative_to(repository) or self.root.exists() or any(p.is_symlink() for p in [self.root, *self.root.parents]):
            raise ValueError('Fresh private directory outside source required')
        os.umask(0o077)
        self.root.mkdir(mode=0o700, parents=True)
        self.identifier = 'vw-native-' + uuid.uuid4().hex[:12]
        self.network = self.identifier + '-internal'
        self.containers = {}
        self.startup_output = {}
        self.network_created = False
        self.secret = secrets.token_hex(32)
        self.password = secrets.token_hex(24)
        self.ports = {name: free_port() for name in ['auth', 'rest', 'storage', 'realtime']}
        if len(set(self.ports.values())) != len(self.ports):
            raise ValueError('Local port allocation collision; retry a fresh run')
        self.service_key = jwt(self.secret, 'service_role')
        self.anon_key = jwt(self.secret, 'anon')
        self.report = dict(scope='native development candidate; full source parity NOT implied',
                           identifier=self.identifier, network=self.network, gates={}, cleanup='PENDING')

    @classmethod
    def attach(cls, root):
        self = cls.__new__(cls)
        self.root = Path(root).resolve(strict=True)
        if any((parent / '.git').exists() for parent in [self.root, *self.root.parents]):
            raise ValueError('Private runtime descriptor cannot be inside source')
        if self.root.stat().st_uid != os.getuid() or self.root.stat().st_mode & 0o077:
            raise ValueError('Owner-only runtime root required')
        data = json.loads((self.root / 'runtime-private.json').read_text())
        for key in ['identifier', 'network', 'containers', 'ports', 'service_key', 'anon_key']:
            setattr(self, key, data[key])
        self.secret = data['jwt_secret']
        self.password = data.get('password', '')
        if not self.password:
            # Recovery of this run's own generated password, never an ambient key.
            values = dict(line.split('=', 1) for line in (self.root / 'db.env').read_text().splitlines() if '=' in line)
            self.password = values['POSTGRES_PASSWORD']
        self.startup_output = {}
        self.network_created = True
        self.report = json.loads((self.root / 'results.json').read_text())
        self.verify()
        return self

    def save(self):
        (self.root / 'runtime-private.json').write_text(json.dumps(dict(identifier=self.identifier,
            network=self.network, containers=self.containers, ports=self.ports,
            jwt_secret=self.secret, password=self.password, service_key=self.service_key, anon_key=self.anon_key), indent=2) + '\n')
        (self.root / 'results.json').write_text(json.dumps(self.report, indent=2) + '\n')

    def start_container(self, name, environment, command=None, mounts=None, port=None):
        lock = json.loads((Path(__file__).parent / 'native/image-lock.json').read_text())[name]
        actual = json.loads(run(DOCKER + ['image', 'inspect', IMAGES[name]]))[0]
        if actual['RootFS']['Layers'] != lock['rootfs_layers'] or any(
                actual['Config'].get(key) != value for key, value in lock['runtime_config'].items()):
            raise ValueError('Native image bytes or runtime configuration drifted')
        envfile = self.root / (name + '.env')
        # Override Docker client proxy defaults, even if the host itself uses a proxy.
        environment = dict(environment, HTTP_PROXY='', HTTPS_PROXY='', ALL_PROXY='',
                           http_proxy='', https_proxy='', all_proxy='', NO_PROXY='*', no_proxy='*')
        envfile.write_text(''.join(k + '=' + str(v) + '\n' for k, v in environment.items()))
        container_name = ('realtime-dev.' if name == 'realtime' else '') + self.identifier + '-' + name
        args = DOCKER + ['create', '--name', container_name, '--label', LABEL + '=' + self.identifier,
                         '--network', self.network, '--network-alias', name, '--dns', '127.0.0.1',
                         '--log-driver', 'none', '--env-file', str(envfile)]
        for key in ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']:
            args.extend(['--env', key + '='])
        if port:
            args += ['-p', '127.0.0.1:' + str(self.ports[name]) + ':' + str(port)]
        for src, dest in mounts or []:
            args += ['--mount', 'type=bind,src=' + str(src.resolve()) + ',dst=' + dest + ',readonly']
        args += [IMAGES[name]] + (command or [])
        # Track by name before startup so a partial docker-run failure is cleaned up.
        self.containers[name] = container_name
        self.save()
        run(args)
        # Attach during public managed bootstrap without enabling Docker logs or
        # persisting raw diagnostics. Retain a bounded in-memory tail for diagnosis.
        process = subprocess.Popen(DOCKER + ['start', '--attach', container_name],
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.startup_output[name] = []
        def consume():
            for line in process.stdout:
                self.startup_output[name].append(line.rstrip())
                del self.startup_output[name][:-80]
        threading.Thread(target=consume, daemon=True).start()
        for _ in range(100):
            item = json.loads(run(DOCKER + ['inspect', container_name]))[0]
            if item['State']['Running']:
                break
            time.sleep(0.1)
        self.verify()

    def verify(self):
        network = json.loads(run(DOCKER + ['network', 'inspect', self.network]))[0]
        if not network.get('Internal') or network.get('Labels', {}).get(LABEL) != self.identifier:
            raise ValueError('Owned internal network required')
        for name in self.containers.values():
            item = json.loads(run(DOCKER + ['inspect', name]))[0]
            assert_owned(item, self.identifier, self.network)

    def sql(self, text):
        self.verify()
        return run(DOCKER + ['exec', '-i', self.containers['db'], 'psql', '-X', '-qAt',
                            '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], text)

    def request(self, service, path, data=None, token=None, method=None, headers=None):
        self.verify()
        if service not in self.ports or not path.startswith('/') or path.startswith('//'):
            raise ValueError('Only fixed owned local service endpoints permitted')
        request_headers = dict(headers or {})
        if token:
            request_headers['Authorization'] = 'Bearer ' + token
        body = None
        if data is not None:
            body = data if isinstance(data, bytes) else json.dumps(data).encode()
            request_headers.setdefault('Content-Type', 'application/json')
        # The managed DinD internal network does not route published ports back to
        # the executor. Exercise actual HTTP inside that same isolated network.
        item = dict(service=service, path=path, headers=request_headers,
                    method=method or ('POST' if body is not None else 'GET'),
                    body=base64.b64encode(body).decode() if body is not None else None)
        response = json.loads(run(DOCKER + ['exec', '-i', self.containers['transport'],
                                  'node', '/retest/http-bridge.mjs'], json.dumps(item)))
        raw = base64.b64decode(response['body'])
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            value = None
        return response['status'], value

    def wait_service(self, name, path, token=None):
        for _ in range(120):
            try:
                if self.request(name, path, token=token)[0] == 200:
                    return
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
            item = json.loads(run(DOCKER + ['inspect', self.containers[name]]))[0]
            if item['State']['Status'] == 'exited':
                lines = [line for line in self.startup_output.get(name, []) if 'error' in line.lower() or 'fatal' in line.lower()]
                safe = '\n'.join(lines[-3:])
                for secret in [self.password, self.secret, self.service_key, self.anon_key]:
                    if secret:
                        safe = safe.replace(secret, '[generated local credential]')
                raise RuntimeError('Public managed bootstrap failed (' + name + '): ' + safe)
            time.sleep(0.5)
        raise RuntimeError('Managed service startup failed: ' + name)

    def start(self):
        run(DOCKER + ['network', 'create', '--internal', '--label', LABEL + '=' + self.identifier, self.network])
        self.network_created = True
        upstream = Path(__file__).with_name('native') / 'upstream'
        bootstrap = self.root / 'bootstrap'
        bootstrap.mkdir(mode=0o700)
        for name in ['roles.sql', 'jwt.sql', 'realtime.sql', 'webhooks.sql']:
            target = bootstrap / name
            target.write_bytes((upstream / name).read_bytes())
            # Public upstream bootstrap SQL must be readable by the image's postgres
            # UID, which differs from the host UID. No private schema is mounted.
            target.chmod(0o444)
        mounts = [(bootstrap / 'webhooks.sql', '/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql'),
                  (bootstrap / 'roles.sql', '/docker-entrypoint-initdb.d/init-scripts/99-roles.sql'),
                  (bootstrap / 'jwt.sql', '/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql'),
                  (bootstrap / 'realtime.sql', '/docker-entrypoint-initdb.d/migrations/99-realtime.sql')]
        self.start_container('db', dict(POSTGRES_PASSWORD=self.password, PGPASSWORD=self.password,
            POSTGRES_DB='postgres', POSTGRES_HOST='/var/run/postgresql', JWT_EXP='7200'),
            ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf', '-c', 'cron.launch_active_jobs=off',
             '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic', '-c', 'logging_collector=off',
             '-c', 'log_min_messages=panic', '-c', 'pg_stat_statements.track=none',
             '-c', 'valorwell.acceptance_disposable=true'], mounts)
        for _ in range(120):
            try:
                process = run(DOCKER + ['exec', self.containers['db'], 'cat', '/proc/1/comm'])
                if 'postgres' in process and self.sql('SELECT 1;') == '1':
                    break
            except Exception:
                pass
            item = json.loads(run(DOCKER + ['inspect', self.containers['db']]))[0]
            if item['State']['Status'] == 'exited':
                # This is before any private application input is loaded.
                lines = [line for line in self.startup_output['db'] if 'ERROR:' in line or 'FATAL:' in line]
                safe = '\n'.join(lines).replace(self.password, '[generated local password]')
                raise RuntimeError('Public managed bootstrap failed: ' + safe)
            time.sleep(0.5)
        else:
            raise RuntimeError('Owned native database not ready')
        self.report['server_version'] = self.sql('SHOW server_version;')
        bridge = bootstrap / 'http-bridge.mjs'
        bridge.write_bytes((Path(__file__).with_name('native') / 'http-bridge.mjs').read_bytes())
        bridge.chmod(0o444)
        self.start_container('transport', {}, ['node', '-e', 'setInterval(()=>{},2147483647)'],
                             [(bridge, '/retest/http-bridge.mjs')])
        self.start_container('auth', dict(GOTRUE_API_HOST='0.0.0.0', GOTRUE_API_PORT='9999',
            API_EXTERNAL_URL='http://127.0.0.1:' + str(self.ports['auth']), GOTRUE_SITE_URL='http://127.0.0.1',
            GOTRUE_DB_DRIVER='postgres', GOTRUE_DB_DATABASE_URL='postgres://supabase_auth_admin:' + self.password + '@db:5432/postgres',
            GOTRUE_JWT_SECRET=self.secret, GOTRUE_JWT_AUD='authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME='authenticated',
            GOTRUE_JWT_ADMIN_ROLES='service_role', GOTRUE_EXTERNAL_EMAIL_ENABLED='true',
            GOTRUE_MAILER_AUTOCONFIRM='true', GOTRUE_SMTP_HOST='127.0.0.1', GOTRUE_SMTP_PORT='9',
            GOTRUE_DISABLE_SIGNUP='false', GOTRUE_RATE_LIMIT_EMAIL_SENT='1000'), port=9999)
        self.wait_service('auth', '/health')
        self.start_container('rest', dict(PGRST_DB_URI='postgres://authenticator:' + self.password + '@db:5432/postgres',
            PGRST_DB_SCHEMAS='public', PGRST_DB_ANON_ROLE='anon', PGRST_JWT_SECRET=self.secret,
            PGRST_DB_USE_LEGACY_GUCS='false', PGRST_DB_EXTRA_SEARCH_PATH='public,extensions'), port=3000)
        self.wait_service('rest', '/')
        self.start_container('storage', dict(ANON_KEY=self.anon_key, SERVICE_KEY=self.service_key,
            POSTGREST_URL='http://rest:3000', AUTH_JWT_SECRET=self.secret,
            DATABASE_URL='postgres://supabase_storage_admin:' + self.password + '@db:5432/postgres',
            STORAGE_BACKEND='file', FILE_STORAGE_BACKEND_PATH='/var/lib/storage', GLOBAL_S3_BUCKET='synthetic',
            TENANT_ID='synthetic', REGION='local', ENABLE_IMAGE_TRANSFORMATION='false'), port=5000)
        self.wait_service('storage', '/status')
        self.start_realtime()

    def start_realtime(self):
        self.start_container('realtime', dict(PORT='4000', DB_HOST='db', DB_PORT='5432', DB_USER='supabase_admin',
            DB_PASSWORD=self.password, DB_NAME='postgres', DB_AFTER_CONNECT_QUERY='SET search_path TO _realtime',
            DB_ENC_KEY=secrets.token_hex(8), API_JWT_SECRET=self.secret, SECRET_KEY_BASE=secrets.token_hex(32),
            METRICS_JWT_SECRET=self.secret, ERL_AFLAGS='-proto_dist inet_tcp +S 2:2 +SDcpu 1 +SDio 1', DNS_NODES="''",
            RLIMIT_NOFILE='10000', APP_NAME='realtime', SEED_SELF_HOST='true', RUN_JANITOR='true',
            DISABLE_HEALTHCHECK_LOGGING='true'), port=4000)
        self.wait_service('realtime', '/api/tenants/realtime-dev/health', self.service_key)
        self.report['gates']['native_foundations'] = 'PASS: actual Auth, Storage, PostgREST and Realtime health checks'
        self.save()

    def cleanup(self):
        failures = []
        for name in reversed(list(self.containers.values())):
            try:
                items = json.loads(run(DOCKER + ['inspect', name]))
                assert_owned(items[0], self.identifier)
                run(DOCKER + ['rm', '-f', '-v', name])
            except Exception:
                failures.append('owned container cleanup failed')
        if self.network_created:
            try:
                item = json.loads(run(DOCKER + ['network', 'inspect', self.network]))[0]
                if item.get('Labels', {}).get(LABEL) != self.identifier:
                    raise ValueError('Ownership mismatch')
                run(DOCKER + ['network', 'rm', self.network])
            except Exception:
                failures.append('owned network cleanup failed')
        self.report['cleanup'] = 'PASS' if not failures else 'BLOCKED'
        self.report['cleanup_blockers'] = failures
        self.save()
        return failures
