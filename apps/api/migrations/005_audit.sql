-- Up Migration
set local lock_timeout = '5s';

create schema audit;
comment on schema audit is 'Append-only security and access events.';

-- The catalogue fixes the event vocabulary and the only metadata keys that an
-- event may carry. It prevents free-form PHI from entering the audit log.
create table audit.event_type (
  key text primary key,
  description text not null,
  requires_reason boolean not null default false,
  metadata_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint event_type_key_check check (
    length(key) between 3 and 100
    and key ~ '^[a-z][a-z0-9_.]*$'
  ),
  constraint event_type_description_check check (
    length(btrim(description)) between 1 and 500
  ),
  constraint event_type_metadata_keys_check check (
    array_position(metadata_keys, '') is null
  )
);

create table audit.event (
  id bigint generated always as identity,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references identity.app_user(id) on delete restrict,
  actor_type text not null,
  session_id uuid,
  organisation_id uuid references control.organisation(id) on delete restrict,
  hospital_id uuid,
  event_type text not null references audit.event_type(key) on delete restrict,
  outcome text not null,
  target_type text,
  target_id text,
  request_id text,
  reason text,
  reason_code text,
  ip inet,
  user_agent_hash bytea,
  metadata jsonb not null default '{}'::jsonb,
  primary key (id, occurred_at),
  constraint audit_actor_type_check check (
    actor_type in ('user', 'system', 'service', 'break_glass')
  ),
  constraint audit_actor_user_check check (
    actor_type <> 'user' or actor_user_id is not null
  ),
  constraint audit_event_type_check check (
    length(event_type) between 3 and 100
    and event_type ~ '^[a-z][a-z0-9_.]*$'
  ),
  constraint audit_outcome_check check (outcome in ('success', 'failure', 'denied')),
  constraint audit_target_type_check check (
    target_type is null
    or (length(target_type) between 1 and 50 and target_type ~ '^[a-z][a-z0-9_.]*$')
  ),
  constraint audit_target_id_check check (
    target_id is null or length(target_id) between 1 and 255
  ),
  constraint audit_request_id_check check (
    request_id is null or request_id ~ '^[A-Za-z0-9_.:-]{1,100}$'
  ),
  constraint audit_reason_check check (
    reason is null or length(btrim(reason)) between 1 and 500
  ),
  constraint audit_reason_code_check check (
    reason_code is null
    or (length(reason_code) between 1 and 64 and reason_code ~ '^[a-z][a-z0-9_.]*$')
  ),
  constraint audit_agent_hash_check check (
    user_agent_hash is null or octet_length(user_agent_hash) = 32
  ),
  constraint audit_metadata_check check (
    jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8192
  ),
  constraint audit_hospital_organisation_fk
    foreign key (hospital_id, organisation_id)
    references control.hospital (id, organisation_id)
    on delete restrict,
  constraint audit_hospital_scope_check check (
    hospital_id is null or organisation_id is not null
  )
) partition by range (occurred_at);

create table audit.event_default partition of audit.event default;

create or replace function audit.ensure_month_partition(target_day date)
returns void
language plpgsql
as $$
declare
  start_date date := date_trunc('month', target_day)::date;
  end_date date := (start_date + interval '1 month')::date;
  partition_name text := format('event_%s', to_char(start_date, 'YYYY_MM'));
begin
  if to_regclass(format('audit.%I', partition_name)) is null then
    execute format(
      'create table audit.%I partition of audit.event for values from (%L) to (%L)',
      partition_name,
      start_date,
      end_date
    );
  end if;

  -- A new partition starts without the parent table's grants.
  execute format(
    'grant select, insert on audit.%I to almonac_app',
    partition_name
  );
end;
$$;

revoke all on function audit.ensure_month_partition(date) from public;

select audit.ensure_month_partition(current_date);
select audit.ensure_month_partition((current_date + interval '1 month')::date);

create index event_occurred_at_brin on audit.event using brin (occurred_at);
create index event_organisation_occurred_idx
  on audit.event (organisation_id, occurred_at desc);
create index event_hospital_occurred_idx
  on audit.event (hospital_id, occurred_at desc)
  where hospital_id is not null;
create index event_hospital_organisation_idx
  on audit.event (hospital_id, organisation_id)
  where hospital_id is not null;
create index event_actor_occurred_idx
  on audit.event (actor_user_id, occurred_at desc)
  where actor_user_id is not null;
create index event_request_idx on audit.event (request_id)
  where request_id is not null;

create or replace function audit.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit.event is append-only' using errcode = '55000';
end;
$$;

create or replace function audit.validate_occurred_at()
returns trigger
language plpgsql
as $$
begin
  -- The application must not be able to backdate an audit event. A small
  -- allowance covers clock skew between the application and the database.
  if new.occurred_at < now() - interval '1 minute'
     or new.occurred_at > now() + interval '1 minute' then
    raise exception 'audit event time must be current' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger event_validate_occurred_at
before insert on audit.event
for each row execute function audit.validate_occurred_at();

create or replace function audit.validate_event_catalogue()
returns trigger
language plpgsql
as $$
declare
  needs_reason boolean;
  allowed_keys text[];
  extra_key text;
begin
  select requires_reason, metadata_keys
    into needs_reason, allowed_keys
    from audit.event_type
   where key = new.event_type;

  if not found then
    raise exception 'unknown audit event type' using errcode = '23503';
  end if;

  if needs_reason and new.reason_code is null then
    raise exception 'audit event requires a reason code' using errcode = '23514';
  end if;

  if jsonb_typeof(new.metadata) = 'object' then
    select key
      into extra_key
      from jsonb_object_keys(new.metadata) as key
     where key <> all (allowed_keys)
     limit 1;

    if extra_key is not null then
      raise exception 'audit metadata key is not allowed: %', extra_key
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger event_validate_catalogue
before insert on audit.event
for each row execute function audit.validate_event_catalogue();

create trigger event_no_update_delete
before update or delete on audit.event
for each row execute function audit.reject_mutation();

create trigger event_no_truncate
before truncate on audit.event
for each statement execute function audit.reject_mutation();

-- Down Migration
drop trigger if exists event_no_truncate on audit.event;
drop trigger if exists event_no_update_delete on audit.event;
drop trigger if exists event_validate_catalogue on audit.event;
drop function if exists audit.validate_event_catalogue();
drop trigger if exists event_validate_occurred_at on audit.event;
drop function if exists audit.validate_occurred_at();
drop function if exists audit.reject_mutation();
drop table if exists audit.event;
drop table if exists audit.event_type;
drop function if exists audit.ensure_month_partition(date);
drop schema if exists audit;
