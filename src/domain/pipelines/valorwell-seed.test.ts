// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';

const base=readFileSync(resolve(process.cwd(),'supabase/migrations/20261009043000_crm_configurable_pipelines.sql'),'utf8');
const seed=readFileSync(resolve(process.cwd(),'supabase/migrations/20261009062000_seed_valorwell_pipeline_configuration.sql'),'utf8');
const association=readFileSync(resolve(process.cwd(),'supabase/migrations/20261009062500_crm_personal_pipeline_optional_organization.sql'),'utf8');
const tenant='00000000-0000-0000-0000-000000000001';
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fixture=`
create role authenticated;create role anon;create role service_role;
create schema private;create schema auth;
create function auth.uid() returns uuid language sql stable
 as $b$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$b$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key);
create table public.crm_user_capabilities(profile_id uuid,tenant_id uuid,crm_role text,granted_at timestamptz default now());
create table public.relationship_contacts(tenant_id uuid,id uuid,primary key(tenant_id,id));
create table public.relationship_organizations(tenant_id uuid,id uuid,primary key(tenant_id,id));
create table public.relationship_contact_organizations(tenant_id uuid,contact_id uuid,organization_id uuid,is_primary boolean,
 updated_at timestamptz default now());
create table public.tenant_memberships(profile_id uuid,tenant_id uuid);
create function private.crm_has_relationship_permission(p_user uuid,p_tenant uuid,p_permission text)
 returns boolean language sql stable as $b$ select true $b$;
insert into public.tenants values ('${tenant}');
insert into public.profiles values ('${admin}');
insert into public.crm_user_capabilities values ('${admin}','${tenant}','crm_admin',now());
`;
describe('ValorWell seven pipeline seed is data, not hardcoded application logic',()=>{
  it('creates seven configurable tenant pipelines, retains stage identity, and is idempotent',async()=>{
    const db=new PGlite();
    try{
      await db.exec(fixture);
      await db.exec(base);
      await db.exec(association);
      await db.exec(seed);
      const rows=await db.query<{name:string;subject_type:string;source_mode:string;source_key:string|null}>(
        'select name,subject_type,source_mode,source_key from public.crm_pipelines order by name');
      expect(rows.rows).toHaveLength(7);
      expect(rows.rows.find(p=>p.name==='Donors')).toMatchObject({subject_type:'person',source_mode:'manual'});
      expect(rows.rows.find(p=>p.name==='Beyond The Yellow')).toMatchObject({subject_type:'organization',source_mode:'connected',source_key:'relationship_opportunities'});
      expect(rows.rows.find(p=>p.name==='Hired Clinicians')).toMatchObject({subject_type:'person',source_mode:'connected',source_key:'staff'});
      const stageCounts=await db.query<{name:string;count:number}>(
        'select p.name,count(s.id)::int count from public.crm_pipelines p join public.crm_pipeline_stages s on s.pipeline_id=p.id group by p.name order by p.name');
      expect(stageCounts.rows.find(x=>x.name==='Prospective Clinicians')?.count).toBe(6);
      expect(stageCounts.rows.find(x=>x.name==='Hired Clinicians')?.count).toBe(4);
      expect(stageCounts.rows.find(x=>x.name==='Clients')?.count).toBe(8);
      expect(stageCounts.rows.find(x=>x.name==='Beyond The Yellow')?.count).toBe(13);
      expect(stageCounts.rows.reduce((sum,row)=>sum+row.count,0)).toBe(49);
      const totalFields=await db.query<{c:number}>('select count(*)::int c from public.crm_pipeline_fields');
      expect(totalFields.rows[0].c).toBe(20);
      const donor=await db.query<{id:string}>("select id from public.crm_pipelines where name='Donors'");
      const first=await db.query<{id:string}>("select id from public.crm_pipeline_stages where pipeline_id=$1 and position=0",[donor.rows[0].id]);
      const person='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const organization='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      await db.query('insert into public.relationship_contacts(tenant_id,id) values($1,$2)',[tenant,person]);
      await db.query('insert into public.relationship_organizations(tenant_id,id) values($1,$2)',[tenant,organization]);
      await db.query(`insert into public.crm_pipeline_records(tenant_id,pipeline_id,stage_id,contact_id,associated_organization_id)
        values($1,$2,$3,$4,$5)`,[tenant,donor.rows[0].id,first.rows[0].id,person,organization]);
      expect((await db.query<{associated_organization_id:string}>('select associated_organization_id from public.crm_pipeline_records')).rows[0].associated_organization_id).toBe(organization);
      await db.exec(seed);
      expect((await db.query('select id from public.crm_pipelines')).rows).toHaveLength(7);
      expect((await db.query('select id from public.crm_pipeline_stages')).rows).toHaveLength(49);
      expect((await db.query('select id from public.crm_pipeline_fields')).rows).toHaveLength(20);
      expect((await db.query('select id from public.crm_pipeline_records')).rows).toHaveLength(1);
      expect(seed).not.toMatch(/update\s+public\.(clients|staff|provider_applicants|relationship_opportunities)\b/i);
    }finally{await db.close();}
  },60000);
});
