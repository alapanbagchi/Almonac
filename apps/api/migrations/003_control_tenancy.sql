-- Up Migration
set local lock_timeout = '5s';

create schema control;
comment on schema control is 'Tenancy and authorisation records. No clinical data.';

create table control.organisation (
  id uuid primary key default gen_random_uuid(),
  zitadel_org_id text unique,
  name text not null,
  slug text not null unique,
  status text not null default 'pending',
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_zitadel_id_check check (
    zitadel_org_id is null
    or (
      length(btrim(zitadel_org_id)) between 1 and 255
      and zitadel_org_id = btrim(zitadel_org_id)
    )
  ),
  constraint organisation_name_check check (
    length(btrim(name)) between 1 and 200 and name = btrim(name)
  ),
  constraint organisation_slug_check check (
    length(slug) between 1 and 63
    and slug = lower(slug)
    and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  ),
  constraint organisation_status_check check (
    status in ('pending', 'active', 'suspended', 'archived')
  ),
  constraint organisation_active_check check (
    status <> 'active' or (zitadel_org_id is not null and provisioned_at is not null)
  ),
  constraint organisation_provisioned_check check (
    provisioned_at is null or provisioned_at >= created_at
  )
);

create table control.hospital (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references control.organisation(id) on delete restrict,
  name text not null,
  slug text not null,
  timezone text not null default 'UTC',
  status text not null default 'pending',
  primary_domain_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_name_check check (
    length(btrim(name)) between 1 and 200 and name = btrim(name)
  ),
  constraint hospital_slug_check check (
    length(slug) between 1 and 63
    and slug = lower(slug)
    and slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  ),
  constraint hospital_timezone_check check (
    length(btrim(timezone)) between 1 and 64 and timezone = btrim(timezone)
  ),
  constraint hospital_status_check check (
    status in ('pending', 'active', 'suspended', 'closed')
  ),
  constraint hospital_active_check check (
    status <> 'active' or primary_domain_id is not null
  ),
  constraint hospital_organisation_slug_key unique (organisation_id, slug),
  constraint hospital_id_organisation_key unique (id, organisation_id)
);

create table control.hospital_domain (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references control.hospital(id) on delete cascade,
  domain citext not null unique,
  verification_token_hash bytea,
  verified_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_domain_format_check check (
    length(domain::text) between 4 and 253
    and domain::text = lower(domain::text)
    and domain::text ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  constraint hospital_domain_verification_check check (
    verification_token_hash is null or octet_length(verification_token_hash) = 32
  ),
  constraint hospital_domain_verified_check check (
    verified_at is null or verified_at >= created_at
  ),
  constraint hospital_domain_retired_check check (
    retired_at is null or retired_at >= created_at
  ),
  constraint hospital_domain_retired_after_verified_check check (
    verified_at is null or retired_at is null or retired_at >= verified_at
  ),
  constraint hospital_domain_id_hospital_key unique (id, hospital_id)
);

alter table control.hospital
  add constraint hospital_primary_domain_fk
  foreign key (primary_domain_id, id)
  references control.hospital_domain (id, hospital_id)
  on delete restrict;

alter table identity.app_user
  add constraint app_user_home_organisation_fk
  foreign key (home_organisation_id)
  references control.organisation(id)
  on delete set null;

create table control.schema_metadata (
  id smallint primary key,
  version integer not null,
  migrated_at timestamptz not null default now(),
  constraint schema_metadata_singleton_check check (id = 1),
  constraint schema_metadata_version_check check (version >= 1)
);

create index hospital_organisation_idx on control.hospital (organisation_id);
create index hospital_primary_domain_idx on control.hospital (primary_domain_id, id)
  where primary_domain_id is not null;
create index hospital_domain_hospital_idx on control.hospital_domain (hospital_id);

create trigger organisation_touch_updated_at
before update on control.organisation
for each row execute function public.touch_updated_at();

create trigger hospital_touch_updated_at
before update on control.hospital
for each row execute function public.touch_updated_at();

create trigger hospital_domain_touch_updated_at
before update on control.hospital_domain
for each row execute function public.touch_updated_at();

create or replace function control.prevent_organisation_identity_change()
returns trigger
language plpgsql
as $$
begin
  if old.zitadel_org_id is not null
     and new.zitadel_org_id is distinct from old.zitadel_org_id then
    raise exception 'organisation identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger organisation_identity_immutable
before update of zitadel_org_id on control.organisation
for each row execute function control.prevent_organisation_identity_change();

create or replace function control.prevent_hospital_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'hospital organisation is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger hospital_identity_immutable
before update of organisation_id on control.hospital
for each row execute function control.prevent_hospital_identity_change();

create or replace function control.validate_hospital_primary_domain()
returns trigger
language plpgsql
as $$
declare
  domain_hospital_id uuid;
  domain_verified_at timestamptz;
  domain_retired_at timestamptz;
begin
  if new.primary_domain_id is null then
    if new.status = 'active' then
      raise exception 'an active hospital needs a primary domain' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Serialize with domain retirement so both sides see each other's writes.
  perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));

  select hospital_id, verified_at, retired_at
    into domain_hospital_id, domain_verified_at, domain_retired_at
    from control.hospital_domain
   where id = new.primary_domain_id;

  if not found then
    raise exception 'primary domain does not exist' using errcode = '23503';
  end if;
  if domain_hospital_id is distinct from new.id then
    raise exception 'primary domain belongs to another hospital' using errcode = '23514';
  end if;
  if domain_verified_at is null or domain_retired_at is not null then
    raise exception 'primary domain must be verified and not retired' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger hospital_primary_domain_check
