-- Up Migration
set local lock_timeout = '5s';

-- Clinical permissions are meaningful only for a hospital-bound membership.
-- An organisation-wide role may still hold hospital management permissions,
-- but it must never read or write patient records across every hospital.
alter table control.permission
  add column is_clinical boolean not null default false,
  add constraint permission_clinical_scope_check check (
    not is_clinical or scope = 'hospital'
  );

update control.permission
   set is_clinical = true
 where key in ('clinical.read', 'clinical.write');

do $$
begin
  if exists (
    select 1
      from control.role_permission as role_permission
      join control.role as role on role.id = role_permission.role_id
      join control.permission as permission on permission.key = role_permission.permission_key
     where permission.is_clinical and role.scope <> 'hospital'
  ) then
    raise exception 'existing role grants a clinical permission outside a hospital role';
  end if;

  if exists (
    select 1
      from control.role_template_permission as template_permission
      join control.role_template_version as version
        on version.id = template_permission.template_version_id
      join control.role_template as template on template.id = version.template_id
      join control.permission as permission
        on permission.key = template_permission.permission_key
     where permission.is_clinical and template.scope <> 'hospital'
  ) then
    raise exception 'existing role template grants a clinical permission outside a hospital template';
  end if;
end;
$$;

create function control.enforce_role_permission_clinical_scope()
returns trigger
language plpgsql
as $$
declare
  role_scope text;
  permission_is_clinical boolean;
begin
  select scope into role_scope from control.role where id = new.role_id;
  select is_clinical into permission_is_clinical
    from control.permission where key = new.permission_key;

  if permission_is_clinical and role_scope <> 'hospital' then
    raise exception 'a clinical permission needs a hospital role' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger role_permission_clinical_scope
before insert or update on control.role_permission
for each row execute function control.enforce_role_permission_clinical_scope();

create function control.enforce_role_template_clinical_scope()
returns trigger
language plpgsql
as $$
declare
  template_scope text;
  permission_is_clinical boolean;
begin
  select template.scope
    into template_scope
    from control.role_template_version as version
    join control.role_template as template on template.id = version.template_id
   where version.id = new.template_version_id;
  select is_clinical into permission_is_clinical
    from control.permission where key = new.permission_key;

  if permission_is_clinical and template_scope <> 'hospital' then
    raise exception 'a clinical permission needs a hospital template' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger role_template_permission_clinical_scope
before insert or update on control.role_template_permission
for each row execute function control.enforce_role_template_clinical_scope();

update control.schema_metadata
   set version = 9, migrated_at = now()
 where id = 1;

-- Down Migration
set local lock_timeout = '5s';

drop trigger if exists role_template_permission_clinical_scope
  on control.role_template_permission;
drop function if exists control.enforce_role_template_clinical_scope();
drop trigger if exists role_permission_clinical_scope on control.role_permission;
drop function if exists control.enforce_role_permission_clinical_scope();

alter table control.permission
  drop constraint if exists permission_clinical_scope_check,
  drop column if exists is_clinical;

update control.schema_metadata
   set version = 8, migrated_at = now()
 where id = 1;
