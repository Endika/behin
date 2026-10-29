\set ON_ERROR_STOP on

create schema t;
grant usage on schema t to anon;
create function t.b64(n int) returns text language sql as $$
  select encode(decode(repeat('00', n), 'hex'), 'base64')
$$;
create function t.b64(n int, fill text) returns text language sql as $$
  select replace(encode(decode(repeat(fill, n), 'hex'), 'base64'), E'\n', '')
$$;
create function t.hash(a text) returns text language sql security definer as $$
  select encode(extensions.digest(decode(a, 'base64'), 'sha256'), 'base64')
$$;

-- t.good_auth is the token; its hash is what the server stores
create function t.mk(ttl int default 600) returns uuid language sql as $$
  select behin.create_note(t.b64(32), t.b64(12), t.hash('Z29vZA=='), ttl)
$$;

do $$
declare id uuid; r jsonb;
begin
  id := t.mk();
  set role anon;
  r := behin.open_note(id, 'Z29vZA==');
  if r->>'status' <> 'ok' or r->>'ciphertext' <> t.b64(32) or r->>'iv' <> t.b64(12) then
    raise exception 'FAIL: create and open returns ok with the ciphertext';
  end if;
  r := behin.open_note(id, 'Z29vZA==');
  if r->>'status' <> 'gone' then raise exception 'FAIL: second open is gone'; end if;
  reset role;
  raise notice 'PASS: create and open once';
end $$;

do $$
declare id uuid; r jsonb; i int; expected int := 4;
begin
  id := t.mk();
  set role anon;
  for i in 1..5 loop
    r := behin.open_note(id, 'YmFk');
    if r->>'status' <> 'wrong' or (r->>'remaining')::int <> 5 - i then
      raise exception 'FAIL: wrong auth counts down 4..0 (try %, got %)', i, r;
    end if;
  end loop;
  r := behin.open_note(id, 'Z29vZA==');
  if r->>'status' <> 'gone' then raise exception 'FAIL: note destroyed after the fifth wrong try'; end if;
  reset role;
  raise notice 'PASS: five wrong tries destroy the note';
end $$;

do $$
declare id uuid; r jsonb;
begin
  id := t.mk();
  set role anon;
  perform behin.open_note(id, 'YmFk');
  perform behin.open_note(id, 'YmFk');
  r := behin.open_note(id, 'Z29vZA==');
  if r->>'status' <> 'ok' then raise exception 'FAIL: right auth after two failures opens'; end if;
  reset role;
  raise notice 'PASS: right auth after two failures';
end $$;

do $$
declare id uuid; r jsonb;
begin
  id := t.mk();
  set role anon;
  r := behin.open_note(id, '!!not base64!!');
  if r->>'status' <> 'wrong' or (r->>'remaining')::int <> 4 then
    raise exception 'FAIL: malformed base64 auth counts as a wrong attempt';
  end if;
  reset role;
  raise notice 'PASS: malformed auth is a wrong attempt';
end $$;

do $$
declare r jsonb;
begin
  set role anon;
  r := behin.open_note(gen_random_uuid(), 'Z29vZA==');
  if r->>'status' <> 'gone' then raise exception 'FAIL: unknown id is gone'; end if;
  reset role;
  raise notice 'PASS: unknown id is gone';
end $$;

do $$
declare id uuid; r jsonb; h text := t.hash('Z29vZA=='); big text := t.b64(10016, '7f');
begin
  set role anon;
  id := behin.create_note(big, t.b64(12), h, 600);
  r := behin.open_note(id, 'Z29vZA==');
  if r->>'status' <> 'ok' or r->>'ciphertext' <> big then
    raise exception 'FAIL: 10016 byte ciphertext round-trips exactly';
  end if;
  if position(E'\n' in r->>'ciphertext') > 0 then raise exception 'FAIL: base64 output has no newlines'; end if;
  reset role;
  raise notice 'PASS: 10016 byte ciphertext round-trips byte-exactly';
end $$;

