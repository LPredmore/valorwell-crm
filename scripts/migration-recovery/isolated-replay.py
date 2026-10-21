"""Run a reviewed cutover in an owned, internal-network genuine Supabase stack.

No remote URLs, production keys, linked project operations or history repair.
Requires a separately reviewed full baseline; missing inputs fail before startup.
This performs SQL/catalog acceptance only, NOT signed-JWT worker acceptance.
"""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from recovery import baseline_gate, compare_catalogs, digest, evidence_digest, release_sources, validate_acl_rows
from private_restore import load_private_bundle, private_path


def run(command, input_text=None):
    # Never pass ambient production PG/Supabase/provider credentials to commands.
    allowed = {'PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'DOCKER_CONFIG', 'XDG_CONFIG_HOME'}
    env = {key: value for key, value in os.environ.items() if key in allowed}
    env['SUPABASE_DISABLE_TELEMETRY'] = '1'
    return subprocess.run(command, input=input_text, text=True, capture_output=True, check=True, env=env)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path,required=True)
    parser.add_argument('--cutover-manifest',type=Path,required=True)
    parser.add_argument('--ledger',type=Path,required=True)
    parser.add_argument('--source-catalog',type=Path,required=True)
    parser.add_argument('--reviewed-parity-diff',type=Path,required=True)
    parser.add_argument('--repo',action='append',default=[],metavar='NAME=PATH')
    parser.add_argument('--with-stedi',action='store_true')
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--private-bundle',type=Path,required=True,
                        help='Reviewed operator-private evidence root; no legacy partial-baseline bypass')
    parser.add_argument('--restore-only',action='store_true')
    parser.add_argument('--keep-stack-for-signed-tests',action='store_true')
    args=parser.parse_args()
    repository=Path(__file__).resolve().parents[2]
    bundle=load_private_bundle(args.private_bundle,repository)
    if any(Path(value).resolve()!=bundle[key].resolve() for value,key in [
        (args.baseline,'baseline'),(args.ledger,'ledger'),(args.source_catalog,'catalog'),
        (args.reviewed_parity_diff,'parity')]):
        parser.error('CLI inputs differ from reviewed private bundle')
    if args.cutover_manifest.resolve()!=bundle['root']/'reviewed-cutover.json':
        parser.error('Manifest differs from private bundle')
    if args.output_dir.resolve()!=bundle['root']/'isolated-results' or args.output_dir.exists():
        parser.error('Use a fresh isolated-results directory inside the private root')
    manifest=json.loads(args.cutover_manifest.read_text())
    ledger=json.loads(args.ledger.read_text())
    blockers=baseline_gate(manifest,args.baseline,ledger,json.loads(args.reviewed_parity_diff.read_text()))
    if blockers:
        parser.error('Baseline BLOCKED: '+ '; '.join(blockers))
    source_catalog=json.loads(args.source_catalog.read_text())
    if not source_catalog or manifest.get('source_catalog_sha256') != evidence_digest(source_catalog):
        parser.error('Complete source catalog hash differs or missing')
    catalog_path=Path(__file__).with_name('catalog-fingerprints.sql')
    gate=Path(__file__).resolve().parents[2]/'docs/architecture/2026-10-19-security-acl-acceptance.sql'
    for key,path in [('catalog_query_sha256',catalog_path),('acl_query_sha256',gate)]:
        if manifest.get(key)!=digest(path.read_bytes()): parser.error('Reviewed verification query hash differs: '+key)
    releases=[] if args.restore_only else release_sources(dict(v.split('=',1) for v in args.repo),args.with_stedi)
    # Full release source must be explicitly reviewed, including draft opt-in.
    expected=[dict(version=r['version'],sha256=r['sha256']) for r in releases]
    if not args.restore_only and manifest.get('reviewed_release_sources') != expected:
        parser.error('Ordered release source hashes have not been reviewed')
    if any(r['version'] in bundle['latest_versions'] for r in releases):
        parser.error('Security release contains already covered historical versions')
    for name in ['supabase','docker']:
        if shutil.which(name) is None: parser.error(f'{name} CLI required; plain PostgreSQL is not a Supabase substitute')
    if run(['supabase','--version']).stdout.strip() != manifest.get('supabase_cli_version'):
        parser.error('Supabase CLI version differs from reviewed stack')
    context=json.loads(run(['docker','context','inspect']).stdout)[0]
    host=context.get('Endpoints',{}).get('docker',{}).get('Host','')
    if not host.startswith(('unix://','npipe://')):
        parser.error('Local Docker socket required; remote Docker contexts forbidden')
    if run(['docker','info','--format','{{.LoggingDriver}}']).stdout.strip()!='none':
        parser.error('Dedicated local Docker daemon must use logging driver none before private SQL')
    if args.output_dir.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        parser.error('Private replay output must be outside the repository')
    os.umask(0o077)
    args.output_dir.mkdir(parents=True,exist_ok=False)
    report=dict(scope='SQL/catalog only; independent signed JWT suites still required',
                baseline_sha256=digest(args.baseline.read_bytes()),migrations=[],status='STARTING',
                rollback='destroy owned isolated stack; no production writes')
    root=Path(tempfile.mkdtemp(prefix='valorwell-replay-',dir=bundle['root']))
    identifier='vw-replay-'+uuid.uuid4().hex[:12]
    network=identifier+'-internal'
    network_created=False
    started=False
    container=None
    stage='initialization'
    sql_complete=False
    def save():
        (args.output_dir/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    def sql(text):
        if container is None: raise RuntimeError('Owned Supabase database not identified')
        # All writes enter this owned container, never psql's ambient PG environment.
        return run(['docker','exec','-i',container,'psql','-X','-qAt','-U','postgres',
                    '-d','postgres','-v','ON_ERROR_STOP=1'],text).stdout.strip()
    try:
        run(['supabase','init','--workdir',str(root),'--yes'])
        config=root/'supabase/config.toml'
        text=config.read_text()
        import re
        text=re.sub(r'(?m)^project_id\s*=.*$',f'project_id = "{identifier}"',text,count=1)
        # Do not start outbound-capable email services. Managed Auth/Storage remain.
        config.write_text(text)
        run(['docker','network','create','--internal','--opt',
             'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network]); network_created=True
        stage='Supabase startup'
        started=True
        # Edge runtime/queues are never started. Genuine Auth/Storage/PostgREST stay.
        run(['supabase','start','--workdir',str(root),'--network-id',network,
             '--exclude','edge-runtime,logflare,vector,studio,postgres-meta,imgproxy,realtime,supavisor,inbucket'])
        container='supabase_db_'+identifier
        inspect=json.loads(run(['docker','inspect',container]).stdout)[0]
        owned=run(['docker','ps','-q','--filter','name=supabase_']).stdout.splitlines()
        owned_inspects=json.loads(run(['docker','inspect',*owned]).stdout) if owned else []
        for item in owned_inspects:
            if not item['Name'].endswith('_'+identifier): continue
            if set(item['NetworkSettings']['Networks']) != {network}:
                raise RuntimeError('Owned container has additional network access')
            if item['HostConfig']['LogConfig']['Type']!='none':
                raise RuntimeError('All owned containers must disable Docker logging before private SQL')
            for bindings in item['NetworkSettings']['Ports'].values():
                if any(b.get('HostIp') not in ('127.0.0.1','::1') for b in bindings or []):
                    raise RuntimeError('Owned container exposes non-loopback ports; configure local-only binds before retry')
        inspected_network=json.loads(run(['docker','network','inspect',network]).stdout)[0]
        if not inspected_network.get('Internal'): raise RuntimeError('Provider egress must be disabled')
        report['database_image']=inspect['Config']['Image']
        if report['database_image'] != manifest.get('supabase_database_image'):
            raise RuntimeError('Database image differs from reviewed Supabase version')
        if sql("SELECT current_setting('server_version');").split()[0]!='17.6':
            raise RuntimeError('Exact PostgreSQL 17.6 required')
        # Prevent SQL/error statement persistence; no raw error files are written.
        for setting,value in [('log_statement','none'),('log_min_error_statement','panic'),
                              ('log_min_messages','panic'),('log_statement_sample_rate','0'),
                              ('log_min_duration_statement','-1'),('log_min_duration_sample','-1'),
                              ('logging_collector','off'),('cron.launch_active_jobs','off')]:
            sql(f"ALTER SYSTEM SET {setting} = '{value}';")
        sql('SELECT pg_reload_conf();')
        if sql('SHOW cron.launch_active_jobs;')!='off':
            raise RuntimeError('Cron scheduler not disabled')
        stage='reviewed managed dependency reconciliation'
        sql(bundle['managed'].read_text())
        dependency_sql="""SELECT jsonb_build_object(
          'auth_uid',to_regprocedure('auth.uid()') IS NOT NULL,
          'auth_users',to_regclass('auth.users') IS NOT NULL,
          'storage_objects',to_regclass('storage.objects') IS NOT NULL,
          'vault_secrets',to_regclass('vault.secrets') IS NOT NULL,
          'roles',(SELECT count(*)=3 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
          'extensions',(SELECT jsonb_object_agg(extname,extversion) FROM pg_extension));"""
        deps=json.loads(sql(dependency_sql));report['managed_dependencies']=deps
        if not all(deps[k] for k in ['auth_uid','auth_users','storage_objects','vault_secrets','roles']):
            raise RuntimeError('Genuine managed dependency missing')
        for name,version in manifest.get('required_extensions',{}).items():
            if deps['extensions'].get(name)!=version: raise RuntimeError(f'Missing exact extension: {name}')
        # Scheduler execution is disabled before any application definitions/data.
        sql("ALTER SYSTEM SET cron.launch_active_jobs = 'off';")
        sql("SELECT pg_reload_conf();")
        if sql("SHOW cron.launch_active_jobs;") != 'off': raise RuntimeError('Cron scheduler not disabled')
        stage='baseline application'
        sql(args.baseline.read_text())
        # No synthetic migration ledger marking: coverage belongs to cutover artifact.
        stage='baseline catalog parity'
        catalog_sql=catalog_path.read_text()
        restored=json.loads(sql(catalog_sql))
        diff=compare_catalogs(source_catalog,restored)
        (args.output_dir/'baseline-parity.json').write_text(json.dumps(diff,indent=2)+'\n')
        if any(diff.values()): raise RuntimeError('Restored baseline object parity differs')
        stage='post-export incremental migrations'
        for entry in bundle['increments']:
            source=Path(entry['path']).read_bytes()
            if digest(source)!=entry['sha256']:
                raise RuntimeError('Incremental source changed after review')
            sql(source.decode('utf-8'))
            report['migrations'].append(dict(version=entry['version'],sha256=entry['sha256'],status='SQL_APPLIED_IN_ISOLATION'))
        # No historical ledger entries are inserted at any point.
        stage='ordered security release'
        for entry in releases:
            stage=entry['version']
            row=dict(version=entry['version'],sha256=entry['sha256'],status='RUNNING')
            report['migrations'].append(row);save()
            sql(Path(entry['path']).read_text())
            row['status']='SQL_APPLIED_IN_ISOLATION';save()
        if not args.restore_only:
            stage='14 RPC ACL gate'
            acl=sql(gate.read_text()).splitlines()
            import re
            signatures=re.findall(r"\('(public\.[^']+)',(?:false|true)\)",gate.read_text())
            if not validate_acl_rows(acl,signatures):
                raise RuntimeError('14/14 ACL acceptance not satisfied')
            report['acl_gate']='14/14 PASS'
        else:
            report['acl_gate']='NOT_RUN_RESTORE_ONLY'
        sql_complete=True
        report['status']='SQL_CATALOG_PASS_SIGNED_ACCEPTANCE_PENDING'
    except Exception as error:
        report['status']='BLOCKED'
        report['first_failure_stage']=stage
        # Raw diagnostics may contain function bodies, secrets or local keys: discard.
        # Stage is also not printed because migration identifiers originate in inputs.
        raise SystemExit('Replay blocked; metadata-only private results retained') from None
    finally:
        cleanup=[]
        retain=sql_complete and args.keep_stack_for_signed_tests
        if started and not retain:
            try:run(['supabase','stop','--workdir',str(root),'--no-backup'])
            except subprocess.CalledProcessError:cleanup.append('owned Supabase cleanup failed; operator must inspect '+identifier)
        if network_created and not retain:
            try:run(['docker','network','rm',network])
            except subprocess.CalledProcessError:cleanup.append('owned internal network cleanup failed: '+network)
        if retain:
            report['retained_workdir']=str(root)
            report['owned_identifier']=identifier
            report['owned_network']=network
            report['signed_jwt_acceptance']='NOT_RUN; operator must run independent suites on this exact stack'
            report['cleanup_commands']=[['supabase','stop','--workdir',str(root),'--no-backup'],
                                        ['docker','network','rm',network]]
        elif cleanup:
            report['status']='BLOCKED_CLEANUP'
            report['retained_workdir']=str(root)
        else:
            shutil.rmtree(root)
        report['cleanup_blockers']=cleanup;save()
        if cleanup: raise SystemExit('Owned resource cleanup blocked; private results include recovery identifiers')
    print(report['status'])


if __name__=='__main__':
    main()