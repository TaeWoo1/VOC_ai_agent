#!/usr/bin/env bash
#
# Delete ONE organisation and everything scoped to it — Pilot Readiness Closure v1 §5.
#
# ## Why this exists
#
# Every QA walkthrough in the last several packages created a throwaway organisation through the
# product's own signup, because that is the honest way to observe a first-use screen. Nothing ever
# removed them: the local database had grown to dozens of organisations, each holding conversations,
# working sets, drafts and knowledge rows, and the only cleanup instrument available was an operator
# typing DELETE statements against a database that also holds the canonical Demo Org.
#
# ## What makes it safe
#
#   * ONE organisation, named by UUID on the command line. There is no "all test orgs" mode, no name
#     pattern and no date heuristic: a rule that decides which organisations are disposable is a rule
#     that can be wrong about a real one.
#   * It REFUSES an organisation that owns a CONNECTED, non-file-upload seller account. That is the
#     same predicate the product uses for "a seller who finished a connection" — the record of a real
#     marketplace relationship. Disposable QA organisations connect nothing, so the fence costs
#     nothing and stops the one mistake that cannot be undone.
#   * DRY RUN by default. It prints the per-table row counts it would delete and exits. Deleting needs
#     --confirm on the same command line.
#   * ONE transaction. If anything blocks — a foreign key from a table this script did not reach — the
#     whole thing rolls back and the blocking constraint is printed. A partial delete would leave an
#     organisation that exists in some tables and not others, which is worse than not starting.
#   * It never touches reference data. `channels` is the product's catalogue and has no org_id.
#
# ## Usage
#
#   tools/dev/org-cleanup.sh --org <uuid>              # dry run: what would be deleted
#   tools/dev/org-cleanup.sh --org <uuid> --confirm    # delete it
#
# The database URL comes from DATABASE_URL, or defaults to the local compose database. It is a
# development instrument: it holds no credential of its own and is not part of any deployment.
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://sellerops:sellerops_local_pw@localhost:5432/sellerops}"
ORG=""
CONFIRM="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --org) ORG="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="yes"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$ORG" ] || { echo "usage: $0 --org <uuid> [--confirm]" >&2; exit 2; }
[[ "$ORG" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || { echo "not a UUID: $ORG" >&2; exit 2; }

q() { psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "$1"; }

exists="$(q "select count(*) from organizations where id = '$ORG'")"
[ "$exists" = "1" ] || { echo "no such organisation: $ORG" >&2; exit 1; }

name="$(q "select name from organizations where id = '$ORG'")"
connected="$(q "select count(*) from seller_accounts where org_id = '$ORG'
                and connection_status = 'CONNECTED' and is_file_upload = false")"

printf 'organisation: %s  (%s)\n' "$ORG" "$name"
printf 'connected marketplace accounts: %s\n' "$connected"

if [ "$connected" != "0" ]; then
  echo "REFUSED: this organisation owns a connected marketplace account — it is not a disposable QA org." >&2
  exit 1
fi

# What is scoped to this organisation, table by table, straight from the catalogue: a hand-written
# list would go stale on the next migration and silently stop deleting a table.
echo
echo "rows scoped to this organisation:"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
declare t record; n bigint; total bigint := 0;
begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'org_id' order by table_name loop
    execute format('select count(*) from public.%I where org_id = \$1', t.table_name)
      into n using '$ORG'::uuid;
    if n > 0 then
      raise notice '  % : %', rpad(t.table_name, 42), n;
      total := total + n;
    end if;
  end loop;
  raise notice '  % : %', rpad('TOTAL', 42), total;
end \$\$;
SQL

if [ "$CONFIRM" != "yes" ]; then
  echo
  echo "dry run — nothing was deleted. Re-run with --confirm to delete."
  exit 0
fi

echo
echo "deleting (single transaction; any blocking constraint rolls the whole thing back)…"
psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -q <<SQL
do \$\$
declare t record; n bigint; progress boolean := true; rounds int := 0; deleted bigint := 0;
begin
  -- Foreign keys inside the organisation decide the order. Rather than hand-maintaining a
  -- topological sort of 58 tables, delete what can be deleted and go round again; a round that
  -- deletes nothing means the rest is genuinely blocked, and the final DELETE below says so.
  while progress and rounds < 40 loop
    progress := false;
    rounds := rounds + 1;
    for t in select table_name from information_schema.columns
             where table_schema = 'public' and column_name = 'org_id' loop
      begin
        execute format('delete from public.%I where org_id = \$1', t.table_name) using '$ORG'::uuid;
        get diagnostics n = row_count;
        if n > 0 then
          progress := true;
          deleted := deleted + n;
        end if;
      exception when foreign_key_violation then
        null;  -- something in this org still points at it; the next round will reach it
      end;
    end loop;
  end loop;
  delete from organizations where id = '$ORG'::uuid;
  raise notice 'deleted % scoped rows in % rounds, and the organisation.', deleted, rounds;
end \$\$;
SQL

echo "done."