before insert or update of primary_domain_id, status on control.hospital
for each row execute function control.validate_hospital_primary_domain();

create or replace function control.prevent_primary_domain_retirement()
returns trigger
language plpgsql
as $$
begin
  if new.verified_at is null or new.retired_at is not null then
    -- Serialize with primary-domain validation; see validate_hospital_primary_domain.
    perform pg_advisory_xact_lock(hashtextextended(new.hospital_id::text, 0));

    if exists (
      select 1 from control.hospital where primary_domain_id = new.id
    ) then
      raise exception 'a primary domain cannot be unverified or retired' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger hospital_domain_retirement_check
before update of verified_at, retired_at on control.hospital_domain
for each row execute function control.prevent_primary_domain_retirement();

create or replace function control.prevent_hospital_domain_identity_change()
returns trigger
language plpgsql
as $$
begin
  if old.verified_at is not null
     and (
       new.domain is distinct from old.domain
       or new.hospital_id is distinct from old.hospital_id
     ) then
    raise exception 'a verified hospital domain is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger hospital_domain_identity_immutable
before update of domain, hospital_id on control.hospital_domain
for each row execute function control.prevent_hospital_domain_identity_change();

-- Down Migration
drop trigger if exists hospital_domain_identity_immutable on control.hospital_domain;
drop function if exists control.prevent_hospital_domain_identity_change();
drop trigger if exists hospital_domain_retirement_check on control.hospital_domain;
drop function if exists control.prevent_primary_domain_retirement();
drop trigger if exists hospital_primary_domain_check on control.hospital;
drop function if exists control.validate_hospital_primary_domain();
drop trigger if exists hospital_identity_immutable on control.hospital;
drop function if exists control.prevent_hospital_identity_change();
drop trigger if exists organisation_identity_immutable on control.organisation;
drop function if exists control.prevent_organisation_identity_change();
drop trigger if exists hospital_domain_touch_updated_at on control.hospital_domain;
drop trigger if exists hospital_touch_updated_at on control.hospital;
drop trigger if exists organisation_touch_updated_at on control.organisation;
alter table identity.app_user drop constraint if exists app_user_home_organisation_fk;
alter table control.hospital drop constraint if exists hospital_primary_domain_fk;
drop table if exists control.schema_metadata;
drop table if exists control.hospital_domain;
drop table if exists control.hospital;
drop table if exists control.organisation;
drop schema if exists control;
