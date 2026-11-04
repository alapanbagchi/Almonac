-- Up Migration
set local lock_timeout = '5s';

-- A pre-approved grant reserves the same hospital/user window before the
-- subject activates it. Without this, two overlapping approvals could be
-- created and only collide once both became active.
alter table control.break_glass_grant
  drop constraint break_glass_no_overlap;

alter table control.break_glass_grant
  add constraint break_glass_no_overlap
  exclude using gist (
    hospital_id with =,
    user_id with =,
    validity with &&
  )
  where (status in ('approved', 'active'));

update control.schema_metadata
   set version = 6, migrated_at = now()
 where id = 1;

-- Down Migration
set local lock_timeout = '5s';

alter table control.break_glass_grant
  drop constraint break_glass_no_overlap;

alter table control.break_glass_grant
  add constraint break_glass_no_overlap
  exclude using gist (
    hospital_id with =,
    user_id with =,
    validity with &&
  )
  where (status = 'active');

update control.schema_metadata
   set version = 5, migrated_at = now()
 where id = 1;
