// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {PGlite} from '@electric-sql/pglite';

const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const admin='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const person=(n:number)=>`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const original=readFileSync(resolve(process.cwd(),'supabase/migrations/20261009043000_crm_configurable_pipelines.sql'),'utf8');
const auto=readFileSync(resolve(process.cwd(),'supabase/migrations/20261009131000_auto_primary_single_contact_organization.sql'),'utf8');

const fixture=`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as
  $b$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $b$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key);
create table public.crm_user_capabilities(profile_id uuid,tenant_id uuid,crm_role text);
create table public.tenant_memberships(profile_id uuid,tenant_id uuid);
create table public.relationship_contacts(tenant_id uuid,id uuid,first_name text,last_name text,
  primary key(tenant_id,id));
create table public.relationship_organizations(tenant_id uuid,id uuid,name text,
  primary key(tenant_id,id));
create table public.relationship_contact_organizations(
  tenant_id uuid,contact_id uuid,organization_id uuid,is_primary boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(contact_id,organization_id));
create function private.crm_has_relationship_permission(p_user uuid,p_tenant uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $b$select p_user=auth.uid() and exists(select 1 from public.crm_user_capabilities
where profile_id=p_user and tenant_id=p_tenant and crm_role='crm_admin')$b$;
insert into public.tenants values ('${tenant}');
insert into public.profiles values ('${admin}');
insert into public.crm_user_capabilities values ('${admin}','${tenant}','crm_admin');
insert into public.tenant_memberships values ('${admin}','${tenant}');
grant usage on schema auth,private to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function private.crm_has_relationship_permission(uuid,uuid,text) to authenticated;
grant select on public.crm_user_capabilities,public.relationship_contacts,public.relationship_organizations,
  public.relationship_contact_organizations,public.tenant_memberships to authenticated;
grant insert,update,delete on public.relationship_contact_organizations to authenticated;
`;

describe('global organization Primary defaults to the only linked contact',()=>{
  it('backfills solo affiliations; handles first insert, demotion, deletion and organization move',async()=>{
    const db=new PGlite();
    try{
      await db.exec(fixture);
      for(let i=1;i<=8;i++)await db.query('insert into relationship_organizations values($1,$2,$3)',[tenant,org(i),'Org '+i]);
      for(let i=1;i<=12;i++)await db.query('insert into relationship_contacts values($1,$2,$3,$4)',[tenant,person(i),'First','Last']);
      const add=async (organization:number,contact:number,primary:boolean)=>{
        await db.query('insert into relationship_contact_organizations(tenant_id,organization_id,contact_id,is_primary) values($1,$2,$3,$4)',
          [tenant,org(organization),person(contact),primary]);
      };
      // These legacy records predate uniqueness protection. Preserve ambiguous
      // two-contact primaries rather than arbitrarily declaring either one right.
      await add(1,1,false); // 1 contact, missing Primary: backfill it
      await add(2,2,true);await add(2,3,true); // 2 primary contacts: unresolved
      await add(3,4,true);await add(3,5,false); // valid multi-contact
      await add(4,6,false);await add(4,7,false); // multi-contact, no primary
      await add(7,10,true);await add(7,11,false); // association-move source
      await db.exec(original);
      await db.exec(auto);
      const primaries=async(organization:number)=>{
        const result=await db.query<{contact_id:string}>(`select contact_id from public.relationship_contact_organizations
          where organization_id=$1 and is_primary order by contact_id`,[org(organization)]);
        return result.rows.map(x=>x.contact_id);
      };
      expect(await primaries(1)).toEqual([person(1)]);
      expect(await primaries(2)).toEqual([person(2),person(3)]);
      expect(await primaries(3)).toEqual([person(4)]);
      expect(await primaries(4)).toEqual([]);

      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
      await add(5,8,false);
      expect(await primaries(5)).toEqual([person(8)]);
      await add(5,9,false);
      expect(await primaries(5)).toEqual([person(8)]);
      await expect(add(5,12,true)).rejects.toThrow(/ALREADY_HAS_PRIMARY_CONTACT/);
      await db.query(`update public.relationship_contact_organizations set is_primary=false
        where organization_id=$1`,[org(1)]);
      expect(await primaries(1)).toEqual([person(1)]);

      // Deleting a Primary leaves exactly one contact: promote that survivor.
      await db.query(`delete from public.relationship_contact_organizations
        where organization_id=$1 and contact_id=$2`,[org(3),person(4)]);
      expect(await primaries(3)).toEqual([person(5)]);
      // No-primary multi-affiliation also becomes valid when reduced to one.
      await db.query(`delete from public.relationship_contact_organizations
        where organization_id=$1 and contact_id=$2`,[org(4),person(6)]);
      expect(await primaries(4)).toEqual([person(7)]);

      // Moving an affiliation auto-promotes the only old survivor, while
      // making the first contact of the new organization Primary.
      await db.query(`update public.relationship_contact_organizations
        set organization_id=$1 where organization_id=$2 and contact_id=$3`,[org(8),org(7),person(10)]);
      expect(await primaries(7)).toEqual([person(11)]);
      expect(await primaries(8)).toEqual([person(10)]);
      // The remaining legacy ambiguous organization was not rewritten.
      expect(await primaries(2)).toEqual([person(2),person(3)]);
    }finally{await db.close();}
  },60000);
});
