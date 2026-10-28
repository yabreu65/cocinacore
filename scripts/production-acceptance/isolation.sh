#!/usr/bin/env bash
set -euo pipefail

commitment=${IDENTITY_COMMITMENT:-}
nonce=${IDENTITY_NONCE:-}
[[ "$commitment" =~ ^[a-f0-9]{64}$ && "$nonce" =~ ^[a-f0-9]{64}$ ]] || { echo ISOLATION_IDENTITY_NO_GO; exit 1; }

[[ "$(docker inspect -f '{{.State.Running}}' cocinacore-web 2>/dev/null)" == true ]] || { echo ISOLATION_APP_HEALTH_NO_GO; exit 1; }
[[ "$(docker inspect -f '{{.State.Health.Status}}' pawtech-postgres 2>/dev/null)" == healthy ]] || { echo ISOLATION_DB_HEALTH_NO_GO; exit 1; }
[[ "$(docker inspect -f '{{.State.Health.Status}}' pawtech-redis 2>/dev/null)" == healthy ]] || { echo ISOLATION_REDIS_HEALTH_NO_GO; exit 1; }

role_line=$(docker exec pawtech-postgres psql -X -A -t -v ON_ERROR_STOP=1 -U cocinacore_user -d cocinacore_db \
  -c "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname=current_user") || { echo ISOLATION_QUERY_NO_GO; exit 1; }
[[ "$role_line" == "f|f|f|f" ]] || { echo ISOLATION_DB_ROLE_NO_GO; exit 1; }

rows=$(docker exec pawtech-postgres psql -X -A -t -v ON_ERROR_STOP=1 -U cocinacore_user -d cocinacore_db -c "
select u.id::text, u.tenant_id::text,
       (select count(*) from public.users ux where ux.tenant_id=u.tenant_id)::text,
       (select count(*) from public.tenant_memberships mx where mx.tenant_id=u.tenant_id)::text,
       (select count(*) from public.tenant_invitations i where i.tenant_id=u.tenant_id and i.status='pending' and i.expires_at > now())::text
from public.users u
join public.tenant_memberships m on m.user_id=u.id and m.tenant_id=u.tenant_id
group by u.id, u.tenant_id
order by u.id") || { echo ISOLATION_QUERY_NO_GO; exit 1; }

match=0
while IFS='|' read -r user_id tenant_id user_count membership_count pending; do
  [[ -n "$user_id" ]] || continue
  digest=$(printf '%s' "$user_id|$tenant_id|$nonce" | sha256sum | awk '{print $1}')
  [[ "$digest" == "$commitment" ]] || continue
  match=$((match + 1))
  [[ "$user_count" == 1 && "$membership_count" == 1 && "$pending" == 0 ]] || { echo ISOLATION_NO_GO; exit 1; }
done <<< "$rows"

[[ "$match" == 1 ]] || { echo ISOLATION_IDENTITY_NO_GO; exit 1; }
echo ISOLATION_PASS
