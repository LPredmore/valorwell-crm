// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const tenant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stranger='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const migration=readFileSync(resolve(process.cwd(),
  'supabase/migrations/20261009181500_crm_applicant_pipeline_staff_tenant_scope.sql'),'utf8');
describe('CRM applicant tenant contract is not a generic applicant-data read',()=>{
  it('returns the caller staff-authorized tenant and rejects missing contract',async()=>{
    const db=new PGlite();
    try{
      await db.exec(`
        create role anon;create role authenticated;
        create schema auth;create schema private;
        create table public.test_staff_grants(profile_id uuid,tenant_id uuid);
        insert into public.test_staff_grants values('${user}','${tenant}');
        create function auth.uid() returns uuid language sql stable
          as $f$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
        create function private.valorwell_current_staff_tenant_id()
          returns uuid language sql stable as $f$
          select tenant_id from public.test_staff_grants
            where profile_id=auth.uid() limit 1 $f$;
        create function private.valorwell_require_staff_contract(p_tenant uuid,p_write boolean)
          returns uuid language plpgsql as $f$
          begin
            if p_tenant is null or auth.uid() is null then
              raise exception 'STAFF_ACCESS_DENIED' using errcode='42501';
            end if;
            return auth.uid();
          end;
          $f$;
        grant usage on schema auth,private to authenticated;
        grant execute on function auth.uid() to authenticated;
      `);
      await db.exec(migration);
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
      const yes=await db.query<{tenant_id:string}>(
        'select public.crm_staff_tenant_for_applicant_pipeline() tenant_id');
      expect(yes.rows[0].tenant_id).toBe(tenant);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[stranger]);
      await expect(db.query('select public.crm_staff_tenant_for_applicant_pipeline()'))
        .rejects.toThrow(/STAFF_ACCESS_DENIED/);
      await db.exec('reset role');
      expect((await db.query<{can_execute:boolean}>(`select
        has_function_privilege('anon','public.crm_staff_tenant_for_applicant_pipeline()','execute') can_execute`)
      ).rows[0].can_execute).toBe(false);
    }finally{await db.close();}
  },60000);
});
