#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${DATABASE_URL:-}" ]; then
  export PSQL="psql $DATABASE_URL -v ON_ERROR_STOP=1"
  PSQL_FILE="$PSQL"
else
  name="behin-sql-$$"
  docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres postgres:17 > /dev/null
  trap 'docker rm -f "$name" > /dev/null 2>&1 || true' EXIT
  until docker exec "$name" pg_isready -U postgres -h localhost > /dev/null 2>&1; do sleep 1; done
  sleep 2
  export PSQL="docker exec -i $name psql -U postgres -v ON_ERROR_STOP=1"
  PSQL_FILE="$PSQL"
fi

$PSQL_FILE < supabase/tests/bootstrap.sql
$PSQL_FILE < supabase/migrations/0001_behin.sql
$PSQL_FILE < supabase/tests/behin.sql
bash supabase/tests/race.sh
