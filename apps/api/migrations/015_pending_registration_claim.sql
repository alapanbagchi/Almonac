-- Up Migration
set local lock_timeout = '5s';

-- Verification now reserves the pending row before calling the identity
-- provider, so the database transaction stays short and the HTTP call never
-- holds a row lock. A stale claim can be taken over after the lease expires by
-- the verification service; a consumed row remains final.
alter table identity.pending_registration
  add column claimed_at timestamptz,
  add column claim_id uuid,
  add constraint pending_registration_claim_check check (
    (claimed_at is null) = (claim_id is null)
  ),
  add constraint pending_registration_claimed_check check (
    claimed_at is null
    or (claimed_at >= created_at and claimed_at <= expires_at)
  );

drop index identity.pending_registration_email_open_idx;
create unique index pending_registration_email_open_idx
  on identity.pending_registration (email)
  where consumed_at is null and claimed_at is null;

update control.schema_metadata
   set version = 10, migrated_at = now()
 where id = 1;

-- Down Migration
set local lock_timeout = '5s';

drop index if exists identity.pending_registration_email_open_idx;
create unique index pending_registration_email_open_idx
  on identity.pending_registration (email)
  where consumed_at is null;

alter table identity.pending_registration
  drop constraint if exists pending_registration_claimed_check,
  drop constraint if exists pending_registration_claim_check,
  drop column if exists claimed_at,
  drop column if exists claim_id;

update control.schema_metadata
   set version = 9, migrated_at = now()
 where id = 1;
