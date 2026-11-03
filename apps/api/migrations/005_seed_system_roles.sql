-- Up Migration
insert into control.permission (key, scope, description)
values
  ('platform.manage', 'platform', 'Manage the platform and its tenants.'),
  ('organisation.manage', 'organisation', 'Manage an organisation and its hospitals.'),
  ('hospital.manage', 'hospital', 'Manage a hospital and its staff.'),
  ('membership.manage', 'hospital', 'Invite, change and revoke memberships.'),
  ('clinical.read', 'hospital', 'Read clinical data in an authorised hospital.'),
  ('clinical.write', 'hospital', 'Write clinical data in an authorised hospital.'),
  ('audit.read', 'hospital', 'Read audit events for an authorised scope.'),
  ('break_glass.request', 'hospital', 'Request temporary emergency access.'),
  ('break_glass.approve', 'hospital', 'Approve temporary emergency access.')
on conflict (key) do update set
  scope = excluded.scope,
  description = excluded.description;

insert into control.role (organisation_id, key, name, scope)
values
  (null, 'platform_admin', 'Platform administrator', 'platform'),
  (null, 'org_admin', 'Organisation administrator', 'organisation'),
  (null, 'hospital_admin', 'Hospital administrator', 'hospital'),
  (null, 'clinician', 'Clinician', 'hospital'),
  (null, 'auditor', 'Auditor', 'organisation')
on conflict (key) where organisation_id is null do update set
  name = excluded.name,
  scope = excluded.scope;

insert into control.role_permission (role_id, permission_key)
select role.id, grant_row.permission_key
from (
  values
    ('platform_admin', 'platform.manage'),
    ('platform_admin', 'organisation.manage'),
    ('platform_admin', 'hospital.manage'),
    ('platform_admin', 'membership.manage'),
    ('platform_admin', 'audit.read'),
    ('platform_admin', 'break_glass.request'),
    ('org_admin', 'organisation.manage'),
    ('org_admin', 'hospital.manage'),
    ('org_admin', 'membership.manage'),
    ('org_admin', 'audit.read'),
    ('hospital_admin', 'hospital.manage'),
    ('hospital_admin', 'membership.manage'),
    ('hospital_admin', 'audit.read'),
    ('clinician', 'clinical.read'),
    ('clinician', 'clinical.write'),
    ('auditor', 'audit.read')
) as grant_row (role_key, permission_key)
join control.role as role
  on role.organisation_id is null
  and role.key = grant_row.role_key
on conflict do nothing;

-- Down Migration
delete from control.role_permission
where role_id in (
  select id from control.role
  where organisation_id is null
    and key in ('platform_admin', 'org_admin', 'hospital_admin', 'clinician', 'auditor')
);

delete from control.role
where organisation_id is null
  and key in ('platform_admin', 'org_admin', 'hospital_admin', 'clinician', 'auditor');

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
