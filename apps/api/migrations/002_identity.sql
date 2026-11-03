-- Up Migration
set local lock_timeout = '5s';

create schema identity;
comment on schema identity is 'Identity records. No clinical data.';

-- Shared by identity and control tables. Trigger functions run with the
-- invoker's rights, so 006 grants the runtime role execute on them.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_updated_at() from public;

create table identity.app_user (
  id uuid primary key default gen_random_uuid(),
  identity_issuer text not null,
  zitadel_sub text not null,
  email citext not null unique,
  email_verified_at timestamptz,
  display_name text not null,
  home_organisation_id uuid,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint app_user_issuer_check check (
    length(identity_issuer) between 8 and 2048
    and identity_issuer = btrim(identity_issuer)
    and identity_issuer ~ '^https?://'
  ),
  constraint app_user_subject_check check (
    length(btrim(zitadel_sub)) between 1 and 255
    and zitadel_sub = btrim(zitadel_sub)
  ),
  constraint app_user_email_check check (
    length(email::text) between 3 and 320
    and email::text = lower(email::text)
    and email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint app_user_name_check check (
    length(btrim(display_name)) between 1 and 200
    and display_name = btrim(display_name)
  ),
  constraint app_user_status_check check (status in ('active', 'suspended', 'deactivated')),
  constraint app_user_last_login_check check (
    last_login_at is null or last_login_at >= created_at
  ),
  constraint app_user_identity_key unique (identity_issuer, zitadel_sub)
);

create index app_user_home_organisation_idx
  on identity.app_user (home_organisation_id)
  where home_organisation_id is not null;

create trigger app_user_touch_updated_at
before update on identity.app_user
for each row execute function public.touch_updated_at();

create or replace function identity.prevent_app_user_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.identity_issuer is distinct from old.identity_issuer
    or new.zitadel_sub is distinct from old.zitadel_sub then
    raise exception 'app user identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger app_user_identity_immutable
before update of identity_issuer, zitadel_sub on identity.app_user
for each row execute function identity.prevent_app_user_identity_change();

create table identity.login_attempt (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references identity.app_user(id) on delete cascade,
  state_hash bytea not null unique,
  nonce_hash bytea not null,
  pkce_verifier_ciphertext bytea not null,
  key_version smallint not null,
  return_to text not null,
  purpose text not null,
  ip inet,
  user_agent_hash bytea,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint login_attempt_state_hash_check check (octet_length(state_hash) = 32),
  constraint login_attempt_nonce_hash_check check (octet_length(nonce_hash) = 32),
  constraint login_attempt_pkce_check check (
    octet_length(pkce_verifier_ciphertext) between 32 and 4096
  ),
  constraint login_attempt_key_version_check check (key_version between 1 and 32767),
  constraint login_attempt_return_to_check check (
    length(return_to) between 1 and 2048
    and left(return_to, 1) = '/'
    and left(return_to, 2) <> '//'
    and position(chr(92) in return_to) = 0
    and return_to !~ '[[:cntrl:]]'
  ),
  constraint login_attempt_purpose_check check (purpose in ('login', 'step_up')),
  constraint login_attempt_user_check check (
    (purpose = 'step_up') = (user_id is not null)
  ),
  constraint login_attempt_agent_hash_check check (
    user_agent_hash is null or octet_length(user_agent_hash) = 32
  ),
  constraint login_attempt_expiry_check check (expires_at > created_at),
  constraint login_attempt_consumed_check check (
    consumed_at is null
    or (consumed_at >= created_at and consumed_at <= expires_at)
  )
);

create index login_attempt_user_idx on identity.login_attempt (user_id)
  where user_id is not null;
create index login_attempt_expires_idx on identity.login_attempt (expires_at);

create table identity.web_session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.app_user(id) on delete cascade,
  identity_issuer text not null,
  token_hash bytea not null unique,
  zitadel_session_id text,
  oidc_sid text,
  acr text,
  id_token_hint_ciphertext bytea,
  key_version smallint,
  amr text[] not null,
  auth_time timestamptz not null,
  aal smallint not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  ip inet,
  user_agent_hash bytea,
  constraint web_session_token_hash_check check (octet_length(token_hash) = 32),
  constraint web_session_issuer_check check (
    length(identity_issuer) between 8 and 2048
    and identity_issuer = btrim(identity_issuer)
    and identity_issuer ~ '^https?://'
  ),
  constraint web_session_oidc_sid_check check (
    oidc_sid is null
    or (
      length(btrim(oidc_sid)) between 1 and 255
      and oidc_sid = btrim(oidc_sid)
    )
  ),
  constraint web_session_acr_check check (
    acr is null
    or (
      length(btrim(acr)) between 1 and 255
      and acr = btrim(acr)
    )
  ),
  constraint web_session_zitadel_session_check check (
    zitadel_session_id is null
    or (
      length(btrim(zitadel_session_id)) between 1 and 255
      and zitadel_session_id = btrim(zitadel_session_id)
    )
  ),
  constraint web_session_sealed_hint_check check (
    (id_token_hint_ciphertext is null) = (key_version is null)
  ),
  constraint web_session_key_version_check check (
    key_version is null or key_version between 1 and 32767
  ),
  constraint web_session_amr_check check (
    cardinality(amr) between 1 and 16
    and not ('' = any (amr))
  ),
  constraint web_session_auth_time_check check (auth_time <= created_at),
  constraint web_session_aal_check check (aal between 1 and 3),
  constraint web_session_last_seen_check check (
    last_seen_at >= created_at and last_seen_at <= idle_expires_at
  ),
  constraint web_session_idle_check check (
    idle_expires_at > created_at and idle_expires_at <= absolute_expires_at
  ),
  constraint web_session_absolute_check check (absolute_expires_at > created_at),
  constraint web_session_revoked_check check (
    revoked_at is null or revoked_at >= created_at
  ),
  constraint web_session_revoke_reason_check check (
    (revoked_at is null) = (revoke_reason is null)
    and (revoke_reason is null or length(revoke_reason) between 1 and 500)
  ),
  constraint web_session_agent_hash_check check (
    user_agent_hash is null or octet_length(user_agent_hash) = 32
  )
);

