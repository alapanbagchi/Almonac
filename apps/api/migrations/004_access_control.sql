-- Up Migration
set local lock_timeout = '5s';

create table identity.invitation (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  organisation_id uuid not null references control.organisation(id) on delete cascade,
  hospital_id uuid,
  token_hash bytea not null unique,
  kind text not null,
  zitadel_sub text,
  invited_by uuid not null references identity.app_user(id) on delete restrict,
  status text not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references identity.app_user(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_email_check check (
    length(email) between 3 and 320
    and email = lower(email)
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint invitation_token_hash_check check (octet_length(token_hash) = 32),
  constraint invitation_kind_check check (kind in ('new_user', 'existing_user')),
  constraint invitation_subject_check check (
    (kind = 'existing_user') = (zitadel_sub is not null)
  ),
  constraint invitation_status_check check (
    status in ('pending', 'accepted', 'revoked', 'expired')
  ),
  constraint invitation_expiry_check check (expires_at > created_at),
  constraint invitation_accepted_check check (
    (status = 'accepted') = (accepted_at is not null)
    and (status = 'accepted') = (accepted_by_user_id is not null)
  ),
  constraint invitation_revoked_check check (
    (status = 'revoked') = (revoked_at is not null)
  ),
  constraint invitation_accept_time_check check (
    accepted_at is null or (accepted_at >= created_at and accepted_at <= expires_at)
  ),
  constraint invitation_revoke_time_check check (
    revoked_at is null or revoked_at >= created_at
  ),
  constraint invitation_hospital_organisation_fk
    foreign key (hospital_id, organisation_id)
    references control.hospital (id, organisation_id)
    on delete cascade
);

create index invitation_email_idx on identity.invitation (email);
create index invitation_organisation_idx on identity.invitation (organisation_id);
create index invitation_hospital_organisation_idx
  on identity.invitation (hospital_id, organisation_id)
  where hospital_id is not null;
create index invitation_invited_by_idx on identity.invitation (invited_by);
create index invitation_accepted_by_idx
  on identity.invitation (accepted_by_user_id)
  where accepted_by_user_id is not null;
create index invitation_expires_idx on identity.invitation (expires_at);

-- A new invitation for the same email and scope may start after an earlier
-- one expires. Overlap, not a stale pending row, is the conflict.
alter table identity.invitation
  add constraint invitation_hospital_no_overlap
  exclude using gist (
    email with =,
    hospital_id with =,
    tstzrange(created_at, expires_at, '[)') with &&
  )
  where (hospital_id is not null and status = 'pending');

alter table identity.invitation
  add constraint invitation_organisation_no_overlap
  exclude using gist (
    email with =,
    organisation_id with =,
    tstzrange(created_at, expires_at, '[)') with &&
  )
  where (hospital_id is null and status = 'pending');

create trigger invitation_touch_updated_at
before update on identity.invitation
for each row execute function public.touch_updated_at();

create or replace function identity.prevent_invitation_scope_change()
returns trigger
language plpgsql
as $$
begin
  if new.email is distinct from old.email
     or new.organisation_id is distinct from old.organisation_id
     or new.hospital_id is distinct from old.hospital_id
     or new.kind is distinct from old.kind
     or new.zitadel_sub is distinct from old.zitadel_sub then
    raise exception 'invitation scope is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invitation_scope_immutable
before update of email, organisation_id, hospital_id, kind, zitadel_sub
on identity.invitation
for each row execute function identity.prevent_invitation_scope_change();

-- Acceptance is a one-way transition. The service locks the invitation, copies
-- its roles, creates the membership and only then marks it accepted.
create or replace function identity.enforce_invitation_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'an invitation must start pending' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'invitation status is final' using errcode = '23514';
  end if;
  if old.accepted_by_user_id is not null
    and new.accepted_by_user_id is distinct from old.accepted_by_user_id then
    raise exception 'invitation acceptance is final' using errcode = '23514';
  end if;
  if new.status = 'accepted'
    and (new.accepted_at > now() or now() >= new.expires_at) then
    raise exception 'invitation acceptance must happen before expiry' using errcode = '23514';
  end if;
  if new.status = 'revoked' and new.revoked_at > now() then
    raise exception 'invitation revocation cannot be in the future' using errcode = '23514';
  end if;
  if new.status = 'expired' and new.expires_at > now() then
    raise exception 'an invitation cannot expire before its expiry time' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invitation_status_transition
before insert or update on identity.invitation
for each row execute function identity.enforce_invitation_transition();

create table control.permission (
  key text primary key,
  scope text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint permission_key_check check (
    length(key) between 2 and 64
    and key ~ '^[a-z][a-z0-9_.]*$'
  ),
  constraint permission_scope_check check (
    scope in ('platform', 'organisation', 'hospital')
  ),
  constraint permission_description_check check (
    length(btrim(description)) between 1 and 500
  )
);

create table control.role (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references control.organisation(id) on delete cascade,
  key text not null,
  name text not null,
  scope text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_key_check check (
    length(key) between 2 and 64
    and key ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint role_name_check check (
    length(btrim(name)) between 1 and 200 and name = btrim(name)
  ),
  constraint role_scope_check check (scope in ('platform', 'organisation', 'hospital')),
  constraint role_system_check check ((organisation_id is null) = is_system),
  constraint role_system_platform_check check (not is_system or scope = 'platform'),
  constraint role_platform_organisation_check check (
    scope <> 'platform' or organisation_id is null
  )
);

create unique index role_system_key_idx on control.role (key)
  where organisation_id is null;
create unique index role_organisation_key_idx on control.role (organisation_id, key)
  where organisation_id is not null;
create index role_organisation_idx on control.role (organisation_id)
  where organisation_id is not null;

create trigger role_touch_updated_at
before update on control.role
for each row execute function public.touch_updated_at();

create table control.role_template (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  scope text not null,
  created_at timestamptz not null default now(),
  constraint role_template_key_check check (
    length(key) between 2 and 64
    and key ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint role_template_scope_check check (scope in ('organisation', 'hospital'))
);

-- A template version is immutable. Editing a published template creates a new
-- version; a role records the exact version it was created from.
create table control.role_template_version (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references control.role_template(id) on delete cascade,
  version integer not null,
  name text not null,
  created_at timestamptz not null default now(),
  constraint role_template_version_number_check check (version >= 1),
  constraint role_template_version_name_check check (
    length(btrim(name)) between 1 and 200 and name = btrim(name)
  ),
  constraint role_template_version_key unique (template_id, version)
);

create index role_template_version_template_idx
  on control.role_template_version (template_id);

create or replace function control.prevent_role_template_version_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'role template version is immutable' using errcode = '23514';
end;
$$;

create trigger role_template_version_immutable
before update on control.role_template_version
for each row execute function control.prevent_role_template_version_change();

create table control.role_template_permission (
  template_version_id uuid not null
    references control.role_template_version(id) on delete cascade,
  permission_key text not null references control.permission(key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (template_version_id, permission_key)
);

create index role_template_permission_permission_idx
  on control.role_template_permission (permission_key);

create table control.role_permission (
  role_id uuid not null references control.role(id) on delete cascade,
  permission_key text not null references control.permission(key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create index role_permission_permission_idx on control.role_permission (permission_key);

alter table control.role
  add column source_template_version_id uuid
    references control.role_template_version(id) on delete restrict;

create index role_source_template_version_idx
  on control.role (source_template_version_id)
  where source_template_version_id is not null;

create table control.platform_assignment (
  user_id uuid not null references identity.app_user(id) on delete cascade,
  role_id uuid not null references control.role(id) on delete restrict,
  assigned_by uuid references identity.app_user(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index platform_assignment_role_idx on control.platform_assignment (role_id);
create index platform_assignment_assigned_by_idx
  on control.platform_assignment (assigned_by)
  where assigned_by is not null;

create table control.membership (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.app_user(id) on delete cascade,
  organisation_id uuid not null references control.organisation(id) on delete cascade,
  hospital_id uuid,
  status text not null default 'active',
  accepted_at timestamptz not null default now(),
  validity tstzrange not null default tstzrange(now(), null, '[)'),
  suspended_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references identity.app_user(id) on delete restrict,
  revoke_reason text,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint membership_status_check check (
    status in ('active', 'suspended', 'revoked', 'expired')
  ),
  constraint membership_validity_check check (not isempty(validity)),
  constraint membership_validity_start_check check (lower(validity) = accepted_at),
  constraint membership_accepted_check check (accepted_at >= created_at),
  constraint membership_suspended_check check (
    (status = 'suspended') = (suspended_at is not null)
  ),
  constraint membership_revoked_check check (
    (status = 'revoked') = (revoked_at is not null)
    and (status = 'revoked') = (revoked_by is not null)
    and (status = 'revoked') = (revoke_reason is not null)
  ),
  constraint membership_expired_check check (
    (status = 'expired') = (expired_at is not null)
  ),
  constraint membership_active_check check (
    status <> 'active'
    or (suspended_at is null and revoked_at is null and expired_at is null)
  ),
  constraint membership_suspend_time_check check (
    suspended_at is null or suspended_at >= accepted_at
  ),
  constraint membership_revoke_time_check check (
    revoked_at is null or revoked_at >= accepted_at
  ),
  constraint membership_expire_time_check check (
    expired_at is null or expired_at >= accepted_at
  ),
  constraint membership_revoke_reason_check check (
    revoke_reason is null or length(revoke_reason) between 1 and 500
  ),
  constraint membership_hospital_organisation_fk
    foreign key (hospital_id, organisation_id)
    references control.hospital (id, organisation_id)
    on delete restrict
);

create index membership_user_idx on control.membership (user_id);
create index membership_organisation_idx on control.membership (organisation_id);
create index membership_hospital_organisation_idx
  on control.membership (hospital_id, organisation_id)
  where hospital_id is not null;
create index membership_revoked_by_idx on control.membership (revoked_by)
  where revoked_by is not null;

alter table control.membership
  add constraint membership_hospital_no_overlap
  exclude using gist (
    user_id with =,
    hospital_id with =,
    validity with &&
  )
  where (hospital_id is not null and status in ('active', 'suspended'));

alter table control.membership
  add constraint membership_organisation_no_overlap
  exclude using gist (
    user_id with =,
    organisation_id with =,
    validity with &&
  )
  where (hospital_id is null and status in ('active', 'suspended'));

create trigger membership_touch_updated_at
before update on control.membership
for each row execute function public.touch_updated_at();

-- Assignment is history, not a mutable link: revoke closes the validity range
-- and keeps the actor and reason. A role can be assigned again later.
create table control.membership_role (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references control.membership(id) on delete cascade,
  role_id uuid not null references control.role(id) on delete restrict,
  assigned_by uuid references identity.app_user(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  validity tstzrange not null default tstzrange(now(), null, '[)'),
  revoked_at timestamptz,
  revoked_by uuid references identity.app_user(id) on delete restrict,
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint membership_role_validity_check check (not isempty(validity)),
  constraint membership_role_validity_start_check check (lower(validity) = assigned_at),
  constraint membership_role_revoked_check check (
    (revoked_at is null) = (revoke_reason is null)
    and (revoked_at is null) = (revoked_by is null)
  ),
  constraint membership_role_revoke_time_check check (
    revoked_at is null or revoked_at >= assigned_at
  ),
  constraint membership_role_revoke_reason_check check (
    revoke_reason is null or length(revoke_reason) between 1 and 500
  )
);

create index membership_role_membership_idx
  on control.membership_role (membership_id);
create index membership_role_role_idx on control.membership_role (role_id);
create index membership_role_assigned_by_idx on control.membership_role (assigned_by)
  where assigned_by is not null;
create index membership_role_revoked_by_idx on control.membership_role (revoked_by)
  where revoked_by is not null;

alter table control.membership_role
  add constraint membership_role_no_overlap
  exclude using gist (membership_id with =, role_id with =, validity with &&)
  where (revoked_at is null);

create table control.invitation_role (
  invitation_id uuid not null references identity.invitation(id) on delete cascade,
  role_id uuid not null references control.role(id) on delete restrict,
  assigned_by uuid references identity.app_user(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (invitation_id, role_id)
);

create index invitation_role_role_idx on control.invitation_role (role_id);
create index invitation_role_assigned_by_idx on control.invitation_role (assigned_by)
  where assigned_by is not null;

create table control.break_glass_grant (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references control.organisation(id) on delete restrict,
  hospital_id uuid not null,
  user_id uuid not null references identity.app_user(id) on delete cascade,
  approved_by uuid references identity.app_user(id) on delete restrict,
  approval_mode text not null default 'pre_approved',
  reason text not null,
  access_level text not null default 'read_only',
  status text not null default 'approved',
  validity tstzrange not null,
  approved_at timestamptz not null default now(),
  activated_at timestamptz,
  activated_by uuid references identity.app_user(id) on delete restrict,
  revoked_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint break_glass_hospital_organisation_fk
    foreign key (hospital_id, organisation_id)
    references control.hospital (id, organisation_id)
    on delete restrict,
  constraint break_glass_approval_mode_check check (
    approval_mode in ('pre_approved', 'emergency')
  ),
  constraint break_glass_approver_check check (
    (approval_mode = 'pre_approved') = (approved_by is not null)
    and (approved_by is null or approved_by <> user_id)
  ),
  constraint break_glass_reason_check check (
    length(btrim(reason)) between 1 and 500 and reason = btrim(reason)
  ),
  constraint break_glass_access_level_check check (access_level = 'read_only'),
  constraint break_glass_status_check check (
    status in ('approved', 'active', 'revoked', 'expired')
  ),
  constraint break_glass_validity_check check (
    not isempty(validity)
    and lower(validity) is not null
    and upper(validity) is not null
    and upper(validity) > lower(validity)
    and upper(validity) - lower(validity) <= interval '4 hours'
  ),
  constraint break_glass_activation_pair_check check (
    (activated_at is null) = (activated_by is null)
  ),
  constraint break_glass_activation_time_check check (
    activated_at is null or activated_at >= approved_at
  ),
  constraint break_glass_approved_state_check check (
    status <> 'approved' or activated_at is null
  ),
  constraint break_glass_active_state_check check (
    status <> 'active' or activated_at is not null
  ),
  constraint break_glass_activation_actor_check check (
    activated_by is null or activated_by = user_id
  ),
  constraint break_glass_revoked_check check (
    (status = 'revoked') = (revoked_at is not null)
  ),
  constraint break_glass_expired_check check (
    (status = 'expired') = (expired_at is not null)
  ),
  constraint break_glass_approval_time_check check (
    approved_at <= lower(validity)
  ),
  constraint break_glass_revoke_time_check check (
    revoked_at is null or revoked_at >= lower(validity)
  ),
  constraint break_glass_expire_time_check check (
    expired_at is null or expired_at >= upper(validity)
  )
);

-- A grant is reviewed after its access window closes, including emergency
-- self-activation. The reviewer is neither the subject nor the approver.
create table control.break_glass_review (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references control.break_glass_grant(id) on delete restrict,
  reviewer_id uuid not null references identity.app_user(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  decision text not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint break_glass_review_decision_check check (
    decision in ('upheld', 'overturned', 'escalated')
  ),
  constraint break_glass_review_notes_check check (
    notes is null or length(btrim(notes)) between 1 and 1000
  ),
  constraint break_glass_review_once unique (grant_id, reviewer_id)
);

create index break_glass_review_grant_idx
  on control.break_glass_review (grant_id);
create index break_glass_review_reviewer_idx
  on control.break_glass_review (reviewer_id);

create index break_glass_hospital_user_idx
  on control.break_glass_grant (hospital_id, user_id);
create index break_glass_hospital_organisation_idx
  on control.break_glass_grant (hospital_id, organisation_id);
create index break_glass_user_idx on control.break_glass_grant (user_id);
create index break_glass_organisation_idx
  on control.break_glass_grant (organisation_id);
create index break_glass_approved_by_idx on control.break_glass_grant (approved_by);
create index break_glass_activated_by_idx on control.break_glass_grant (activated_by)
  where activated_by is not null;

alter table control.break_glass_grant
  add constraint break_glass_no_overlap
  exclude using gist (
    hospital_id with =,
    user_id with =,
    validity with &&
  )
  where (status = 'active');

create trigger break_glass_touch_updated_at
before update on control.break_glass_grant
for each row execute function public.touch_updated_at();

create or replace function control.prevent_break_glass_scope_change()
returns trigger
language plpgsql
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.hospital_id is distinct from old.hospital_id
     or new.user_id is distinct from old.user_id
     or new.approved_by is distinct from old.approved_by
     or new.approval_mode is distinct from old.approval_mode
     or new.approved_at is distinct from old.approved_at
     or new.access_level is distinct from old.access_level
     or new.validity is distinct from old.validity
     or new.reason is distinct from old.reason then
    raise exception 'break-glass grant scope is immutable' using errcode = '23514';
  end if;
  if old.activated_at is not null
    and (
      new.activated_at is distinct from old.activated_at
      or new.activated_by is distinct from old.activated_by
    ) then
    raise exception 'break-glass activation is final' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger break_glass_scope_immutable
before update of organisation_id, hospital_id, user_id, approved_by, approval_mode,
  approved_at, access_level, validity, reason, activated_at, activated_by
on control.break_glass_grant
for each row execute function control.prevent_break_glass_scope_change();

create or replace function control.enforce_break_glass_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('revoked', 'expired') and new.status is distinct from old.status then
    raise exception 'break-glass status is final' using errcode = '23514';
  end if;
  if new.status = 'active' and old.status not in ('approved', 'active') then
    raise exception 'only an approved grant can activate' using errcode = '23514';
  end if;
  if new.status = 'active' and now() >= upper(new.validity) then
    raise exception 'an expired grant cannot activate' using errcode = '23514';
  end if;
  if new.status in ('revoked', 'expired') and old.status not in ('approved', 'active') then
    raise exception 'only an open grant can close' using errcode = '23514';
  end if;
  if new.status = 'expired' and now() < upper(new.validity) then
    raise exception 'a grant cannot expire before its access window' using errcode = '23514';
  end if;
  if old.status = 'active' and new.status = 'approved' then
    raise exception 'break-glass grant cannot return to approved' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger break_glass_status_transition
before update on control.break_glass_grant
for each row execute function control.enforce_break_glass_transition();

create or replace function control.enforce_break_glass_review_independence()
returns trigger
language plpgsql
as $$
declare
  subject_id uuid;
  approver_id uuid;
  access_end timestamptz;
begin
  select user_id, approved_by, upper(validity)
    into subject_id, approver_id, access_end
    from control.break_glass_grant
   where id = new.grant_id;

  if new.reviewer_id = subject_id then
    raise exception 'a grant subject cannot review their own access' using errcode = '23514';
  end if;
  if new.reviewer_id = approver_id then
    raise exception 'a grant approver cannot review their own approval' using errcode = '23514';
  end if;
  if new.reviewed_at < access_end then
    raise exception 'break-glass review must follow the access window' using errcode = '23514';
  end if;
  if new.reviewed_at > now() then
    raise exception 'break-glass review cannot be in the future' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger break_glass_review_independence
before insert or update on control.break_glass_review
for each row execute function control.enforce_break_glass_review_independence();

create or replace function control.permission_scope_rank(permission_scope text)
returns smallint
language sql
immutable
strict
as $$
  select case permission_scope
    when 'platform' then 3::smallint
    when 'organisation' then 2::smallint
    when 'hospital' then 1::smallint
  end;
$$;

create or replace function control.enforce_role_permission_scope()
returns trigger
language plpgsql
as $$
declare
  role_scope text;
  permission_scope text;
begin
  select scope into role_scope from control.role where id = new.role_id;
  select scope into permission_scope from control.permission where key = new.permission_key;

  if control.permission_scope_rank(permission_scope) > control.permission_scope_rank(role_scope) then
    raise exception 'permission scope exceeds role scope' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger role_permission_scope
before insert or update on control.role_permission
for each row execute function control.enforce_role_permission_scope();

create or replace function control.enforce_role_template_permission_scope()
returns trigger
language plpgsql
as $$
declare
  template_scope text;
  permission_scope text;
begin
  select template.scope
    into template_scope
    from control.role_template_version as version
    join control.role_template as template on template.id = version.template_id
   where version.id = new.template_version_id;
  select scope into permission_scope from control.permission where key = new.permission_key;

  if control.permission_scope_rank(permission_scope) > control.permission_scope_rank(template_scope) then
    raise exception 'permission scope exceeds role template scope' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger role_template_permission_scope
before insert or update on control.role_template_permission
for each row execute function control.enforce_role_template_permission_scope();

create or replace function control.enforce_platform_assignment()
returns trigger
language plpgsql
as $$
declare
  role_scope text;
begin
  select scope into role_scope from control.role where id = new.role_id;
  if role_scope is distinct from 'platform' then
    raise exception 'platform assignment needs a platform role' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger platform_assignment_scope
before insert or update on control.platform_assignment
for each row execute function control.enforce_platform_assignment();

create or replace function control.enforce_membership_role_scope()
returns trigger
language plpgsql
as $$
declare
  membership_organisation_id uuid;
  membership_hospital_id uuid;
  membership_status text;
  membership_validity tstzrange;
  role_organisation_id uuid;
  role_scope text;
begin
  -- FOR SHARE serialises assignment with a concurrent revocation.
  select organisation_id, hospital_id, status, validity
    into membership_organisation_id, membership_hospital_id, membership_status,
      membership_validity
    from control.membership
   where id = new.membership_id
     for share;

  if membership_status in ('revoked', 'expired') then
    raise exception 'a revoked or expired membership cannot receive roles' using errcode = '23514';
  end if;
  if not (membership_validity @> now()) then
    raise exception 'membership is not valid at assignment time' using errcode = '23514';
  end if;
  if not (new.validity <@ membership_validity) then
    raise exception 'role assignment must lie inside the membership validity' using errcode = '23514';
  end if;

  select organisation_id, scope
    into role_organisation_id, role_scope
    from control.role
   where id = new.role_id;

  if role_scope = 'platform' then
    raise exception 'a platform role cannot be a membership role' using errcode = '23514';
  end if;
  if role_organisation_id is not null
     and role_organisation_id <> membership_organisation_id then
    raise exception 'role belongs to another organisation' using errcode = '23514';
  end if;
  if membership_hospital_id is not null and role_scope <> 'hospital' then
    raise exception 'a hospital membership needs a hospital role' using errcode = '23514';
  end if;
  if membership_hospital_id is null and role_scope <> 'organisation' then
    raise exception 'an organisation membership needs an organisation role' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger membership_role_scope
before insert or update of membership_id, role_id, validity
on control.membership_role
for each row execute function control.enforce_membership_role_scope();

create or replace function control.enforce_invitation_role_scope()
returns trigger
language plpgsql
as $$
declare
  invitation_organisation_id uuid;
  invitation_hospital_id uuid;
  invitation_status text;
  role_organisation_id uuid;
  role_scope text;
begin
  select organisation_id, hospital_id, status
    into invitation_organisation_id, invitation_hospital_id, invitation_status
    from identity.invitation
   where id = new.invitation_id;

  if invitation_status <> 'pending' then
    raise exception 'only a pending invitation can receive roles' using errcode = '23514';
  end if;

  select organisation_id, scope
    into role_organisation_id, role_scope
    from control.role
   where id = new.role_id;

  if role_scope = 'platform' then
    raise exception 'a platform role cannot be an invitation role' using errcode = '23514';
  end if;
  if role_organisation_id is not null
     and role_organisation_id <> invitation_organisation_id then
    raise exception 'role belongs to another organisation' using errcode = '23514';
  end if;
  if invitation_hospital_id is not null and role_scope <> 'hospital' then
    raise exception 'a hospital invitation needs a hospital role' using errcode = '23514';
  end if;
  if invitation_hospital_id is null and role_scope <> 'organisation' then
    raise exception 'an organisation invitation needs an organisation role' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger invitation_role_scope
before insert or update on control.invitation_role
for each row execute function control.enforce_invitation_role_scope();

create or replace function control.prevent_role_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.key is distinct from old.key
     or new.scope is distinct from old.scope
     or new.is_system is distinct from old.is_system
     or new.source_template_version_id is distinct from old.source_template_version_id then
    raise exception 'role identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger role_identity_immutable
before update of organisation_id, key, scope, is_system, source_template_version_id
on control.role
for each row execute function control.prevent_role_identity_change();

create or replace function control.enforce_role_template_source()
returns trigger
language plpgsql
as $$
declare
  template_scope text;
begin
  if new.source_template_version_id is null then
    return new;
  end if;

  select template.scope
    into template_scope
    from control.role_template_version as version
    join control.role_template as template on template.id = version.template_id
   where version.id = new.source_template_version_id;

  if new.is_system then
    raise exception 'a system role cannot copy a template' using errcode = '23514';
  end if;
  if template_scope is distinct from new.scope then
    raise exception 'role scope must match its template version' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger role_template_source
before insert or update on control.role
for each row execute function control.enforce_role_template_source();

create or replace function control.prevent_permission_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.key is distinct from old.key or new.scope is distinct from old.scope then
    raise exception 'permission identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger permission_identity_immutable
before update of key, scope on control.permission
for each row execute function control.prevent_permission_identity_change();

create or replace function control.prevent_membership_scope_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.organisation_id is distinct from old.organisation_id
     or new.hospital_id is distinct from old.hospital_id
     or new.accepted_at is distinct from old.accepted_at
     or lower(new.validity) is distinct from lower(old.validity) then
    raise exception 'membership scope is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger membership_scope_immutable
before update of user_id, organisation_id, hospital_id, accepted_at, validity
on control.membership
for each row execute function control.prevent_membership_scope_change();

create or replace function control.enforce_membership_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('revoked', 'expired') and new.status is distinct from old.status then
    raise exception 'membership status is final' using errcode = '23514';
  end if;
  if new.status = 'revoked' and old.status not in ('active', 'suspended') then
    raise exception 'only an open membership can be revoked' using errcode = '23514';
  end if;
  if new.status = 'expired' and old.status not in ('active', 'suspended') then
    raise exception 'only an open membership can expire' using errcode = '23514';
  end if;
  if new.status = 'active' and old.status not in ('active', 'suspended') then
    raise exception 'only a suspended membership can reactivate' using errcode = '23514';
  end if;
  if old.revoked_at is not null
    and (
      new.revoked_at is distinct from old.revoked_at
      or new.revoked_by is distinct from old.revoked_by
      or new.revoke_reason is distinct from old.revoke_reason
    ) then
    raise exception 'membership revocation is final' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger membership_status_transition
before update on control.membership
for each row execute function control.enforce_membership_transition();

-- Down Migration
drop trigger if exists membership_status_transition on control.membership;
drop function if exists control.enforce_membership_transition();
drop trigger if exists membership_scope_immutable on control.membership;
drop function if exists control.prevent_membership_scope_change();
drop trigger if exists membership_touch_updated_at on control.membership;
drop trigger if exists permission_identity_immutable on control.permission;
drop function if exists control.prevent_permission_identity_change();
drop trigger if exists role_template_source on control.role;
drop function if exists control.enforce_role_template_source();
drop trigger if exists role_identity_immutable on control.role;
drop function if exists control.prevent_role_identity_change();
drop trigger if exists invitation_role_scope on control.invitation_role;
drop function if exists control.enforce_invitation_role_scope();
drop trigger if exists membership_role_scope on control.membership_role;
drop function if exists control.enforce_membership_role_scope();
drop trigger if exists platform_assignment_scope on control.platform_assignment;
drop function if exists control.enforce_platform_assignment();
drop trigger if exists role_template_permission_scope on control.role_template_permission;
drop function if exists control.enforce_role_template_permission_scope();
drop trigger if exists role_template_version_immutable on control.role_template_version;
drop function if exists control.prevent_role_template_version_change();
drop trigger if exists role_permission_scope on control.role_permission;
drop function if exists control.enforce_role_permission_scope();
drop function if exists control.permission_scope_rank(text);
drop trigger if exists break_glass_review_independence on control.break_glass_review;
drop function if exists control.enforce_break_glass_review_independence();
drop trigger if exists break_glass_status_transition on control.break_glass_grant;
drop function if exists control.enforce_break_glass_transition();
drop trigger if exists break_glass_scope_immutable on control.break_glass_grant;
drop function if exists control.prevent_break_glass_scope_change();
drop trigger if exists break_glass_touch_updated_at on control.break_glass_grant;
drop table if exists control.break_glass_review;
drop table if exists control.break_glass_grant;
drop table if exists control.invitation_role;
drop table if exists control.membership_role;
drop table if exists control.membership;
drop table if exists control.platform_assignment;
drop table if exists control.role_permission;
drop table if exists control.role_template_permission;
drop trigger if exists role_touch_updated_at on control.role;
drop table if exists control.role;
drop table if exists control.role_template_version;
drop table if exists control.role_template;
drop table if exists control.permission;
drop trigger if exists invitation_status_transition on identity.invitation;
drop function if exists identity.enforce_invitation_transition();
drop trigger if exists invitation_scope_immutable on identity.invitation;
drop function if exists identity.prevent_invitation_scope_change();
drop trigger if exists invitation_touch_updated_at on identity.invitation;
drop table if exists identity.invitation;
