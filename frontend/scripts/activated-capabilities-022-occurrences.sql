-- Additional read-only contract for migration 022. The complete 021
-- capability attestation must still pass before and after this transition.
DO $occurrence_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.real_consumption_items'::pg_catalog.regclass
      AND a.attname='ingredient_index' AND a.attnum>0 AND NOT a.attisdropped
      AND a.atttypid='pg_catalog.int4'::pg_catalog.regtype
      AND NOT a.attnotnull AND NOT a.atthasdef AND a.attgenerated='' AND a.attidentity=''
  ) THEN RAISE EXCEPTION 'CONSUMPTION_022_COLUMN_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.real_consumption_items'::pg_catalog.regclass
      AND c.conname='real_consumption_items_ingredient_index_check'
      AND c.contype='c' AND c.convalidated AND NOT c.connoinherit
      AND pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'[()[:space:]]','','g')
          ='CHECKingredient_index>=0ANDingredient_index<100'
  ) THEN RAISE EXCEPTION 'CONSUMPTION_022_CHECK_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
    WHERE c.conrelid='public.real_consumption_items'::pg_catalog.regclass
      AND c.conname='real_consumption_items_original_key' AND c.contype='u'
      AND c.convalidated AND NOT c.condeferrable AND i.indisvalid AND i.indisready
      AND i.indnullsnotdistinct
      AND pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE NULLS NOT DISTINCT (operation_id, normalized_original_ingredient, ingredient_index)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
    WHERE c.conrelid='public.real_consumption_items'::pg_catalog.regclass
      AND c.conname='real_consumption_items_occurrence_key' AND c.contype='u'
      AND c.convalidated AND NOT c.condeferrable AND i.indisvalid AND i.indisready
      AND NOT i.indnullsnotdistinct
      AND pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE (operation_id, ingredient_index)'
  ) THEN RAISE EXCEPTION 'CONSUMPTION_022_UNIQUE_MISMATCH'; END IF;
END
$occurrence_contract$;