-- Sessions are updated on every request. A lower fillfactor leaves room for
-- HOT updates and keeps the heap compact.
alter table identity.web_session set (fillfactor = 90);

create index web_session_user_idx on identity.web_session (user_id);
-- idle_expires_at is deliberately not indexed: it changes on every touch and
-- an index on it would defeat HOT updates. Cleanup scans absolute_expires_at.
create index web_session_absolute_expires_idx
  on identity.web_session (absolute_expires_at)
  where revoked_at is null;
create index web_session_zitadel_session_idx
  on identity.web_session (zitadel_session_id)
  where zitadel_session_id is not null;
create index web_session_oidc_sid_idx
  on identity.web_session (identity_issuer, oidc_sid)
  where oidc_sid is not null;

-- A session identifies one authenticated login. Its subject, token, assurance
-- and absolute lifetime are fixed at creation, and a revocation is final.
-- Touching last_seen_at and idle_expires_at stays allowed.
create or replace function identity.prevent_web_session_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.identity_issuer is distinct from old.identity_issuer
    or new.token_hash is distinct from old.token_hash
    or new.oidc_sid is distinct from old.oidc_sid
    or new.acr is distinct from old.acr
    or new.amr is distinct from old.amr
    or new.auth_time is distinct from old.auth_time
    or new.aal is distinct from old.aal
    or new.created_at is distinct from old.created_at
    or new.absolute_expires_at is distinct from old.absolute_expires_at then
    raise exception 'web session identity is immutable' using errcode = '23514';
  end if;
  if old.revoked_at is not null
    and (
      new.revoked_at is distinct from old.revoked_at
      or new.revoke_reason is distinct from old.revoke_reason
    ) then
    raise exception 'web session revocation is final' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger web_session_identity_immutable
before update of
  id,
  user_id,
  identity_issuer,
  token_hash,
  oidc_sid,
  acr,
  amr,
  auth_time,
  aal,
  created_at,
  absolute_expires_at,
  revoked_at,
  revoke_reason
on identity.web_session
for each row execute function identity.prevent_web_session_identity_change();

-- Down Migration
drop table if exists identity.web_session;
drop table if exists identity.login_attempt;
drop table if exists identity.app_user;
drop function if exists identity.prevent_web_session_identity_change();
drop function if exists identity.prevent_app_user_identity_change();
drop function if exists public.touch_updated_at();
drop schema if exists identity;
