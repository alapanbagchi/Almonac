-- Up Migration
set local lock_timeout = '5s';

-- A fixed-window counter per hashed subject. The key is a SHA-256 digest of
-- the route and the client address, so the table never stores an IP address.
create table identity.rate_limit (
  key_hash bytea primary key,
  window_start timestamptz not null,
  count integer not null,
  constraint rate_limit_key_check check (octet_length(key_hash) = 32),
  constraint rate_limit_count_check check (count > 0)
);

-- Expired windows are pruned by an operations job; this index makes that
-- sweep cheap and keeps the primary-key lookup unaffected.
create index rate_limit_window_idx on identity.rate_limit (window_start);

grant select, insert, update on identity.rate_limit to almonac_app;

update control.schema_metadata
   set version = 7, migrated_at = now()
 where id = 1;

-- Down Migration
set local lock_timeout = '5s';

drop table if exists identity.rate_limit;

update control.schema_metadata
   set version = 6, migrated_at = now()
 where id = 1;
