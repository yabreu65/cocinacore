import { parseExplicitQuantity } from '@/lib/inventory/quantity-normalization';
import { baseShoppingAmount, type BaseUnit } from './consolidate-shopping';

export function validateActualPurchaseQuantity(
  text: string,
  unit: BaseUnit | null,
  minimum: number | null
): string | null {
  if (!text.trim()) return 'Ingresá la cantidad que compraste realmente, con su unidad.';
  const parsed = parseExplicitQuantity(text.trim());
  if (!parsed) return 'Escribí una cantidad positiva y su unidad (por ejemplo, 1.5 kg).';
  const normalized = baseShoppingAmount(parsed.unit, parsed.value);
  if (!normalized || normalized.unit !== unit) {
    return 'La unidad no es compatible con la cantidad necesaria de este producto.';
  }
  if (
    !Number.isFinite(normalized.amount) ||
    normalized.amount <= 0 ||
    normalized.amount > 10_000_000 ||
    ((unit === 'unidad' || unit === 'paquete') && !Number.isInteger(normalized.amount))
  ) {
    return 'Revisá que la cantidad sea válida y, si corresponde, un número entero.';
  }
  if (minimum !== null && normalized.amount < minimum)
    return 'La cantidad comprada no cubre lo necesario. Revisá el valor.';
  return null;
}
