-- Keep the existing audit records and all privileges unchanged.
-- PostgreSQL enforces this FK even for referencing rows hidden by RLS.
-- Non-deferrable NO ACTION blocks direct item deletion with any history,
-- while allowing coordinated tenant/user cascade cleanup when both rows vanish.
DO $retention_preflight$
BEGIN
  IF NOT exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.inventory_movements'::pg_catalog.regclass
        and c.confrelid = 'public.recipe_inventory_items'::pg_catalog.regclass
        and c.conname = 'inventory_movements_inventory_item_id_fkey'
        and c.contype = 'f' and c.convalidated and not c.condeferrable
        and c.confdeltype = 'c' and c.confupdtype = 'a'
        and c.conkey = array[(select attnum from pg_catalog.pg_attribute
          where attrelid = c.conrelid and attname = 'inventory_item_id' and not attisdropped)]
        and c.confkey = array[(select attnum from pg_catalog.pg_attribute
          where attrelid = c.confrelid and attname = 'id' and not attisdropped)]
        and (select count(*) from pg_catalog.pg_trigger t
          where t.tgconstraint = c.oid and t.tgisinternal and t.tgenabled in ('O','A')) = 4
        and not exists (select 1 from pg_catalog.pg_constraint other
          where other.conrelid = c.conrelid and other.confrelid = c.confrelid
            and other.contype = 'f' and other.oid <> c.oid and other.confdeltype = 'c')
    ) THEN
    RAISE EXCEPTION 'INVENTORY_023_UNEXPECTED_SOURCE_FK';
  END IF;
END
$retention_preflight$;

ALTER TABLE public.inventory_movements
  DROP CONSTRAINT inventory_movements_inventory_item_id_fkey,
  ADD CONSTRAINT inventory_movements_inventory_item_id_fkey
    FOREIGN KEY (inventory_item_id) REFERENCES public.recipe_inventory_items(id)
    ON DELETE NO ACTION NOT DEFERRABLE;
