export type SessionInventoryAvailability = 'sufficient' | 'partial' | 'missing' | 'unknown';

export function assessSessionInventoryQuantity(
  requiredQuantity: number | null,
  confirmedQuantity: number | null,
  confirmed: boolean
): SessionInventoryAvailability {
  if (
    !confirmed ||
    requiredQuantity === null ||
    !Number.isFinite(requiredQuantity) ||
    requiredQuantity <= 0 ||
    confirmedQuantity === null ||
    !Number.isFinite(confirmedQuantity) ||
    confirmedQuantity < 0
  ) return 'unknown';

  if (confirmedQuantity >= requiredQuantity) return 'sufficient';
  return confirmedQuantity === 0 ? 'missing' : 'partial';
}
