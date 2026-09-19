#!/usr/bin/env node
// L2 — the snapshot's state for every gold ref, and the source census that says what the snapshot WAS.
// Read-only: every statement runs inside `set default_transaction_read_only = on`. No model, no network but local psql.
//   node tools/inquiry-need-eval/census.mjs --dataset <dir> --db <name> --org <uuid> --snapshot <id> --out <file.json>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadDataset, parseRef, sha256 } from './io.mjs';

function args() {
  const a = {};
  for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  for (const k of ['dataset', 'db', 'org', 'snapshot', 'out']) if (!a[k]) throw new Error(`--${k} required`);
  if (!/^[0-9a-f-]{36}$/.test(a.org)) throw new Error('--org must be a uuid');
  if (!/^[a-z0-9_]+$/.test(a.db)) throw new Error('--db must be a plain database name');
  return a;
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function makeQuery(db, host = process.env.PGHOST ?? 'localhost', user = process.env.PGUSER ?? 'sellerops') {
  return (sql) => {
    const out = execFileSync('psql', ['-h', host, '-U', user, '-d', db, '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1',
      '-c', `set default_transaction_read_only = on; ${sql}`], { encoding: 'utf8' });
    return out.split('\n').filter((l) => l && l !== 'SET').map((l) => l.split('\t'));
  };
}

/** One ref's state for the question's product. The rules are the lanes' own fences: a product lane sees its product
 *  only; org rules are org-wide; a catalogue product is named org-wide; image and Cafe24 detail have no reader. */
export function refState(q, org, ref, product) {
  const p = parseRef(ref);
  if (p.kind === 'IMG' || p.kind === 'C24') return 'UNREADABLE';
  const one = (sql) => Number(q(sql)[0]?.[0] ?? 0);
  const distinct = (table, col, prefix) => one(`select count(distinct ${col}) from ${table} where org_id = ${lit(org)} and ${col}::text like ${lit(prefix + '%')}`);
  if (p.kind === 'PK') {
    if (distinct('product_knowledge_sources', 'id', p.id) > 1) return 'AMBIGUOUS';
    const r = q(`select left(s.product_id::text, 8), (select count(*) from product_knowledge_chunks c where c.source_id = s.id)
                   from product_knowledge_sources s where s.org_id = ${lit(org)} and s.id::text like ${lit(p.id + '%')}
                    and s.active and s.data_origin = 'REAL'`);
    if (!r.length || r[0][1] === '0') return 'NO_SOURCE';
    return r[0][0] === product ? 'PRESENT' : 'PRESENT_OTHER_SCOPE';
  }
  if (p.kind === 'OK') {
    if (distinct('org_knowledge_sources', 'id', p.id) > 1) return 'AMBIGUOUS';
    return one(`select count(*) from org_knowledge_sources s where s.org_id = ${lit(org)} and s.id::text like ${lit(p.id + '%')}
                 and s.active and s.data_origin = 'REAL' and exists (select 1 from org_knowledge_chunks c where c.source_id = s.id)`)
      ? 'PRESENT' : 'NO_SOURCE';
  }
  if (p.kind === 'ORDER') {
    return one(`select count(*) from inquiries i join channel_orders o on o.org_id = i.org_id and o.external_order_id = i.source_order_ref
                 where i.org_id = ${lit(org)} and i.id::text like ${lit(p.id + '%')}`) ? 'PRESENT' : 'NO_SOURCE';
  }
  if (distinct('products', 'id', p.id) > 1) return 'AMBIGUOUS';
  if (p.kind === 'CAT') {
    return one(`select count(*) from products where org_id = ${lit(org)} and id::text like ${lit(p.id + '%')} and data_origin = 'REAL'`)
      ? 'PRESENT' : 'NO_SOURCE';
  }
  const sql = {
    OPT: `select count(*) from product_variants where org_id = ${lit(org)} and product_id::text like ${lit(p.id + '%')} and option_name like ${lit(p.pattern)}`,
    ADDON: `select count(*) from product_facts where org_id = ${lit(org)} and product_id::text like ${lit(p.id + '%')} and fact_key like 'attr:추가상품%' and fact_value like ${lit(p.pattern)}`,
    FACT: `select count(*) from product_facts where org_id = ${lit(org)} and product_id::text like ${lit(p.id + '%')} and fact_key like ${lit(p.pattern + '%')}`,
  }[p.kind];
  if (!sql) return 'NO_SOURCE';
  if (one(sql)) return p.id === product ? 'PRESENT' : 'PRESENT_OTHER_SCOPE';
  // Not here. A NAVER listing's options, add-ons and detail facts are what Catalogue Bootstrap writes.
  const naver = one(`select count(*) from channel_products cp join channels ch on ch.id = cp.channel_id
                      where cp.org_id = ${lit(org)} and cp.product_id::text like ${lit(p.id + '%')} and ch.code = 'NAVER'`);
  return naver ? 'ABSENT_ACQUIRABLE' : 'NO_SOURCE';
}

export function sourceCensus(q, org) {
  const rows = (sql) => Object.fromEntries(q(sql).map(([k, v]) => [k, Number(v)]));
  return {
    migration: q(`select max(version::int) from flyway_schema_history where success`)[0]?.[0] ?? null,
    product_knowledge_sources: rows(`select authored_origin, count(*) from product_knowledge_sources where org_id = ${lit(org)} and active and data_origin = 'REAL' group by 1`),
    product_knowledge_chunks: Number(q(`select count(*) from product_knowledge_chunks c join product_knowledge_sources s on s.id = c.source_id where c.org_id = ${lit(org)} and s.active and s.data_origin = 'REAL'`)[0][0]),
    org_knowledge_sources: rows(`select authored_origin, count(*) from org_knowledge_sources where org_id = ${lit(org)} and active and data_origin = 'REAL' group by 1`),
    answer_memory: Number(q(`select count(*) from answer_memory where org_id = ${lit(org)}`)[0][0]),
    product_facts_by_source: rows(`select split_part(source, ':', 1) || ':' || split_part(source, ':', 2), count(*) from product_facts where org_id = ${lit(org)} group by 1`),
    catalogue_detail_facts: Number(q(`select count(*) from product_facts where org_id = ${lit(org)} and source like 'NAVER:PRODUCT_DETAIL%'`)[0][0]),
    product_variants_by_channel: rows(`select ch.code, count(*) from product_variants v join channels ch on ch.id = v.channel_id where v.org_id = ${lit(org)} group by 1`),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = args();
  const ds = loadDataset(a.dataset);
  const q = makeQuery(a.db);
  const product = new Map(ds.questions.map((x) => [x.q, x.product]));
  const states = new Map();
  for (const n of ds.needs) {
    for (const s of [...n.sets, ...n.family_sets]) {
      for (const ref of s.refs) {
        const pr = product.get(n.q) ?? null;
        const key = `${ref}|${pr}`;
        if (!states.has(key)) states.set(key, { ref, product: pr, state: refState(q, a.org, ref, pr) });
      }
    }
  }
  const memories = q(`select left(id::text, 8), coalesce(left(product_id::text, 8), ''), coalesce(left(origin_inquiry_id::text, 8), '')
                        from answer_memory where org_id = ${lit(a.org)} order by 1`)
    .map(([memory, prod, origin]) => ({ memory, product: prod || null, origin_inquiry: origin || null }));
  const body = { refs: [...states.values()], memories };
  const snapshot = {
    snapshot: a.snapshot, db: a.db, org: a.org, dataset_hash: ds.hash, captured_at: new Date().toISOString(),
    census: sourceCensus(q, a.org), ...body, state_hash: sha256(JSON.stringify(body)),
  };
  writeFileSync(a.out, JSON.stringify(snapshot, null, 1));
  const ambiguous = body.refs.filter((r) => r.state === 'AMBIGUOUS');
  console.log(JSON.stringify({ snapshot: a.snapshot, refs: body.refs.length, memories: memories.length, ambiguous: ambiguous.length, state_hash: snapshot.state_hash }));
  process.exit(ambiguous.length ? 1 : 0);
}
