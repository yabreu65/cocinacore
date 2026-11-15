import { z } from 'zod';

const ReconciliationItemSchema = z
  .object({
    ingredientIndex: z.number().int().min(0).max(99).optional(),
    originalIngredient: z.string().trim().min(1).max(200),
    outcome: z.enum(['used', 'omitted', 'unknown', 'substituted']),
    effectiveIngredient: z.string().trim().min(1).max(200).nullable(),
    quantity: z.number().finite().positive().max(1_000_000).nullable(),
    unit: z.string().trim().min(1).max(64).nullable(),
    inventoryItemId: z.string().uuid().nullable(),
    substituteIngredient: z.string().trim().min(1).max(200).nullable(),
    substituteInventoryItemId: z.string().uuid().nullable(),
  })
  .strict();

export const ReconciliationSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    idempotencyKey: z.string().trim().min(1).max(200),
    confirmed: z.literal(true),
    items: z.array(ReconciliationItemSchema).min(1).max(100),
  })
  .strict();

export type ReconciliationRequest = z.infer<typeof ReconciliationSchema>;
