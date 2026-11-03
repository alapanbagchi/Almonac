#!/bin/sh
set -eu

# The local control Postgres creates the integration-test database on first
# start. Existing volumes do not run this script again; recreate the volume or
# create the database manually after changing the name.
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE \"$CONTROL_POSTGRES_TEST_DB\";"
