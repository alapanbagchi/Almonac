-- Up Migration
set local lock_timeout = '5s';

-- A new-user invitation also needs the Zitadel subject after the initial user
-- is created, so a resend can target the same identity. Only an existing-user
-- invitation must have a subject; a new-user invitation may have one.
alter table identity.invitation
  drop constraint invitation_subject_check;

alter table identity.invitation
  add constraint invitation_subject_check check (
    kind <> 'existing_user' or zitadel_sub is not null
  );

update control.schema_metadata set version = 4, migrated_at = now() where id = 1;

-- Down Migration
-- A pending new-user invitation may point at a Zitadel subject. Drop that
-- pointer before restoring the stricter invariant.
update identity.invitation
   set zitadel_sub = null
 where kind = 'new_user' and status = 'pending';

alter table identity.invitation
  drop constraint invitation_subject_check;

alter table identity.invitation
  add constraint invitation_subject_check check (
    (kind = 'existing_user') = (zitadel_sub is not null)
  );

update control.schema_metadata set version = 3, migrated_at = now() where id = 1;