do $$
declare h text := t.hash('Z29vZA=='); hit boolean;
begin
  set role anon;

  hit := false;
  begin perform behin.create_note(t.b64(32), t.b64(12), h, 1234);
  exception when others then hit := sqlerrm like '%p_ttl_seconds%'; end;
  if not hit then raise exception 'FAIL: ttl 1234 rejected'; end if;

  hit := false;
  begin perform behin.create_note(t.b64(10017), t.b64(12), h, 600);
  exception when others then hit := sqlerrm like '%p_ciphertext%'; end;
  if not hit then raise exception 'FAIL: 10017 byte ciphertext rejected'; end if;

  hit := false;
  begin perform behin.create_note(t.b64(16), t.b64(12), h, 600);
  exception when others then hit := sqlerrm like '%p_ciphertext%'; end;
  if not hit then raise exception 'FAIL: 16 byte ciphertext rejected'; end if;

  hit := false;
  begin perform behin.create_note(t.b64(32), t.b64(11), h, 600);
  exception when others then hit := sqlerrm like '%p_iv%'; end;
  if not hit then raise exception 'FAIL: 11 byte iv rejected'; end if;

  hit := false;
  begin perform behin.create_note(t.b64(32), t.b64(13), h, 600);
  exception when others then hit := sqlerrm like '%p_iv%'; end;
  if not hit then raise exception 'FAIL: 13 byte iv rejected'; end if;

  hit := false;
  begin perform behin.create_note(t.b64(32), t.b64(12), t.b64(31), 600);
  exception when others then hit := sqlerrm like '%p_auth_hash%'; end;
  if not hit then raise exception 'FAIL: 31 byte auth_hash rejected'; end if;

  hit := false;
  begin perform behin.create_note(t.b64(32), t.b64(12), t.b64(33), 600);
  exception when others then hit := sqlerrm like '%p_auth_hash%'; end;
  if not hit then raise exception 'FAIL: 33 byte auth_hash rejected'; end if;

  reset role;
  raise notice 'PASS: create_note validation names the field';
end $$;

do $$
declare nid uuid; r jsonb;
begin
  nid := t.mk();
  update behin.notes set expires_at = now() - interval '1 second' where id = nid;
  set role anon;
  r := behin.open_note(nid, 'Z29vZA==');
  if r->>'status' <> 'gone' then raise exception 'FAIL: expired note is gone'; end if;
  reset role;
  if exists (select 1 from behin.notes where id = nid) then
    raise exception 'FAIL: expired note row is deleted on access';
  end if;
  raise notice 'PASS: expired note is gone and removed';
end $$;

do $$
declare hit boolean;
begin
  delete from behin.notes;
  insert into behin.notes (ciphertext, iv, auth_hash, expires_at)
  select '\x00'::bytea, '\x00'::bytea, '\x00'::bytea, now() + interval '1 hour'
  from generate_series(1, 5000);
  -- expired rows do not count
  insert into behin.notes (ciphertext, iv, auth_hash, expires_at)
  select '\x00'::bytea, '\x00'::bytea, '\x00'::bytea, now() - interval '1 hour'
  from generate_series(1, 10);
  set role anon;
  hit := false;
  begin perform behin.create_note(t.b64(32), t.b64(12), t.hash('Z29vZA=='), 600);
  exception when others then hit := sqlerrm like '%capacity%'; end;
  if not hit then raise exception 'FAIL: create refused at 5000 live notes'; end if;
  reset role;
  delete from behin.notes where expires_at > now() and ctid in (select ctid from behin.notes where expires_at > now() limit 1);
  set role anon;
  perform behin.create_note(t.b64(32), t.b64(12), t.hash('Z29vZA=='), 600);
  reset role;
  delete from behin.notes;
  raise notice 'PASS: cap of 5000 live notes';
end $$;

do $$
declare hit boolean;
begin
  set role anon;

  hit := false;
  begin perform count(*) from behin.notes; exception when insufficient_privilege then hit := true; end;
  if not hit then raise exception 'FAIL: anon select on behin.notes denied'; end if;

  hit := false;
  begin insert into behin.notes (ciphertext, iv, auth_hash, expires_at) values ('\x00', '\x00', '\x00', now());
  exception when insufficient_privilege then hit := true; end;
  if not hit then raise exception 'FAIL: anon insert on behin.notes denied'; end if;

  hit := false;
  begin update behin.notes set attempts = 0; exception when insufficient_privilege then hit := true; end;
  if not hit then raise exception 'FAIL: anon update on behin.notes denied'; end if;

  hit := false;
  begin delete from behin.notes; exception when insufficient_privilege then hit := true; end;
  if not hit then raise exception 'FAIL: anon delete on behin.notes denied'; end if;

  reset role;
  raise notice 'PASS: anon has no direct table access';
end $$;

do $$
begin
  if not exists (
    select 1 from cron.job
    where jobname = 'behin-expire' and schedule = '*/5 * * * *'
      and command = 'delete from behin.notes where expires_at < now()'
  ) then
    raise exception 'FAIL: behin-expire cron job registered';
  end if;
  raise notice 'PASS: cron job registered';
end $$;
