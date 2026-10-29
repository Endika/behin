#!/usr/bin/env bash
# Applies supabase/migrations/0001_behin.sql to production. Run from the repo root.
set -euo pipefail

REF=ahvzkoekmwqwozqsgeao
API="https://api.supabase.com/v1/projects/$REF"
TOKEN_FILE="$HOME/.config/supabase/mcp-token"

[ -r "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE" >&2; exit 1; }
TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")

q() {
  python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' \
    | curl -sS --fail-with-body -X POST "$API/database/query" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @-
}

echo "1/6 pre-check: schema behin must not exist"
count=$(printf '%s' "select count(*) from pg_namespace where nspname='behin'" | q \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["count"])')
if [ "$count" != 0 ]; then
  echo "schema behin already exists; aborting" >&2
  exit 1
fi

echo "2/6 applying supabase/migrations/0001_behin.sql"
out=$(q < supabase/migrations/0001_behin.sql)
echo "    response: $out"

echo "3/6 registering the migration"
printf '%s' "insert into supabase_migrations.schema_migrations(version, name) values ('20261029000000', 'behin_0001') on conflict do nothing" | q > /dev/null

echo "4/6 exposing schema behin in PostgREST"
current=$(curl -sS --fail-with-body "$API/postgrest" -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["db_schema"])')
if printf '%s' "$current" | python3 -c 'import sys; sys.exit(0 if "behin" in [s.strip() for s in sys.stdin.read().split(",")] else 1)'; then
  echo "    already exposed: $current"
else
  CURRENT="$current" python3 -c 'import json,os; print(json.dumps({"db_schema": os.environ["CURRENT"] + ",behin"}))' \
    | curl -sS --fail-with-body -X PATCH "$API/postgrest" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @- > /dev/null
  echo "    db_schema: $current,behin"
fi

echo "5/6 verifying"
checks=$(q <<'SQL' | python3 -c 'import json,sys; r=json.load(sys.stdin)[0]; print(json.dumps(r)); sys.exit(0 if all(r.values()) else 1)'
select
  not has_table_privilege('anon','behin.notes','select') as anon_no_select,
  not has_table_privilege('anon','behin.notes','insert') as anon_no_insert,
  not has_table_privilege('anon','behin.notes','update') as anon_no_update,
  not has_table_privilege('anon','behin.notes','delete') as anon_no_delete,
  has_function_privilege('anon','behin.open_note(uuid,text)','execute') as anon_open,
  has_function_privilege('anon','behin.create_note(text,text,text,int)','execute') as anon_create,
  not has_function_privilege('authenticated','behin.open_note(uuid,text)','execute') as authenticated_no_open,
  exists(select 1 from cron.job where jobname='behin-expire' and schedule='*/5 * * * *') as cron_job,
  (select relrowsecurity from pg_class where oid='behin.notes'::regclass) as rls_on
SQL
) || { echo "verification failed: $checks" >&2; exit 1; }
echo "    $checks"

echo "6/6 done. Now run the Supabase advisors (security and performance) on $REF."
