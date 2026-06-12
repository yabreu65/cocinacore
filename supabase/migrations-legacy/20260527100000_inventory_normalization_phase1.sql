alter table public.recipe_inventory_items
  add column if not exists unit text,
  add column if not exists category text,
  add column if not exists expiration_date date,
  add column if not exists estimated_unit_price numeric,
  add column if not exists purchase_location text,
  add column if not exists low_stock_threshold numeric,
  add column if not exists normalized_name text;

create index if not exists recipe_inventory_items_normalized_name_idx
  on public.recipe_inventory_items (tenant_id, user_id, normalized_name);
