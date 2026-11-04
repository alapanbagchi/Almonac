-- Up Migration
set local lock_timeout = '5s';

-- A sign-up is held here until the person proves control of the email address.
-- The provider user is created only after that proof, so an unverified address
-- never becomes an identity. The password is stored as a bcrypt hash: the
-- application never keeps the plaintext, and the hash is handed to the
-- provider when the user is created.
create table identity.pending_registration (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  display_name text not null,
  password_hash text not null,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  requested_ip inet,
  user_agent_hash bytea,
  constraint pending_registration_email_check check (
    email::text = lower(email::text) and length(email::text) between 3 and 320
  ),
  constraint pending_registration_name_check check (
    length(display_name) between 2 and 200
  ),
  constraint pending_registration_password_check check (
    password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'
  ),
  constraint pending_registration_token_check check (
    octet_length(token_hash) = 32
  ),
  constraint pending_registration_agent_check check (
    user_agent_hash is null or octet_length(user_agent_hash) = 32
  ),
  constraint pending_registration_expiry_check check (expires_at > created_at),
  constraint pending_registration_consumed_check check (
    consumed_at is null or consumed_at >= created_at
  )
);

-- One open request per email. A second sign-up replaces the first, so a lost
-- email does not lock the address; a consumed row keeps its history.
create unique index pending_registration_email_open_idx
  on identity.pending_registration (email)
  where consumed_at is null;

create index pending_registration_expiry_idx
  on identity.pending_registration (expires_at)
  where consumed_at is null;

-- A verification is single use. The row can change while it is open, but once
-- consumed it is evidence and must not change again.
create function identity.reject_consumed_registration_change()
returns trigger
language plpgsql
as $$
begin
  if old.consumed_at is not null then
    raise exception 'pending registration is final' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger pending_registration_consumed_final
  before update on identity.pending_registration
  for each row execute function identity.reject_consumed_registration_change();

grant select, insert, update on identity.pending_registration to almonac_app;
revoke delete on identity.pending_registration from almonac_app;

insert into audit.event_type (key, description, requires_reason, metadata_keys)
values
  ('auth.signup_requested', 'A self-service sign-up requested email verification', false, '{}'),
  ('auth.signup_verified', 'A self-service sign-up verified its email address', false, '{}')
on conflict (key) do nothing;

update control.schema_metadata
   set version = 8, migrated_at = now()
 where id = 1;

-- Down Migration
set local lock_timeout = '5s';

drop trigger if exists pending_registration_consumed_final on identity.pending_registration;
drop function if exists identity.reject_consumed_registration_change();
drop table if exists identity.pending_registration;

delete from audit.event_type as event_type
 where event_type.key in ('auth.signup_requested', 'auth.signup_verified')
   and not exists (
     select 1 from audit.event as event where event.event_type = event_type.key
   );

update control.schema_metadata
   set version = 7, migrated_at = now()
 where id = 1;
