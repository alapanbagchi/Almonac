-- Up Migration
create schema control;

create table control.organisation (
  id uuid primary key default gen_random_uuid(),
  zitadel_org_id text unique,
  name text not null,
  slug text not null unique,
  status text not null default 'pending',
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisation_zitadel_org_id_not_blank check (
    zitadel_org_id is null or btrim(zitadel_org_id) <> ''
  ),
  constraint organisation_name_not_blank check (btrim(name) <> ''),
  constraint organisation_slug_lowercase check (slug = lower(slug)),
  constraint organisation_slug_format check (
    slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  ),
  constraint organisation_status_valid check (
    status in ('pending', 'active', 'suspended', 'archived')
  ),
  constraint organisation_active_requires_provisioning check (
    status <> 'active'
    or (provisioned_at is not null and zitadel_org_id is not null)
  )
);

create table control.hospital (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references control.organisation (id) on delete restrict,
  name text not null,
  slug text not null,
  domain text not null unique,
  domain_verified_at timestamptz,
  status text not null default 'pending',
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hospital_name_not_blank check (btrim(name) <> ''),
  constraint hospital_slug_lowercase check (slug = lower(slug)),
  constraint hospital_slug_format check (
    slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
  ),
  constraint hospital_domain_lowercase check (domain = lower(domain)),
  constraint hospital_domain_format check (
    length(domain) <= 253
    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'
  ),
  constraint hospital_timezone_not_blank check (btrim(timezone) <> ''),
  constraint hospital_status_valid check (
    status in ('pending', 'active', 'suspended', 'closed')
  ),
  constraint hospital_active_requires_verified_domain check (
    status <> 'active' or domain_verified_at is not null
  ),
  constraint hospital_id_organisation_key unique (id, organisation_id)
);

create index hospital_organisation_idx on control.hospital (organisation_id);
create unique index hospital_slug_organisation_key on control.hospital (organisation_id, slug);

alter table identity.app_user
  add constraint app_user_home_org_fk
  foreign key (home_org_id) references control.organisation (id) on delete set null;

alter table identity.invitation
  add constraint invitation_organisation_fk
  foreign key (organisation_id) references control.organisation (id) on delete cascade;

alter table identity.invitation
  add constraint invitation_hospital_fk
  foreign key (hospital_id, organisation_id)
  references control.hospital (id, organisation_id) on delete cascade;

alter table identity.audit_event
  add constraint audit_event_organisation_fk
  foreign key (organisation_id) references control.organisation (id) on delete restrict;

alter table identity.audit_event
  add constraint audit_event_hospital_fk
  foreign key (hospital_id, organisation_id)
  references control.hospital (id, organisation_id) on delete restrict;

-- Down Migration
alter table identity.audit_event drop constraint if exists audit_event_hospital_fk;
alter table identity.audit_event drop constraint if exists audit_event_organisation_fk;
alter table identity.invitation drop constraint if exists invitation_hospital_fk;
alter table identity.invitation drop constraint if exists invitation_organisation_fk;
alter table identity.app_user drop constraint if exists app_user_home_org_fk;
drop table if exists control.hospital;
drop table if exists control.organisation;
drop schema if exists control;
