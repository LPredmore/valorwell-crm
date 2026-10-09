// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';

const tenant='00000000-0000-0000-0000-000000000001';
const otherTenant='00000000-0000-0000-0000-000000000002';
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const outsider='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const contact='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const organization='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const research='11111111-1111-4111-8111-111111111111';
const va='22222222-2222-4222-8222-222222222222';
const path=(s:string)=>readFileSync(resolve(process.cwd(),'supabase/migrations/'+s),'utf8');
const fixture=`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as
  $b$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $b$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key);
create table public.crm_user_capabilities(profile_id uuid,tenant_id uuid,crm_role text,granted_at timestamptz default now());
create table public.tenant_memberships(profile_id uuid,tenant_id uuid);
create table public.relationship_contacts(
  tenant_id uuid,id uuid primary key default gen_random_uuid(),
  first_name text,last_name text,email text,source text,source_record_key text,
  created_by_profile_id uuid,updated_by_profile_id uuid,unique(tenant_id,id));
create table public.relationship_organizations(
  tenant_id uuid,id uuid primary key default gen_random_uuid(),
  name text,website text,headquarters_state text,organization_kind text,
  source text,source_record_key text,created_by_profile_id uuid,updated_by_profile_id uuid,
  unique(tenant_id,id));
create table public.relationship_contact_organizations(
  tenant_id uuid,contact_id uuid,organization_id uuid,role_title text,
  is_primary boolean,updated_at timestamptz default now());
create table public.relationship_institutional_recruiting_targets(
  id uuid primary key,tenant_id uuid,organization_name text,state_code text,organization_type text,
  specific_office text,website text,contact_name text,contact_email text,
  relationship_organization_id uuid,updated_at timestamptz default now());
create table public.crm_va_vaccn_referral_contacts(
  id uuid primary key,tenant_id uuid,facility_name text,state text,visn int2,
  station_number text,contact_role text,updated_at timestamptz default now());
create function private.crm_has_relationship_permission(p_user uuid,p_tenant uuid,p_permission text)
 returns boolean language sql stable security definer set search_path=''
 as $b$select p_user=auth.uid() and exists(select 1 from public.crm_user_capabilities c
   where c.tenant_id=p_tenant and c.profile_id=p_user
     and (c.crm_role='crm_admin' or (c.crm_role='crm_operator' and p_permission in ('view_relationships','edit_relationships'))))$b$;
insert into public.tenants values('${tenant}'),('${otherTenant}');
insert into public.profiles values('${admin}'),('${outsider}');
insert into public.crm_user_capabilities values('${admin}','${tenant}','crm_admin',now());
insert into public.tenant_memberships values('${admin}','${tenant}');
insert into public.relationship_contacts(tenant_id,id,first_name,last_name,email)
 values('${tenant}','${contact}','Terry','Jones','terry@example.org');
insert into public.relationship_organizations(tenant_id,id,name)
 values('${tenant}','${organization}','Existing Association');
insert into public.relationship_institutional_recruiting_targets(
 id,tenant_id,organization_name,state_code,organization_type,specific_office,website,contact_name,contact_email)
 values('${research}','${tenant}','New Workforce Academy','MO','school','Career Office',
   'https://example.org','Anna Adams','anna@example.org');
insert into public.crm_va_vaccn_referral_contacts(id,tenant_id,facility_name,state,visn,station_number,contact_role)
 values('${va}','${tenant}','Regional VA Medical Center','MO',15,'568','Community Care');
grant usage on schema auth,private to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.crm_has_relationship_permission(uuid,uuid,text) to authenticated;
grant select,insert,update on public.relationship_contacts,public.relationship_organizations,
 public.relationship_contact_organizations,public.relationship_institutional_recruiting_targets,
 public.crm_va_vaccn_referral_contacts,public.tenant_memberships,public.crm_user_capabilities to authenticated;
`;

describe('source reconciliation is tenant safe and keeps one global primary',()=>{
  it('requires primary for existing organization, creates one new primary explicitly, and retries safely',async()=>{
    const db=new PGlite();
    try{
      await db.exec(fixture);
      await db.exec(path('20261009043000_crm_configurable_pipelines.sql'));
      await db.exec(path('20261009062000_seed_valorwell_pipeline_configuration.sql'));
      await db.exec(path('20261009062500_crm_personal_pipeline_optional_organization.sql'));
      await db.exec(path('20261009114500_crm_research_pipeline_reconciliation.sql'));
      const inst=(await db.query<{id:string}>(`select id from public.crm_pipelines where name='Institutional Recruiting'`)).rows[0].id;
      const vaPipeline=(await db.query<{id:string}>(`select id from public.crm_pipelines where name='VA Medical Centers'`)).rows[0].id;
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
      await expect(db.query('select public.crm_enroll_research_source($1,$2,$3)',[inst,research,organization]))
        .rejects.toThrow(/EXACTLY_ONE_PRIMARY/);
      await db.query(`insert into public.relationship_contact_organizations(tenant_id,contact_id,organization_id,is_primary)
        values($1,$2,$3,true)`,[tenant,contact,organization]);
      const first=await db.query<{id:string}>(`select public.crm_enroll_research_source($1,$2,$3) id`,[inst,research,organization]);
      expect(first.rows).toHaveLength(1);
      const again=await db.query<{id:string}>(`select public.crm_enroll_research_source($1,$2,$3) id`,[inst,research,organization]);
      expect(again.rows[0].id).toEqual(first.rows[0].id);
      expect((await db.query('select id from public.crm_pipeline_records')).rows).toHaveLength(1);
      await expect(db.query(`select public.crm_enroll_research_source($1,$2,$3)`,[vaPipeline,research,organization]))
        .rejects.toThrow(/SOURCE_NOT_FOUND/);
      const result=await db.query<{id:string}>(`select public.crm_create_research_organization($1,$2,$3,$4) id`,
        [vaPipeline,va,'Maya Johnson','maya@example.org']);
      expect(result.rows[0].id).toBeTruthy();
      const primary=await db.query<{organization_id:string}>(`select organization_id from public.relationship_contact_organizations
        where is_primary and organization_id=$1`,[result.rows[0].id]);
      expect(primary.rows).toHaveLength(1);
      expect((await db.query('select id from public.crm_pipeline_records')).rows).toHaveLength(2);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);
      await expect(db.query(`select public.crm_enroll_research_source($1,$2,$3)`,[inst,research,organization]))
        .rejects.toThrow(/NOT_AUTHORIZED/);
    }finally{await db.close();}
  },60000);
});
