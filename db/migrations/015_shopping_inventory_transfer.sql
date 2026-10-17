-- Durable, nullable marker for the one-time shopping-to-inventory transfer.
alter table public.shopping_list_items
  add column transfer_inventory_item_id uuid null,
  add column transferred_at timestamptz null;

alter table public.shopping_list_items
  add constraint shopping_list_items_transfer_marker_pair_check
  check ((transfer_inventory_item_id is null) = (transferred_at is null));
