-- Up Migration
set local lock_timeout = '5s';

-- A role is an organisation-local instance of a versioned template. The
-- runtime cannot write the role catalogue directly, so this one controlled
-- function creates a role from the newest published template version and
-- copies that version's permissions. It cannot invent a permission.
create or replace function control.instantiate_role_template(
  target_organisation_id uuid,
  template_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scope text;
  v_template_id uuid;
  v_version_id uuid;
  v_version_name text;
  v_role_id uuid;
begin
  select template.scope, template.id
    into v_scope, v_template_id
    from control.role_template as template
   where template.key = template_key;

  if not found then
    raise exception 'unknown role template' using errcode = '23503';
  end if;

  select version.id, version.name
    into v_version_id, v_version_name
    from control.role_template_version as version
   where version.template_id = v_template_id
   order by version.version desc
   limit 1;

  if not found then
    raise exception 'role template has no version' using errcode = '23503';
  end if;

  -- Serialize role creation for one organisation. The lock also proves that
  -- the organisation exists before a role refers to it.
  perform 1
    from control.organisation as organisation
   where organisation.id = target_organisation_id
     for share;

  if not found then
    raise exception 'organisation does not exist' using errcode = '23503';
  end if;

  insert into control.role
    (organisation_id, key, name, scope, is_system, source_template_version_id)
  values
    (target_organisation_id, template_key, v_version_name, v_scope,
     false, v_version_id)
  on conflict (organisation_id, key) where organisation_id is not null
  do nothing
  returning id into v_role_id;

  if v_role_id is not null then
    insert into control.role_permission (role_id, permission_key)
    select v_role_id, template_permission.permission_key
      from control.role_template_permission as template_permission
     where template_permission.template_version_id = v_version_id;
    return v_role_id;
  end if;

  select role.id
    into v_role_id
    from control.role as role
   where role.organisation_id = target_organisation_id
     and role.key = template_key;

  if not found then
    raise exception 'role could not be created' using errcode = '23514';
  end if;

  return v_role_id;
end;
$$;

revoke all on function control.instantiate_role_template(uuid, text) from public;
grant execute on function control.instantiate_role_template(uuid, text) to almonac_app;

update control.schema_metadata
   set version = 3, migrated_at = now()
 where id = 1;

-- Down Migration
drop function if exists control.instantiate_role_template(uuid, text);

update control.schema_metadata
   set version = 2, migrated_at = now()
 where id = 1;
