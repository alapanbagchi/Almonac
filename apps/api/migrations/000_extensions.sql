-- Up Migration
set local lock_timeout = '5s';

create extension if not exists citext;
create extension if not exists btree_gist;

-- Down Migration
-- Extensions are database-wide and may be used by later migrations. Keep them.
select 1;
