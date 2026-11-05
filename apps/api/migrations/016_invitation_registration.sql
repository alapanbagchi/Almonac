-- Up Migration
-- Claiming an invitation creates the provider account and is worth recording
-- separately from the later acceptance, which grants the membership.

insert into audit.event_type (key, description, requires_reason, metadata_keys)
values (
  'auth.invitation_registered',
  'An invited user created their account.',
  false,
  array['invitation_id']
)
on conflict (key) do update set
  description = excluded.description,
  requires_reason = excluded.requires_reason,
  metadata_keys = excluded.metadata_keys;

update control.schema_metadata
   set version = 11, migrated_at = now()
 where id = 1;

-- Down Migration
delete from audit.event_type as event_type
 where event_type.key = 'auth.invitation_registered'
   and not exists (
     select 1 from audit.event as event where event.event_type = event_type.key
   );

update control.schema_metadata
   set version = 10, migrated_at = now()
 where id = 1;
