-- Up Migration
set local lock_timeout = '5s';

-- The API never connects as the migration owner. This NOLOGIN role is the
-- least-privilege identity that every runtime connection assumes.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'almonac_app') then
    execute 'create role almonac_app nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls';
  end if;
end
$$;

alter role almonac_app
  nologin
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls;

comment on role almonac_app is
  'Runtime role for the Almonac control database. Never owns tables.';

-- Down Migration
-- Roles are cluster-wide and may be granted to deployment-specific logins.
-- A migration must not drop them.
select 1;
