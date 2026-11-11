#!/bin/sh
set -eu

: "${POSTGRES_DB:=yaya_low_code}"
: "${POSTGRES_USER:=yaya}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${VALKEY_PASSWORD:?VALKEY_PASSWORD is required}"

export POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD VALKEY_PASSWORD

postgres_data=/var/lib/postgresql/data
mkdir -p "$postgres_data" /var/run/postgresql /var/lib/yaya/config /var/lib/yaya/skills /var/lib/yaya/uploads
chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql
chown -R yaya:yaya /var/lib/yaya

if [ ! -f "$postgres_data/PG_VERSION" ]; then
  runuser -u postgres -- initdb -D "$postgres_data" --auth-local=trust --auth-host=scram-sha-256
fi

runuser -u postgres -- pg_ctl -D "$postgres_data" -o "-c listen_addresses=127.0.0.1 -p 5432" -w start
runuser -u postgres -- psql --dbname=postgres --set=app_user="$POSTGRES_USER" --set=app_password="$POSTGRES_PASSWORD" --set=app_db="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db')
\gexec
SQL

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
