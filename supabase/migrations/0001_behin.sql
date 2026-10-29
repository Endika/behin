create schema behin;

create table behin.notes (
  id uuid primary key default gen_random_uuid(),
  ciphertext bytea not null,
  iv bytea not null,
  auth_hash bytea not null,
  attempts int not null default 0,
  expires_at timestamptz not null
);

alter table behin.notes enable row level security;
revoke all on table behin.notes from public, anon, authenticated, service_role;

grant usage on schema behin to anon;

create function behin.create_note(
  p_ciphertext text,
  p_iv text,
  p_auth_hash text,
  p_ttl_seconds int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ciphertext bytea;
  v_iv bytea;
  v_auth bytea;
  v_id uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds not in (600, 3600, 86400, 604800) then
    raise exception 'invalid p_ttl_seconds';
  end if;

  begin
    v_ciphertext := decode(p_ciphertext, 'base64');
  exception when others then
    raise exception 'invalid p_ciphertext: not base64';
  end;
  if v_ciphertext is null or length(v_ciphertext) not between 17 and 10016 then
    raise exception 'invalid p_ciphertext: size out of range';
  end if;

  begin
    v_iv := decode(p_iv, 'base64');
  exception when others then
    raise exception 'invalid p_iv: not base64';
  end;
  if v_iv is null or length(v_iv) <> 12 then
    raise exception 'invalid p_iv: must be 12 bytes';
  end if;

  begin
    v_auth := decode(p_auth_hash, 'base64');
  exception when others then
    raise exception 'invalid p_auth_hash: not base64';
  end;
  if v_auth is null or length(v_auth) <> 32 then
    raise exception 'invalid p_auth_hash: must be 32 bytes';
  end if;

  if (select count(*) from behin.notes where expires_at > now()) >= 5000 then
    raise exception 'capacity reached';
  end if;

  insert into behin.notes (ciphertext, iv, auth_hash, expires_at)
  values (v_ciphertext, v_iv, v_auth, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;

  return v_id;
end;
$$;

-- The delete is the read: a note can be returned at most once, even under concurrency.
create function behin.open_note(p_id uuid, p_auth text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_ciphertext bytea;
  v_iv bytea;
  v_attempts int;
  v_remaining int;
begin
  begin
    v_hash := extensions.digest(decode(p_auth, 'base64'), 'sha256');
  exception when others then
    v_hash := null;
  end;

  delete from behin.notes
  where id = p_id and auth_hash = v_hash and expires_at > now()
  returning ciphertext, iv into v_ciphertext, v_iv;

  if found then
    return jsonb_build_object(
      'status', 'ok',
      'ciphertext', replace(encode(v_ciphertext, 'base64'), E'\n', ''),
      'iv', replace(encode(v_iv, 'base64'), E'\n', '')
    );
  end if;

  update behin.notes
  set attempts = attempts + 1
  where id = p_id and expires_at > now()
  returning attempts into v_attempts;

  if not found then
    delete from behin.notes where id = p_id and expires_at <= now();
    return jsonb_build_object('status', 'gone');
  end if;

  v_remaining := 5 - v_attempts;
  if v_remaining <= 0 then
    delete from behin.notes where id = p_id;
    v_remaining := 0;
  end if;
  return jsonb_build_object('status', 'wrong', 'remaining', v_remaining);
end;
$$;

revoke all on function behin.create_note(text, text, text, int), behin.open_note(uuid, text)
  from public, authenticated, service_role;
grant execute on function behin.create_note(text, text, text, int) to anon;
grant execute on function behin.open_note(uuid, text) to anon;

select cron.schedule('behin-expire', '*/5 * * * *', $$delete from behin.notes where expires_at < now()$$);
