-- Up Migration
create table control.permission (
  key text primary key,
  scope text not null,
  description text not null,
  constraint permission_key_format check (key ~ '^[a-z][a-z0-9_.]*$'),
  constraint permission_scope_valid check (
    scope in ('platform', 'organisation', 'hospital')
  ),
  constraint permission_description_not_blank check (btrim(description) <> '')
);

create table control.role (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references control.organisation (id) on delete restrict,
  key text not null,
  name text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  constraint role_key_format check (key ~ '^[a-z][a-z0-9_.]*$'),
  constraint role_name_not_blank check (btrim(name) <> ''),
  constraint role_scope_valid check (
    scope in ('platform', 'organisation', 'hospital')
  ),
  constraint role_platform_scope_is_system check (
    scope <> 'platform' or organisation_id is null
  )
);

create unique index role_system_key on control.role (key) where organisation_id is null;
create unique index role_organisation_key on control.role (organisation_id, key)
  where organisation_id is not null;

create index role_organisation_idx on control.role (organisation_id);

create table control.role_permission (
  role_id uuid not null references control.role (id) on delete cascade,
  permission_key text not null references control.permission (key) on delete restrict,
  primary key (role_id, permission_key)
);

create index role_permission_permission_idx on control.role_permission (permission_key);

create function control.enforce_role_permission_scope()
returns trigger
language plpgsql
as $$
declare
  role_scope text;
  permission_scope text;
begin
  select scope into role_scope from control.role where id = new.role_id;
  select scope into permission_scope
  from control.permission
  where key = new.permission_key;

  if role_scope = 'organisation' and permission_scope = 'platform' then
    raise exception 'an organisation role cannot hold a platform permission'
      using errcode = '23514';
  end if;

  if role_scope = 'hospital'
    and permission_scope in ('platform', 'organisation') then
    raise exception 'a hospital role cannot hold a platform or organisation permission'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger role_permission_scope
before insert or update on control.role_permission
for each row execute function control.enforce_role_permission_scope();

create table control.membership (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.app_user (id) on delete cascade,
  organisation_id uuid not null references control.organisation (id) on delete restrict,
  hospital_id uuid,
  status text not null default 'invited',
  is_break_glass boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint membership_status_valid check (
    status in ('invited', 'active', 'suspended', 'revoked')
  ),
  constraint membership_active_requires_acceptance check (
    status <> 'active' or (accepted_at is not null and starts_at is not null)
  ),
  constraint membership_time_order check (
    ends_at is null or starts_at is null or ends_at > starts_at
  ),
  constraint membership_break_glass_requires_hospital check (
    not is_break_glass or hospital_id is not null
  ),
  constraint membership_hospital_organisation_fk
    foreign key (hospital_id, organisation_id)
    references control.hospital (id, organisation_id) on delete restrict
);

create index membership_user_idx on control.membership (user_id);
create index membership_organisation_idx on control.membership (organisation_id);
create index membership_hospital_idx on control.membership (hospital_id);
create index membership_status_idx on control.membership (status);

-- One membership row per user and scope. A new invitation, suspension,
-- reactivation or revocation updates that row, so the status is never ambiguous.
create unique index membership_hospital_key on control.membership (
  user_id,
  hospital_id
)
  where hospital_id is not null;

create unique index membership_org_key on control.membership (
  user_id,
  organisation_id
)
  where hospital_id is null;

create table control.membership_role (
  membership_id uuid not null references control.membership (id) on delete cascade,
  role_id uuid not null references control.role (id) on delete restrict,
  primary key (membership_id, role_id)
);

create index membership_role_role_idx on control.membership_role (role_id);

create table control.invitation_role (
  invitation_id uuid not null references identity.invitation (id) on delete cascade,
  role_id uuid not null references control.role (id) on delete restrict,
  primary key (invitation_id, role_id)
);

create index invitation_role_role_idx on control.invitation_role (role_id);

