-- Up Migration
-- A step-up is a distinct security event. It records the refreshed session and
-- the authentication methods that satisfied the elevation.

insert into audit.event_type (key, description, requires_reason, metadata_keys)
values (
  'auth.step_up',
  'A user completed a step-up authentication.',
  false,
  array['session_id', 'amr']
)
on conflict (key) do update set
  description = excluded.description,
  requires_reason = excluded.requires_reason,
  metadata_keys = excluded.metadata_keys;

update control.schema_metadata set version = 5, migrated_at = now() where id = 1;

-- Down Migration
delete from audit.event_type as event_type
 where event_type.key = 'auth.step_up'
   and not exists (
     select 1 from audit.event as event where event.event_type = event_type.key
   );

update control.schema_metadata set version = 4, migrated_at = now() where id = 1;
