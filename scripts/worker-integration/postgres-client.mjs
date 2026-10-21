import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const lit = (value) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const ident = (value) => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Unsafe identifier'); return `"${value}"`; };
const json = (value) => lit(JSON.stringify(value)) + '::jsonb';
export function postgresClient({ psql, role = 'service_role', userId = null, tenantId = null }) {
  if (!psql?.startsWith('/workspace/tools/pg/')) throw new Error('Owned local PostgreSQL client required');
  const socket = process.env.VALORWELL_DB_SOCKET ?? '/workspace/schema-runtime/exact-socket';
  if (!['/workspace/schema-runtime/socket','/workspace/schema-runtime/exact-socket'].includes(socket)) throw new Error('Owned isolated socket required');
  async function query(sql) {
    const claims = { role, ...(userId ? { sub: userId, app_metadata: { current_tenant_id: tenantId } } : {}) };
    const command = `BEGIN; SELECT 1/CASE WHEN current_setting('valorwell.acceptance_disposable',true)='true' THEN 1 ELSE 0 END; SET LOCAL ROLE ${ident(role)}; SELECT set_config('request.jwt.claims',${json(claims)}::text,true); ${sql}; COMMIT;`;
    const { stdout } = await exec(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '5432', '-U', 'postgres', '-d', 'postgres', '-c', command], { env: { PATH: process.env.PATH }, maxBuffer: 8 * 1024 * 1024 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    return JSON.parse(lines.at(-1));
  }
  function from(table) {
    const name = `public.${ident(table)}`;
    let action = 'select', columns = '*', values, singular = false, limit;
    const filters = [], orders = [];
    const builder = {
      select(value = '*') { columns = value; return this; },
      eq(key, value) { filters.push(`t.${ident(key)}=${lit(value)}`); return this; },
      in(key, values) { filters.push(`t.${ident(key)} IN (${values.map(lit).join(',')})`); return this; },
      is(key, value) { if (value !== null) throw new Error('Only null supported'); filters.push(`t.${ident(key)} IS NULL`); return this; },
      not(key, op, value) { if (op !== 'is' || value !== null) throw new Error('Only not null supported'); filters.push(`t.${ident(key)} IS NOT NULL`); return this; },
      order(key, { ascending = true } = {}) { orders.push(`t.${ident(key)} ${ascending ? 'ASC' : 'DESC'}`); return this; },
      limit(value) { if (!Number.isInteger(value)) throw new Error('Invalid limit'); limit = value; return this; },
      insert(value) { action = 'insert'; values = value; return this; },
      update(value) { action = 'update'; values = value; return this; },
      single() { singular = true; return this; }, maybeSingle() { singular = true; return this; },
      then(resolve, reject) {
        const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
        const order = orders.length ? ` ORDER BY ${orders.join(',')}` : '';
        let sql, selection;
        if (columns.includes('campaign:crm_campaigns')) selection = "t.*, (SELECT to_jsonb(c) FROM public.crm_campaigns c WHERE c.id=t.campaign_id) AS campaign";
        else if (columns.includes('primary_staff:staff!')) selection = "t.*, (SELECT to_jsonb(s) FROM public.staff s WHERE s.id=t.primary_staff_id) AS primary_staff";
        else if (columns === '*') selection = 't.*';
        else selection = columns.split(',').map((x) => 't.' + ident(x.trim())).join(',');
        if (action === 'select') sql = `SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (SELECT ${selection} FROM ${name} t${where}${order}${limit ? ` LIMIT ${limit}` : ''}) r`;
        else {
          const keys = Object.keys(values);
          const populated = `SELECT ${keys.map(ident).join(',')} FROM jsonb_populate_record(NULL::${name},${json(values)})`;
          const change = action === 'insert' ? `INSERT INTO ${name} (${keys.map(ident).join(',')}) ${populated}` : `UPDATE ${name} t SET (${keys.map(ident).join(',')})=(${populated})${where}`;
          sql = `WITH changed AS (${change} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(changed)),'[]'::jsonb) FROM changed`;
        }
        return query(sql).then((rows) => ({ data: singular ? rows[0] ?? null : rows, error: null })).catch((e) => ({ data: null, error: { message: e.stderr || e.message } })).then(resolve, reject);
      },
    };
    return builder;
  }
  return { query, from, async rpc(name, args = {}) {
    try {
      const shape = await query(`SELECT jsonb_build_object('set',p.proretset,'names',p.proargnames,'types',ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proargtypes::oid[]) t)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=${lit(name)} LIMIT 1`);
      if (!shape) throw new Error('Unknown RPC');
      const params = Object.entries(args).map(([key, value]) => {
        const type = shape.types[shape.names.indexOf(key)];
        if (!type) throw new Error(`Unknown argument ${key}`);
        const encoded = Array.isArray(value) && type.endsWith('[]') ? `ARRAY[${value.map(lit).join(',')}]` : value && typeof value === 'object' ? json(value) : lit(value);
        return `${ident(key)} => ${encoded}::${type}`;
      }).join(',');
      const call = `public.${ident(name)}(${params})`;
      const sql = shape.set ? `SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM ${call} r` : `SELECT coalesce(to_jsonb(${call}),'null'::jsonb)`;
      return { data: await query(sql), error: null };
    } catch (e) { return { data: null, error: { message: e.stderr || e.message } }; }
  } };
}
