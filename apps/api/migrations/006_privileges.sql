-- Up Migration
set local lock_timeout = '5s';

revoke all on schema identity, control, audit from public;
grant usage on schema identity, control, audit to almonac_app;

grant select, insert, update, delete on all tables in schema identity to almonac_app;
grant select, insert, update, delete on all tables in schema control to almonac_app;
grant select, insert on all tables in schema audit to almonac_app;

-- The schema version and the role catalogue are written by migrations and
-- operators, never by the application. A runtime write here could grant any
-- permission to any role.
revoke insert, update, delete on control.schema_metadata, control.permission,
  control.role, control.role_permission, control.role_template,
  control.role_template_version, control.role_template_permission,
  control.platform_assignment from almonac_app;

-- The event catalogue is configuration. The runtime may read it and append
-- events, but it cannot invent an event type or widen a metadata allowlist.
revoke insert, update, delete on audit.event_type from almonac_app;

-- Hard deletion of an identity, tenancy or emergency record is an operator
-- action. Status and revocation fields change access without losing history.
revoke delete on identity.app_user, identity.invitation,
  control.organisation, control.hospital, control.hospital_domain,
  control.membership, control.membership_role, control.invitation_role,
  control.break_glass_grant, control.break_glass_review from almonac_app;

-- A review is recorded once and is immutable. The runtime inserts but never
-- edits or removes it.
revoke update, delete on control.break_glass_review from almonac_app;

grant usage, select on all sequences in schema identity, control, audit to almonac_app;

revoke all on all functions in schema identity from public;
revoke all on all functions in schema control from public;
revoke all on all functions in schema audit from public;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default. A
-- per-schema REVOKE cannot remove a global default, so this statement is
-- global. A later migration must grant the runtime role explicitly.
alter default privileges revoke execute on functions from public;

-- Trigger functions and the helpers they call run with the invoker's
-- privileges, so the runtime needs EXECUTE on them. No function here is
-- SECURITY DEFINER; none grants a privilege the caller did not already have.
grant execute on all functions in schema identity, control, audit to almonac_app;
grant execute on function public.touch_updated_at() to almonac_app;

-- Partition creation is an operational task, not an application privilege.
revoke execute on function audit.ensure_month_partition(date) from almonac_app;

-- No default table or sequence privileges are granted. Each migration must
-- grant exactly what the runtime needs, so a new table is not writable by
-- accident.

-- Down Migration
revoke all on schema identity, control, audit from almonac_app;
revoke all on all tables in schema identity from almonac_app;
revoke all on all tables in schema control from almonac_app;
revoke all on all tables in schema audit from almonac_app;
revoke all on all sequences in schema identity, control, audit from almonac_app;
revoke execute on all functions in schema identity, control, audit from almonac_app;
revoke execute on function public.touch_updated_at() from almonac_app;
alter default privileges grant execute on functions to public;
