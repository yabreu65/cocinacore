-- Snapshot positions identify new reconciliation rows. Existing append-only
-- receipts retain NULL positions; their original name uniqueness is preserved.
ALTER TABLE public.real_consumption_items
  ADD COLUMN ingredient_index integer,
  ADD CONSTRAINT real_consumption_items_ingredient_index_check
    CHECK (ingredient_index >= 0 AND ingredient_index < 100);

ALTER TABLE public.real_consumption_items
  DROP CONSTRAINT real_consumption_items_original_key,
  ADD CONSTRAINT real_consumption_items_original_key
    UNIQUE NULLS NOT DISTINCT (operation_id, normalized_original_ingredient, ingredient_index),
  ADD CONSTRAINT real_consumption_items_occurrence_key
    UNIQUE (operation_id, ingredient_index);
