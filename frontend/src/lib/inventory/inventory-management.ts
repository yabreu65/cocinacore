import { z } from 'zod';
import { parseInventoryPriceWrite } from './inventory-price';
import {
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  isValidInventoryExpirationDate,
  parseInventoryDecimal,
} from './inventory-input';

const decimal = z
  .string()
  .min(1)
  .max(32)
  .refine((value) => parseInventoryDecimal(value) !== null);
const unit = z.enum(
  INVENTORY_UNITS.map((option) => option.value) as [
    (typeof INVENTORY_UNITS)[number]['value'],
    ...(typeof INVENTORY_UNITS)[number]['value'][],
  ]
);
const reason = z.string().trim().min(1).max(300);
export const inventoryRevisionSchema = z.string().min(1).max(100).regex(/^\d+:\d+(?:\.\d+)?$/);
const identity = {
  id: z.string().uuid(),
  revision: inventoryRevisionSchema,
};
const priceReference = z.unknown().transform((raw, context) => {
  const result = parseInventoryPriceWrite(raw);
  if (!result.ok || !result.price) {
    context.addIssue({ code: 'custom', message: result.ok ? 'Precio incompleto.' : result.error });
    return z.NEVER;
  }
  return result.price;
});
const stock = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('count'), quantity: decimal, reason }).strict(),
  z.object({ kind: z.literal('convert'), unit }).strict(),
  z
    .object({
      kind: z.literal('correct'),
      quantity: decimal,
      unit,
      lowStockThreshold: decimal.nullable(),
      reason,
    })
    .strict(),
]);
const metadata = z
  .object({
    ingredientName: z.string().trim().min(1).max(200).optional(),
    category: z.enum(INVENTORY_CATEGORIES).nullable().optional(),
    expirationDate: z
      .string()
      .refine((value) => value !== '' && isValidInventoryExpirationDate(value))
      .nullable()
      .optional(),
    purchaseLocation: z.string().trim().max(300).nullable().optional(),
    lowStockThreshold: decimal.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const inventoryManagementSchema = z.discriminatedUnion('action', [
  z.object({ ...identity, action: z.literal('stock'), command: stock }).strict(),
  z.object({ ...identity, action: z.literal('metadata'), changes: metadata }).strict(),
  z.object({ ...identity, action: z.literal('price'), priceReference }).strict(),
]);
export type InventoryManagementRequest = z.infer<typeof inventoryManagementSchema>;
