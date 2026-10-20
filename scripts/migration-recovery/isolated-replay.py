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


def run(command, input_text=None):
    return subprocess.run(command, input=input_text, text=True, capture_output=True, check=True)


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
    args=parser.parse_args()
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
    releases=release_sources(dict(v.split('=',1) for v in args.repo),args.with_stedi)
    # Full release source must be explicitly reviewed, including draft opt-in.
    expected=[dict(version=r['version'],sha256=r['sha256']) for r in releases]
    if manifest.get('reviewed_release_sources') != expected:
        parser.error('Ordered release source hashes have not been reviewed')
    for name in ['supabase','docker']:
        if shutil.which(name) is None: parser.error(f'{name} CLI required; plain PostgreSQL is not a Supabase substitute')
    if run(['supabase','--version']).stdout.strip() != manifest.get('supabase_cli_version'):
        parser.error('Supabase CLI version differs from reviewed stack')
    if args.output_dir.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        parser.error('Private replay output must be outside the repository')
    os.umask(0o077)
    args.output_dir.mkdir(parents=True,exist_ok=False)
    report=dict(scope='SQL/catalog only; independent signed JWT suites still required',
                baseline_sha256=digest(args.baseline.read_bytes()),migrations=[],status='STARTING',
                rollback='destroy owned isolated stack; no production writes')
    root=Path(tempfile.mkdtemp(prefix='valorwell-replay-'))
    identifier='vw-replay-'+uuid.uuid4().hex[:12]
    network=identifier+'-internal'
    network_created=False
    started=False
    container=None
    stage='initialization'
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
        text += '\n[experimental]\n' if '[experimental]' not in text else ''
        config.write_text(text)
        run(['docker','network','create','--internal',network]); network_created=True
        stage='Supabase startup'
        started=True
        # Edge runtime/queues are never started. Genuine Auth/Storage/PostgREST stay.
        run(['supabase','start','--workdir',str(root),'--network-id',network,
             '--exclude','edge-runtime,logflare,vector,studio,postgres-meta,imgproxy,realtime,supavisor'])
        container='supabase_db_'+identifier
        inspect=json.loads(run(['docker','inspect',container]).stdout)[0]
        owned=run(['docker','ps','-q','--filter','name=supabase_']).stdout.splitlines()
        owned_inspects=json.loads(run(['docker','inspect',*owned]).stdout) if owned else []
        for item in owned_inspects:
            if not item['Name'].endswith('_'+identifier): continue
            if set(item['NetworkSettings']['Networks']) != {network}:
                raise RuntimeError('Owned container has additional network access')
            for bindings in item['NetworkSettings']['Ports'].values():
                if any(b.get('HostIp') not in ('127.0.0.1','::1') for b in bindings or []):
                    raise RuntimeError('Owned container exposes non-loopback ports; configure local-only binds before retry')
        inspected_network=json.loads(run(['docker','network','inspect',network]).stdout)[0]
        if not inspected_network.get('Internal'): raise RuntimeError('Provider egress must be disabled')
        report['database_image']=inspect['Config']['Image']
        if report['database_image'] != manifest.get('supabase_database_image'):
            raise RuntimeError('Database image differs from reviewed Supabase version')
        dependency_sql="""SELECT jsonb_build_object(
          'auth_uid',to_regprocedure('auth.uid()') IS NOT NULL,
          'auth_users',to_regclass('auth.users') IS NOT NULL,
          'storage_objects',to_regclass('storage.objects') IS NOT NULL,
          'roles',(SELECT count(*)=3 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
          'extensions',(SELECT jsonb_object_agg(extname,extversion) FROM pg_extension));"""
        deps=json.loads(sql(dependency_sql));report['managed_dependencies']=deps
        if not all(deps[k] for k in ['auth_uid','auth_users','storage_objects','roles']):
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
        stage='ordered security release'
        for entry in releases:
            stage=entry['version']
            row=dict(version=entry['version'],sha256=entry['sha256'],status='RUNNING')
            report['migrations'].append(row);save()
            sql(Path(entry['path']).read_text())
            row['status']='SQL_APPLIED_IN_ISOLATION';save()
        stage='14 RPC ACL gate'
        acl=sql(gate.read_text()).splitlines()
        report['acl_rows']=acl
        import re
        signatures=re.findall(r"\('(public\.[^']+)',(?:false|true)\)",gate.read_text())
        if not validate_acl_rows(acl,signatures):
            raise RuntimeError('14/14 ACL acceptance not satisfied')
        report['status']='SQL_CATALOG_PASS_SIGNED_ACCEPTANCE_PENDING'
    except Exception as error:
        report['status']='BLOCKED'
        report['first_failure_stage']=stage
        # Raw diagnostics may contain function bodies, secrets or local keys.
        private=args.output_dir/'private-failure.txt'
        private.write_text((error.stderr or error.stdout or 'command failed') if isinstance(error,subprocess.CalledProcessError) else str(error))
        raise SystemExit('Replay blocked at '+stage+'; private diagnostics retained outside source') from None
    finally:
        cleanup=[]
        if started:
            try:run(['supabase','stop','--workdir',str(root),'--no-backup'])
            except subprocess.CalledProcessError:cleanup.append('owned Supabase cleanup failed; operator must inspect '+identifier)
        if network_created:
            try:run(['docker','network','rm',network])
            except subprocess.CalledProcessError:cleanup.append('owned internal network cleanup failed: '+network)
        if cleanup:
            report['status']='BLOCKED_CLEANUP'
            report['retained_workdir']=str(root)
        else:
            shutil.rmtree(root)
        report['cleanup_blockers']=cleanup;save()
        if cleanup: raise SystemExit('Owned resource cleanup blocked; private results include recovery identifiers')
    print(report['status'])


if __name__=='__main__':
    main()