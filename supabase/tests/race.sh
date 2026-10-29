#!/usr/bin/env bash
set -euo pipefail

PSQL="${PSQL:-psql "${BEHIN_TEST_DATABASE_URL:?set BEHIN_TEST_DATABASE_URL or PSQL}"}"

auth='YXV0aA=='
gate='Z2F0ZQ=='
auth_hash=$($PSQL -qAt -c "select encode(extensions.digest(decode('$auth','base64'),'sha256'),'base64')")
gate_hash=$($PSQL -qAt -c "select encode(extensions.digest(decode('$gate','base64'),'sha256'),'base64')")
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

new_note() {
  $PSQL -qAt -c "select behin.create_note(encode(decode(repeat('00', 17), 'hex'), 'base64'), encode(decode(repeat('00', 12), 'hex'), 'base64'), '$auth_hash', '$gate_hash', 600)"
}

open_many() {
  local id=$1 token=$2 n=$3
  rm -f "$out"/*
  for i in $(seq 1 "$n"); do
    $PSQL -qAt -c "set role anon; select behin.open_note('$id', '$gate', '$token')->>'status'" 2>&1 | tail -n 1 > "$out/$i" &
  done
  wait
}

id=$(new_note)
open_many "$id" "$auth" 50
ok=$(cat "$out"/* | grep -cx ok || true)
echo "race: $ok ok out of 50"
[ "$ok" -eq 1 ]

id=$(new_note)
open_many "$id" "YmFk" 20
wrong=$(cat "$out"/* | grep -cx wrong || true)
gone=$(cat "$out"/* | grep -cx gone || true)
left=$($PSQL -qAt -c "select count(*) from behin.notes where id = '$id'")
echo "race wrong token: $wrong wrong, $gone gone, $left rows left"
[ "$wrong" -le 5 ] && [ $((wrong + gone)) -eq 20 ] && [ "$left" -eq 0 ]
