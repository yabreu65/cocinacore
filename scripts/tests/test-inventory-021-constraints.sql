-- Run only in an explicitly disposable database after migration 021.
-- No application data is written. All probe rows are session-local and rolled back.
BEGIN;
DO $boundary$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE filename='021_inventory_price_reference.sql' AND checksum='90f3f0c401f8383c1d073d6717fce46b1bf8cc4347216097c3c5ab653f904a19') THEN
    RAISE EXCEPTION 'Expected exact migration 021 ledger';
  END IF;
END
$boundary$;
CREATE TEMP TABLE price_probe (estimated_unit_price numeric(12,4), price_currency text, price_reference_quantity numeric(12,4), price_reference_unit text);
CREATE TEMP TABLE currency_probe (currency_code text);
DO $probe$
DECLARE expr text; invalid record; rejected boolean; n integer:=0;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT expr FROM pg_constraint WHERE conrelid='public.recipe_inventory_items'::regclass AND conname='recipe_inventory_price_reference_check';
  EXECUTE 'ALTER TABLE price_probe ADD CONSTRAINT price_probe_check '||expr;
  SELECT pg_get_constraintdef(oid) INTO STRICT expr FROM pg_constraint WHERE conrelid='public.tenants'::regclass AND conname='tenants_currency_code_check';
  EXECUTE 'ALTER TABLE currency_probe ADD CONSTRAINT currency_probe_check '||expr;
  INSERT INTO price_probe VALUES (NULL,NULL,NULL,NULL),(500,NULL,NULL,NULL),(-1,NULL,NULL,NULL),(4000,'COP',1,'kg'),(0,'USD',500,'g');
  INSERT INTO currency_probe VALUES (NULL),('COP'),('USD');
  FOR invalid IN SELECT * FROM (VALUES (4000::numeric,'COP',NULL::numeric,'kg'),(4000,NULL,1,'kg'),(4000,'COP',1,NULL),(NULL,'COP',1,'kg'),(-1,'COP',1,'kg'),(4000,'XYZ',1,'kg'),(4000,'COP',0,'kg'),(4000,'COP',-1,'kg'),(4000,'COP',1,'unknown'),('NaN'::numeric,'COP',1,'kg'),(4000,'COP','NaN'::numeric,'kg')) AS v(amount,currency,quantity,unit) LOOP
    rejected:=false;
    BEGIN INSERT INTO price_probe VALUES (invalid.amount,invalid.currency,invalid.quantity,invalid.unit);
    EXCEPTION WHEN check_violation THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Invalid price tuple accepted'; END IF;
    n:=n+1;
  END LOOP;
  FOR invalid IN SELECT * FROM (VALUES ('XYZ'),('cop'),('')) AS v(currency) LOOP
    rejected:=false;
    BEGIN INSERT INTO currency_probe VALUES (invalid.currency);
    EXCEPTION WHEN check_violation THEN rejected:=true; END;
    IF NOT rejected THEN RAISE EXCEPTION 'Invalid currency accepted'; END IF;
    n:=n+1;
  END LOOP;
  RAISE NOTICE 'VALID price/currency examples accepted; % invalid examples rejected',n;
END
$probe$;
ROLLBACK;
