// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';

const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const u='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const other='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const org='11111111-1111-4111-8111-111111111111';
const contact='22222222-2222-4222-8222-222222222222';
const pipeline='33333333-3333-4333-8333-333333333333';
const stage='44444444-4444-4444-8444-444444444444';
const fixture=`
create role authenticated; create role anon; create role service_role;
create schema auth;create schema private;
create function auth.uid() returns uuid language sql stable as
  $b$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $b$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key);
create table public.crm_user_capabilities(profile_id uuid,tenant_id uuid,crm_role text);
create table public.relationship_contacts(tenant_id uuid,id uuid,first_name text,last_name text,
  primary key(tenant_id,id));
create table public.relationship_organizations(tenant_id uuid,id uuid,name text,
  primary key(tenant_id,id));
create table public.relationship_contact_organizations(tenant_id uuid,contact_id uuid,organization_id uuid,is_primary boolean);
create table public.tenant_memberships(profile_id uuid,tenant_id uuid);
create function private.crm_has_relationship_permission(p_user uuid,p_tenant uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $b$select p_user=auth.uid() and exists(select 1 from public.crm_user_capabilities
where profile_id=p_user and tenant_id=p_tenant and
crm_role in ('crm_admin','crm_operator','crm_readonly') and
(p_permission='view_relationships' or crm_role in ('crm_admin','crm_operator')))$b$;
insert into public.tenants values ('${a}'),('${b}');
insert into public.profiles values ('${u}'),('${other}');
insert into public.crm_user_capabilities values ('${u}','${a}','crm_admin');
insert into public.relationship_contacts values ('${a}','${contact}','Taylor','Smith');
insert into public.relationship_organizations values ('${a}','${org}','Provider Partners');
insert into public.tenant_memberships values ('${u}','${a}');
grant usage on schema auth,private to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.crm_has_relationship_permission(uuid,uuid,text) to authenticated;
grant select on public.crm_user_capabilities,public.relationship_contacts,public.relationship_organizations,
  public.relationship_contact_organizations,public.tenant_memberships to authenticated;
grant insert on public.relationship_contact_organizations to authenticated;
`;

describe('pipeline migration with embedded PostgreSQL',()=>{
  it('isolates tenant, enforces canonical organization primary and protects configured fields',async()=>{
    const db=new PGlite();
    try{
      await db.exec(fixture);
      await db.exec(readFileSync(resolve(process.cwd(),
        'supabase/migrations/20261009043000_crm_configurable_pipelines.sql'),'utf8'));
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u]);
      await db.query(`insert into public.crm_pipelines(id,tenant_id,name,subject_type,created_by)
        values($1,$2,'Partners','organization',$3)`,[pipeline,a,u]);
      await db.query(`insert into public.crm_pipeline_stages(id,tenant_id,pipeline_id,name,position)
        values($1,$2,$3,'Identified',0)`,[stage,a,pipeline]);
      await expect(db.query(`insert into public.crm_pipeline_records(tenant_id,pipeline_id,stage_id,organization_id)
        values($1,$2,$3,$4)`,[a,pipeline,stage,org]))
        .rejects.toThrow(/PRIMARY_CONTACT/);
      await db.query(`insert into public.relationship_contact_organizations values($1,$2,$3,true)`,[a,contact,org]);
      await db.query(`insert into public.crm_pipeline_records(tenant_id,pipeline_id,stage_id,organization_id)
        values($1,$2,$3,$4)`,[a,pipeline,stage,org]);
      expect((await db.query('select id from public.crm_pipeline_records')).rows).toHaveLength(1);
      await expect(db.query(`insert into public.crm_pipeline_records(tenant_id,pipeline_id,stage_id,organization_id)
        values($1,$2,$3,$4)`,[b,pipeline,stage,org])).rejects.toThrow();
      await expect(db.query(`update public.crm_pipelines set subject_type='person' where id=$1`,[pipeline]))
        .rejects.toThrow(/IMMUTABLE/);
      await expect(db.query(`update public.crm_pipelines set sort_field_keys=array['unverified'] where id=$1`,[pipeline]))
        .rejects.toThrow(/SORT_FIELD/);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
      expect((await db.query('select id from public.crm_pipelines')).rows).toHaveLength(0);
      expect((await db.query('select id from public.crm_pipeline_records')).rows).toHaveLength(0);
    }finally{await db.close();}
  },60000);
});
