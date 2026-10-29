#!/usr/bin/env bash
set -euo pipefail

PSQL="${PSQL:-psql "${DATABASE_URL:?set DATABASE_URL or PSQL}"}"

auth='YXV0aA=='
auth_hash=$($PSQL -qAt -c "select encode(extensions.digest(decode('$auth','base64'),'sha256'),'base64')")
id=$($PSQL -qAt -c "select behin.create_note(encode(decode(repeat('00', 17), 'hex'), 'base64'), encode(decode(repeat('00', 12), 'hex'), 'base64'), '$auth_hash', 600)")

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
for i in $(seq 1 50); do
  $PSQL -qAt -c "set role anon; select behin.open_note('$id', '$auth')->>'status'" 2>&1 | tail -n 1 > "$out/$i" &
done
wait

ok=$(cat "$out"/* | grep -cx ok || true)
echo "race: $ok ok out of 50"
[ "$ok" -eq 1 ]
