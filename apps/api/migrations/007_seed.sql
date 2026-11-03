-- Up Migration
set local lock_timeout = '5s';

insert into control.permission (key, scope, description)
values
  ('platform.manage', 'platform', 'Manage the platform and its operators.'),
  ('organisation.manage', 'organisation', 'Manage organisation settings and hospitals.'),
  ('hospital.manage', 'hospital', 'Manage a hospital and its configuration.'),
  ('membership.manage', 'hospital', 'Invite, suspend and revoke hospital memberships.'),
  ('clinical.read', 'hospital', 'Read clinical records in a hospital.'),
  ('clinical.write', 'hospital', 'Write clinical records in a hospital.'),
  ('audit.read', 'hospital', 'Read audit events for a hospital or organisation.'),
  ('break_glass.request', 'hospital', 'Request time-limited emergency access.'),
  ('break_glass.approve', 'platform', 'Approve a break-glass request.')
on conflict (key) do update set description = excluded.description;

insert into control.role (organisation_id, key, name, scope, is_system)
values
  (null, 'platform_admin', 'Platform administrator', 'platform', true),
  (null, 'break_glass_approver', 'Break-glass approver', 'platform', true)
on conflict (key) where organisation_id is null
do update set name = excluded.name;

insert into control.role_permission (role_id, permission_key)
select role.id, permission.key
from control.role
join control.permission on permission.key = 'platform.manage'
where role.organisation_id is null and role.key = 'platform_admin'
on conflict do nothing;

insert into control.role_permission (role_id, permission_key)
select role.id, permission.key
from control.role
join control.permission on permission.key = 'break_glass.approve'
where role.organisation_id is null and role.key = 'break_glass_approver'
on conflict do nothing;

insert into control.role_template (key, scope)
values
  ('org_admin', 'organisation'),
  ('hospital_admin', 'hospital'),
  ('clinician', 'hospital'),
  ('auditor', 'organisation')
on conflict (key) do update set scope = excluded.scope;

insert into control.role_template_version (template_id, version, name)
select template.id, 1, version.name
from control.role_template as template
join (
  values
    ('org_admin', 'Organisation administrator'),
    ('hospital_admin', 'Hospital administrator'),
    ('clinician', 'Clinician'),
    ('auditor', 'Auditor')
) as version(key, name) on version.key = template.key
on conflict (template_id, version) do nothing;

insert into control.role_template_permission (template_version_id, permission_key)
select version.id, permission.key
from control.role_template_version as version
join control.role_template as template on template.id = version.template_id
join control.permission on permission.key in (
  'organisation.manage',
  'hospital.manage',
  'membership.manage',
  'audit.read'
)
where template.key = 'org_admin' and version.version = 1
on conflict do nothing;

insert into control.role_template_permission (template_version_id, permission_key)
select version.id, permission.key
from control.role_template_version as version
join control.role_template as template on template.id = version.template_id
join control.permission on permission.key in (
  'hospital.manage',
  'membership.manage',
  'clinical.read',
  'clinical.write',
  'audit.read',
  'break_glass.request'
)
where template.key = 'hospital_admin' and version.version = 1
on conflict do nothing;

insert into control.role_template_permission (template_version_id, permission_key)
select version.id, permission.key
from control.role_template_version as version
join control.role_template as template on template.id = version.template_id
join control.permission on permission.key in ('clinical.read', 'clinical.write')
where template.key = 'clinician' and version.version = 1
on conflict do nothing;

insert into control.role_template_permission (template_version_id, permission_key)
select version.id, permission.key
from control.role_template_version as version
join control.role_template as template on template.id = version.template_id
join control.permission on permission.key = 'audit.read'
where template.key = 'auditor' and version.version = 1
on conflict do nothing;

insert into audit.event_type (key, description, requires_reason, metadata_keys)
values
  ('auth.login', 'A user completed a login.', false,
    array['session_id', 'access_context']),
  ('auth.login_failed', 'A login attempt failed.', false,
    array['reason_code']),
  ('auth.logout', 'A user ended a session.', false,
    array['session_id']),
  ('session.revoke', 'A session was revoked before expiry.', true,
    array['session_id', 'reason_code']),
  ('invitation.accept', 'An invitation was accepted.', false,
    array['invitation_id']),
  ('membership.change', 'A membership changed state.', true,
    array['membership_id', 'from_status', 'to_status']),
  ('role.assign', 'A role assignment changed.', true,
    array['membership_id', 'role_id']),
  ('break_glass.activate', 'Break-glass access was activated.', true,
    array['grant_id']),
  ('break_glass.review', 'Break-glass access was reviewed.', true,
    array['grant_id']),
  ('admin.change', 'An administrative record changed.', true,
    array['resource_type', 'resource_id'])
on conflict (key) do update set
  description = excluded.description,
  requires_reason = excluded.requires_reason,
  metadata_keys = excluded.metadata_keys;

insert into control.schema_metadata (id, version, migrated_at)
values (1, 2, now())
on conflict (id) do update set version = excluded.version, migrated_at = excluded.migrated_at;

-- Down Migration
-- Remove only rows this migration created. A custom role that still references a
-- seeded permission blocks the down migration; do not delete custom data.
delete from control.role_permission
where role_id in (
  select id from control.role
  where organisation_id is null
    and key in ('platform_admin', 'break_glass_approver')
);
delete from control.role_template_permission
where template_version_id in (
  select version.id
  from control.role_template_version as version
  join control.role_template as template on template.id = version.template_id
  where template.key in ('org_admin', 'hospital_admin', 'clinician', 'auditor')
);
delete from control.role_template_version
where template_id in (
  select id from control.role_template
  where key in ('org_admin', 'hospital_admin', 'clinician', 'auditor')
);
delete from control.role_template
where key in ('org_admin', 'hospital_admin', 'clinician', 'auditor');
delete from audit.event_type
where key in (
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'session.revoke',
  'invitation.accept',
  'membership.change',
  'role.assign',
  'break_glass.activate',
  'break_glass.review',
  'admin.change'
);
delete from control.role
where organisation_id is null
  and key in ('platform_admin', 'break_glass_approver');
delete from control.permission
where key in (
  'platform.manage',
  'organisation.manage',
  'hospital.manage',
  'membership.manage',
  'clinical.read',
  'clinical.write',
  'audit.read',
  'break_glass.request',
  'break_glass.approve'
);
delete from control.schema_metadata where id = 1;
