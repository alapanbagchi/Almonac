-- Up Migration
create table identity.invitation (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  organisation_id uuid not null,
  hospital_id uuid,
  token_hash bytea not null unique,
  kind text not null,
  zitadel_sub text,
  invited_by uuid not null references identity.app_user (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint invitation_email_lowercase check (email = lower(email)),
  constraint invitation_email_not_blank check (btrim(email) <> ''),
  constraint invitation_token_hash_length check (octet_length(token_hash) = 32),
  constraint invitation_kind_valid check (kind in ('new_user', 'existing_user')),
  constraint invitation_existing_user_has_subject check (
    kind <> 'existing_user' or zitadel_sub is not null
  ),
  constraint invitation_zitadel_sub_not_blank check (
    zitadel_sub is null or btrim(zitadel_sub) <> ''
  ),
  constraint invitation_expiry_after_creation check (expires_at > created_at),
  constraint invitation_accepted_after_creation check (
    accepted_at is null or accepted_at >= created_at
  ),
  constraint invitation_revoked_after_creation check (
    revoked_at is null or revoked_at >= created_at
  )
);

create unique index invitation_pending_hospital_key on identity.invitation (
  email,
  hospital_id
)
  where hospital_id is not null and accepted_at is null and revoked_at is null;

create unique index invitation_pending_org_key on identity.invitation (
  email,
  organisation_id
)
  where hospital_id is null and accepted_at is null and revoked_at is null;

create index invitation_organisation_idx on identity.invitation (organisation_id);
create index invitation_hospital_idx on identity.invitation (hospital_id);
create index invitation_invited_by_idx on identity.invitation (invited_by);

-- Append-only. The migration role owns this table; the runtime role must not.
create table identity.audit_event (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references identity.app_user (id) on delete restrict,
  actor_type text not null,
  session_id uuid,
  organisation_id uuid,
  hospital_id uuid,
  event_type text not null,
  outcome text not null,
  reason_code text,
  target_type text,
  target_id text,
  ip inet,
  user_agent_hash bytea,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_event_actor_type_valid check (
    actor_type in ('user', 'system', 'service', 'break_glass')
  ),
  constraint audit_event_event_type_not_blank check (btrim(event_type) <> ''),
  constraint audit_event_outcome_valid check (
    outcome in ('success', 'failure', 'denied')
  ),
  constraint audit_event_user_agent_hash_length check (
    user_agent_hash is null or octet_length(user_agent_hash) = 32
  ),
  constraint audit_event_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint audit_event_hospital_requires_organisation check (
    hospital_id is null or organisation_id is not null
  )
);

create index audit_event_occurred_at_idx on identity.audit_event (occurred_at);
create index audit_event_actor_user_idx on identity.audit_event (actor_user_id);
create index audit_event_organisation_idx on identity.audit_event (organisation_id);
create index audit_event_hospital_idx on identity.audit_event (hospital_id);
create index audit_event_event_type_idx on identity.audit_event (event_type);

create function identity.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'identity.audit_event is append-only' using errcode = '55000';
end;
$$;

create trigger audit_event_append_only
before update or delete on identity.audit_event
for each row execute function identity.reject_audit_mutation();

create trigger audit_event_no_truncate
before truncate on identity.audit_event
for each statement execute function identity.reject_audit_mutation();

revoke update, delete, truncate on identity.audit_event from public;

-- Down Migration
drop trigger if exists audit_event_no_truncate on identity.audit_event;
drop trigger if exists audit_event_append_only on identity.audit_event;
drop function if exists identity.reject_audit_mutation();
drop table if exists identity.audit_event;
drop table if exists identity.invitation;
