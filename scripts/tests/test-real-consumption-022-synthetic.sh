#!/bin/sh
# Fresh synthetic PG16 cluster only. No project database, network listener or existing cluster.
# Retains the scratch directory as evidence and stops only the process started here.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
PG_BIN=${PG16_BIN:-$(pg_config --bindir)}
case "$("$PG_BIN/postgres" --version)" in 'postgres (PostgreSQL) 16.'*) ;; *) echo 'PG16 required' >&2; exit 1;; esac
scratch=$(mktemp -d /tmp/cc022.XXXXXXXX)
echo "Synthetic-only cluster: $scratch"
mkdir "$scratch/socket"
export LC_ALL=C LANG=C
env -i PATH="$PATH" LC_ALL=C LANG=C "$PG_BIN/initdb" -D "$scratch/data" --auth=trust --no-locale --encoding=UTF8 >"$scratch/init.log" 2>&1
env -i PATH="$PATH" LC_ALL=C LANG=C "$PG_BIN/pg_ctl" -D "$scratch/data" -l "$scratch/postgres.log" -o "-k $scratch/socket -h '' -p 55422" -w start
trap 'env -i PATH="$PATH" LC_ALL=C LANG=C "$PG_BIN/pg_ctl" -D "$scratch/data" -m fast -w stop >/dev/null' EXIT
psql022() { env -i PATH="$PATH" LC_ALL=C LANG=C "$PG_BIN/psql" -X -h "$scratch/socket" -p 55422 -U "$(id -un)" -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql022 <<'SQL'
CREATE TABLE public.real_consumption_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL,
  original_ingredient text NOT NULL,
  normalized_original_ingredient text NOT NULL,
  CONSTRAINT real_consumption_items_original_key UNIQUE(operation_id,normalized_original_ingredient)
);
INSERT INTO public.real_consumption_items(operation_id,original_ingredient,normalized_original_ingredient)
VALUES ('00000000-0000-4000-8000-000000000001','Sal','sal');
SQL
if psql022 -1 -f "$ROOT/frontend/scripts/activated-capabilities-022-occurrences.sql" >"$scratch/pre-migration.log" 2>&1; then
  echo '022 attestation unexpectedly accepted pre-migration schema' >&2
  exit 1
fi
grep -q CONSUMPTION_022_COLUMN_MISMATCH "$scratch/pre-migration.log"
psql022 -1 -f "$ROOT/db/migrations/022_real_consumption_occurrences.sql"
psql022 -1 -f "$ROOT/frontend/scripts/activated-capabilities-022-occurrences.sql"
psql022 <<'SQL'
DO $test$
DECLARE op uuid := '00000000-0000-4000-8000-000000000002';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.real_consumption_items WHERE original_ingredient='Sal' AND ingredient_index IS NULL) THEN RAISE EXCEPTION 'historical record altered'; END IF;
  INSERT INTO public.real_consumption_items(operation_id,original_ingredient,normalized_original_ingredient,ingredient_index)
  VALUES (op,'Sal','sal',0),(op,'SAL','sal',1);
  BEGIN
    INSERT INTO public.real_consumption_items(operation_id,original_ingredient,normalized_original_ingredient,ingredient_index) VALUES (op,'Azucar','azucar',1);
    RAISE EXCEPTION 'duplicate position accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.real_consumption_items(operation_id,original_ingredient,normalized_original_ingredient,ingredient_index) VALUES (op,'Sal','sal',100);
    RAISE EXCEPTION 'out of range accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.real_consumption_items(operation_id,original_ingredient,normalized_original_ingredient) VALUES ('00000000-0000-4000-8000-000000000001','SAL','sal');
    RAISE EXCEPTION 'legacy name uniqueness lost';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF (SELECT count(*) FROM public.real_consumption_items WHERE operation_id=op)<>2 THEN RAISE EXCEPTION 'unexpected row count'; END IF;
END
$test$;
SELECT id, original_ingredient, ingredient_index FROM public.real_consumption_items ORDER BY id;
SQL
echo 'SYNTHETIC PG16 migration+catalog+legacy+duplicate constraints PASS'
