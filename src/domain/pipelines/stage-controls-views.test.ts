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
const alternate='55555555-5555-4555-8555-555555555555';
const stage='44444444-4444-4444-8444-444444444444';
const terminal='66666666-6666-4666-8666-666666666666';
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
create table public.relationship_contact_organizations(tenant_id uuid,contact_id uuid,organization_id uuid,is_primary boolean,updated_at timestamptz not null default now());
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
insert into public.relationship_contacts values ('${a}','${contact}','Taylor','Smith'),('${a}','${alternate}','Robin','Lee');
insert into public.relationship_organizations values ('${a}','${org}','Provider Partners');
insert into public.tenant_memberships values ('${u}','${a}');
grant usage on schema auth,private to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.crm_has_relationship_permission(uuid,uuid,text) to authenticated;
grant select on public.crm_user_capabilities,public.relationship_contacts,public.relationship_organizations,
  public.relationship_contact_organizations,public.tenant_memberships to authenticated;
grant insert,update on public.relationship_contact_organizations to authenticated;
grant update on public.relationship_organizations to authenticated;
`;
const read=(file:string)=>readFileSync(resolve(process.cwd(),'supabase/migrations/'+file),'utf8');
describe('secure CRM transition and saved views',()=>{
 it('rejects terminal exits unless allowed, uses optimistic concurrency and audits exactly once',async()=>{
  const db=new PGlite();
  try{
    await db.exec(fixture);
    await db.exec(read('20261009043000_crm_configurable_pipelines.sql'));
    await db.exec(read('20261009190000_pipeline_stage_rules_and_saved_views.sql'));
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u]);
    await db.query(`insert into public.crm_pipelines(id,tenant_id,name,subject_type,created_by)
      values($1,$2,'Partners','organization',$3)`,[pipeline,a,u]);
    await db.query(`insert into public.crm_pipeline_stages(id,tenant_id,pipeline_id,name,position,is_terminal)
      values($1,$2,$3,'Identified',0,false),($4,$2,$3,'Finished',1,true)`,
      [stage,a,pipeline,terminal]);
    await db.query(`insert into public.relationship_contact_organizations(tenant_id,contact_id,organization_id,is_primary)
      values($1,$2,$3,true)`,[a,contact,org]);
    const created=await db.query<{id:string,version:number}>(`insert into public.crm_pipeline_records
       (tenant_id,pipeline_id,stage_id,organization_id) values($1,$2,$3,$4) returning id,version`,[a,pipeline,stage,org]);
    const id=created.rows[0].id;
    const moved=await db.query<{version:number}>(`select public.crm_move_manual_pipeline_record($1,$2,$3) version`,[id,1,terminal]);
    expect(Number(moved.rows[0].version)).toBe(2);
    await expect(db.query(`select public.crm_move_manual_pipeline_record($1,$2,$3)`,[id,1,stage]))
      .rejects.toThrow(/VERSION_CONFLICT/);
    await expect(db.query(`select public.crm_move_manual_pipeline_record($1,$2,$3)`,[id,2,stage]))
      .rejects.toThrow(/TRANSITION_BLOCKED/);
    await db.query(`insert into public.crm_pipeline_stage_rules
      (tenant_id,pipeline_id,from_stage_id,to_stage_id,is_allowed)
      values($1,$2,$3,$4,true)`,[a,pipeline,terminal,stage]);
    const back=await db.query<{version:number}>(`select public.crm_move_manual_pipeline_record($1,$2,$3) version`,[id,2,stage]);
    expect(Number(back.rows[0].version)).toBe(3);
    const hist=await db.query<{n:number}>(`select count(*)::int n from public.crm_pipeline_stage_events where record_id=$1`,[id]);
    expect(hist.rows[0].n).toBe(3); // enrolled + two successful moves, rejected moves not audited
    await db.query(`update public.crm_pipeline_records set owner_profile_id=$1,
      next_action='Call partner',next_action_due_at='2026-10-15T15:00:00Z'
      where id=$2 and version=3`,[u,id]);
    const updated=await db.query<{owner_profile_id:string;next_action:string;version:number}>(`select
      owner_profile_id,next_action,version from public.crm_pipeline_records where id=$1`,[id]);
    expect(updated.rows[0]).toMatchObject({owner_profile_id:u,next_action:'Call partner',version:4});
    expect((await db.query(`select id from public.crm_pipeline_stage_events where record_id=$1`,[id])).rows).toHaveLength(3);
    await expect(db.query(`update public.crm_pipeline_records set owner_profile_id=$1 where id=$2`,[other,id]))
      .rejects.toThrow(/OWNER_CROSS_TENANT/);

    await db.query(`insert into public.crm_pipeline_stage_rules
      (tenant_id,pipeline_id,from_stage_id,to_stage_id,is_allowed)
      values($1,$2,$3,$4,false)`,[a,pipeline,stage,terminal]);
    await expect(db.query(`update public.crm_pipeline_records set stage_id=$1 where id=$2`,[terminal,id]))
      .rejects.toThrow(/TRANSITION_BLOCKED/); // Data API direct updates cannot bypass rules
  }finally{await db.close();}
 },60000);
 it('user-owned saved view, allowed sorts, and cross-tenant RLS',async()=>{
  const db=new PGlite();
  try{
    await db.exec(fixture);
    await db.exec(read('20261009043000_crm_configurable_pipelines.sql'));
    await db.exec(read('20261009190000_pipeline_stage_rules_and_saved_views.sql'));
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u]);
    await db.query(`insert into public.crm_pipelines(id,tenant_id,name,subject_type,created_by)
      values($1,$2,'Partners','organization',$3)`,[pipeline,a,u]);
    await db.query(`insert into public.crm_pipeline_stages(id,tenant_id,pipeline_id,name,position)
      values($1,$2,$3,'Identified',0)`,[stage,a,pipeline]);
    await db.query(`insert into public.crm_pipeline_saved_views(tenant_id,pipeline_id,owner_profile_id,
      name,view_mode,sort_key,search_text,attention,owner_filter)
      values($1,$2,$3,'My overdue','list','updated_at','south','overdue','mine')`,[a,pipeline,u]);
    await expect(db.query(`insert into public.crm_pipeline_saved_views(tenant_id,pipeline_id,owner_profile_id,
      name,sort_key)values($1,$2,$3,'Invalid','unlisted')`,[a,pipeline,u]))
      .rejects.toThrow(/SORT_NOT_ALLOWED/);
    const rows=await db.query<{view_mode:string;owner_filter:string}>(`select view_mode,owner_filter from public.crm_pipeline_saved_views`);
    expect(rows.rows).toEqual([{view_mode:'list',owner_filter:'mine'}]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    expect((await db.query(`select id from public.crm_pipeline_saved_views`)).rows).toHaveLength(0);
    await expect(db.query(`insert into public.crm_pipeline_saved_views(tenant_id,pipeline_id,owner_profile_id,name)
      values($1,$2,$3,'Impersonated')`,[a,pipeline,u])).rejects.toThrow();
  }finally{await db.close();}
 },60000);
});
