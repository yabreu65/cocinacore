-- Inventory currency and price reference. No backfill: historical prices remain unconfirmed.
ALTER TABLE public.tenants ADD COLUMN currency_code text;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_currency_code_check
  CHECK (currency_code IS NULL OR currency_code IN ('ARS','COP','VES','USD','EUR','MXN','CLP','PEN'));

ALTER TABLE public.recipe_inventory_items
  ADD COLUMN price_currency text,
  ADD COLUMN price_reference_quantity numeric(12,4),
  ADD COLUMN price_reference_unit text;
ALTER TABLE public.recipe_inventory_items ADD CONSTRAINT recipe_inventory_price_reference_check CHECK (
  (price_currency IS NULL AND price_reference_quantity IS NULL AND price_reference_unit IS NULL)
  OR (
    estimated_unit_price IS NOT NULL AND estimated_unit_price BETWEEN 0 AND 99999999.9999
    AND price_currency IS NOT NULL AND price_currency IN ('ARS','COP','VES','USD','EUR','MXN','CLP','PEN')
    AND price_reference_quantity IS NOT NULL AND price_reference_quantity > 0 AND price_reference_quantity <= 99999999.9999
    AND price_reference_unit IS NOT NULL AND price_reference_unit IN ('g','kg','ml','l','unidad','paquete','taza','cucharada','cucharadita')
  )
);

-- Only the existing restricted runtime role may update the new currency column,
-- and only for the authenticated organization with an owner/admin membership.
CREATE POLICY identity_tenants_currency_update ON public.tenants FOR UPDATE TO cocinacore_runtime_rls
  USING (id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id=tenants.id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND m.role IN ('owner','admin')
  ))
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id=tenants.id AND m.user_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND m.role IN ('owner','admin')
  ));
GRANT UPDATE (currency_code) ON public.tenants TO cocinacore_runtime_rls;
GRANT UPDATE (price_currency,price_reference_quantity,price_reference_unit) ON public.recipe_inventory_items TO cocinacore_runtime_rls;
