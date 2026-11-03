-- Up Migration
create schema identity;

create table identity.app_user (
  id uuid primary key default gen_random_uuid(),
  zitadel_sub text not null unique,
  email text not null unique,
  email_verified_at timestamptz,
  display_name text,
  home_org_id uuid,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint app_user_zitadel_sub_not_blank check (btrim(zitadel_sub) <> ''),
  constraint app_user_email_lowercase check (email = lower(email)),
  constraint app_user_email_not_blank check (btrim(email) <> ''),
  constraint app_user_display_name_not_blank check (
    display_name is null or btrim(display_name) <> ''
  ),
  constraint app_user_status_valid check (
    status in ('active', 'suspended', 'deactivated')
  ),
  constraint app_user_last_login_after_created check (
    last_login_at is null or last_login_at >= created_at
  )
);

create index app_user_home_org_idx on identity.app_user (home_org_id);
create index app_user_status_idx on identity.app_user (status);

create table identity.login_attempt (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references identity.app_user (id) on delete cascade,
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
  constraint login_attempt_state_hash_length check (octet_length(state_hash) = 32),
  constraint login_attempt_nonce_hash_length check (octet_length(nonce_hash) = 32),
  constraint login_attempt_user_agent_hash_length check (
    user_agent_hash is null or octet_length(user_agent_hash) = 32
  ),
  constraint login_attempt_key_version_valid check (key_version >= 1),
  constraint login_attempt_purpose_valid check (purpose in ('login', 'step_up')),
  constraint login_attempt_purpose_user check (
    (purpose = 'login' and user_id is null)
    or (purpose = 'step_up' and user_id is not null)
  ),
  constraint login_attempt_return_to_internal check (
    return_to like '/%'
    and return_to not like '//%'
    and position(chr(92) in return_to) = 0
    and return_to !~ '[[:cntrl:]]'
  ),
  constraint login_attempt_expiry_after_creation check (expires_at > created_at),
  constraint login_attempt_consumed_after_creation check (
    consumed_at is null or consumed_at >= created_at
  )
);

create index login_attempt_expires_at_idx on identity.login_attempt (expires_at);
create index login_attempt_user_id_idx on identity.login_attempt (user_id);

create table identity.web_session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.app_user (id) on delete cascade,
  token_hash bytea not null unique,
  zitadel_session_id text,
  id_token_hint_ciphertext bytea,
  key_version smallint,
  amr text[] not null default '{}',
  auth_time timestamptz not null,
  aal smallint not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  ip inet,
  user_agent_hash bytea,
  constraint web_session_token_hash_length check (octet_length(token_hash) = 32),
  constraint web_session_user_agent_hash_length check (
    user_agent_hash is null or octet_length(user_agent_hash) = 32
  ),
  constraint web_session_id_token_hint_pair check (
    (id_token_hint_ciphertext is null and key_version is null)
    or (id_token_hint_ciphertext is not null and key_version is not null)
  ),
  constraint web_session_key_version_valid check (key_version is null or key_version >= 1),
  constraint web_session_aal_valid check (aal between 1 and 3),
  constraint web_session_zitadel_session_id_not_blank check (
    zitadel_session_id is null or btrim(zitadel_session_id) <> ''
  ),
  constraint web_session_last_seen_after_creation check (last_seen_at >= created_at),
  constraint web_session_idle_expiry_after_creation check (idle_expires_at > created_at),
  constraint web_session_absolute_expiry_after_creation check (
    absolute_expires_at > created_at
  ),
  constraint web_session_expiry_order check (idle_expires_at <= absolute_expires_at),
  constraint web_session_revoked_after_creation check (
    revoked_at is null or revoked_at >= created_at
  )
);

create index web_session_user_id_idx on identity.web_session (user_id);
create index web_session_active_idx on identity.web_session (user_id, idle_expires_at)
  where revoked_at is null;
create index web_session_expiry_idx on identity.web_session (absolute_expires_at);

-- Down Migration
drop table if exists identity.web_session;
drop table if exists identity.login_attempt;
drop table if exists identity.app_user;
drop schema if exists identity;
