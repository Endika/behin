#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${BEHIN_TEST_DATABASE_URL:-}" ]; then
  host=${BEHIN_TEST_DATABASE_URL#*://}
  host=${host##*@}
  host=${host%%[/:?]*}
  if [ "$host" != localhost ] && [ "$host" != 127.0.0.1 ]; then
    echo "refusing to run: BEHIN_TEST_DATABASE_URL host must be localhost or 127.0.0.1 (the tests delete rows)" >&2
    exit 2
  fi
  export PSQL="psql $BEHIN_TEST_DATABASE_URL -v ON_ERROR_STOP=1"
else
  name="behin-sql-$$"
  docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres postgres:17 > /dev/null
  trap 'docker rm -f "$name" > /dev/null 2>&1 || true' EXIT
  until docker exec "$name" pg_isready -U postgres -h localhost > /dev/null 2>&1; do sleep 1; done
  sleep 2
  export PSQL="docker exec -i $name psql -U postgres -v ON_ERROR_STOP=1"
fi

$PSQL < supabase/tests/bootstrap.sql
$PSQL < supabase/migrations/0001_behin.sql
$PSQL < supabase/tests/behin.sql
bash supabase/tests/race.sh