create table control.break_glass_grant (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references control.hospital (id) on delete restrict,
  user_id uuid not null references identity.app_user (id) on delete restrict,
  reason text not null,
  scope text not null default 'read_only',
  approved_by uuid not null references identity.app_user (id) on delete restrict,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint break_glass_reason_not_blank check (btrim(reason) <> ''),
  constraint break_glass_scope_valid check (scope in ('read_only')),
  constraint break_glass_separate_approver check (approved_by <> user_id),
  constraint break_glass_expiry_after_start check (expires_at > starts_at),
  constraint break_glass_revoked_after_creation check (
    revoked_at is null or revoked_at >= created_at
  )
);

create index break_glass_grant_user_idx on control.break_glass_grant (user_id);
create index break_glass_grant_hospital_idx on control.break_glass_grant (hospital_id);
create index break_glass_grant_active_idx on control.break_glass_grant (
  hospital_id,
  expires_at
)
  where revoked_at is null;

create function control.prevent_membership_scope_change()
returns trigger
language plpgsql
as $$
begin
  if new.organisation_id <> old.organisation_id
    or new.hospital_id is distinct from old.hospital_id then
    raise exception 'membership scope is immutable' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger membership_scope_immutable
before update of organisation_id, hospital_id on control.membership
for each row execute function control.prevent_membership_scope_change();

create function control.enforce_membership_role_scope()
returns trigger
language plpgsql
as $$
declare
  membership_org uuid;
  membership_hospital uuid;
  role_org uuid;
  role_scope text;
begin
  select organisation_id, hospital_id
  into membership_org, membership_hospital
  from control.membership
  where id = new.membership_id;

  select organisation_id, scope
  into role_org, role_scope
  from control.role
  where id = new.role_id;

  if role_org is not null and role_org is distinct from membership_org then
    raise exception 'role organisation does not match membership organisation'
      using errcode = '23514';
  end if;

  if role_scope = 'platform' then
    raise exception 'platform roles are not membership roles'
      using errcode = '23514';
  end if;

  if role_scope = 'organisation' and membership_hospital is not null then
    raise exception 'an organisation role requires an organisation membership'
      using errcode = '23514';
  end if;

  if role_scope = 'hospital' and membership_hospital is null then
    raise exception 'a hospital role requires a hospital membership'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger membership_role_scope
before insert or update on control.membership_role
for each row execute function control.enforce_membership_role_scope();

create function control.enforce_invitation_role_scope()
returns trigger
language plpgsql
as $$
declare
  invitation_org uuid;
  invitation_hospital uuid;
  role_org uuid;
  role_scope text;
begin
  select organisation_id, hospital_id
  into invitation_org, invitation_hospital
  from identity.invitation
  where id = new.invitation_id;

  select organisation_id, scope
  into role_org, role_scope
  from control.role
  where id = new.role_id;

  if role_org is not null and role_org is distinct from invitation_org then
    raise exception 'role organisation does not match invitation organisation'
      using errcode = '23514';
  end if;

  if role_scope = 'platform' then
    raise exception 'platform roles are not invitation roles'
      using errcode = '23514';
  end if;

  if role_scope = 'organisation' and invitation_hospital is not null then
    raise exception 'an organisation role requires an organisation invitation'
      using errcode = '23514';
  end if;

  if role_scope = 'hospital' and invitation_hospital is null then
    raise exception 'a hospital role requires a hospital invitation'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger invitation_role_scope
before insert or update on control.invitation_role
for each row execute function control.enforce_invitation_role_scope();

-- Down Migration
drop trigger if exists invitation_role_scope on control.invitation_role;
drop function if exists control.enforce_invitation_role_scope();
drop trigger if exists membership_role_scope on control.membership_role;
drop function if exists control.enforce_membership_role_scope();
drop trigger if exists membership_scope_immutable on control.membership;
drop function if exists control.prevent_membership_scope_change();
drop trigger if exists role_permission_scope on control.role_permission;
drop function if exists control.enforce_role_permission_scope();
drop table if exists control.break_glass_grant;
drop table if exists control.invitation_role;
drop table if exists control.membership_role;
drop table if exists control.membership;
drop table if exists control.role_permission;
drop table if exists control.role;
drop table if exists control.permission;
