import { inventoryStockState, type InventoryStockState } from './inventory-input';
import {
  calculateInventoryCost,
  readInventoryPrice,
  roundInventoryCost,
  type ExactInventoryCost,
  type InventoryCurrency,
  type StoredInventoryPrice,
} from './inventory-price';
import { expirationCalendarDay, normalizeInventoryName } from './normalize-inventory';

export type OverviewItem = StoredInventoryPrice & {
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  expiration_date: string | null;
  low_stock_threshold: number | string | null;
};
export type ExpiryState = 'expired' | 'soon' | 'later' | 'missing' | 'invalid';
export function expiryState(value: string | null, today: Date): ExpiryState {
  if (!value) return 'missing';
  const day = expirationCalendarDay(value);
  if (day === null) return 'invalid';
  const delta = (day - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000;
  return delta < 0 ? 'expired' : delta <= 5 ? 'soon' : 'later';
}
export type InventoryFilters = {
  search: string;
  category: string;
  stock: InventoryStockState | 'all';
  expiry: ExpiryState | 'all';
};
export const EMPTY_INVENTORY_FILTERS: InventoryFilters = {
  search: '',
  category: '',
  stock: 'all',
  expiry: 'all',
};
export function filterInventory<T extends OverviewItem>(
  rows: readonly T[],
  filters: InventoryFilters,
  today: Date
): T[] {
  const term = normalizeInventoryName(filters.search);
  return rows.filter(
    (row) =>
      (!term || normalizeInventoryName(row.ingredient_name).includes(term)) &&
      (!filters.category || (row.category || 'Sin categoría') === filters.category) &&
      (filters.stock === 'all' ||
        inventoryStockState(row.quantity, row.unit, row.low_stock_threshold) === filters.stock) &&
      (filters.expiry === 'all' || expiryState(row.expiration_date, today) === filters.expiry)
  );
}
function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) {
    const r = a % b;
    a = b;
    b = r;
  }
  return a;
}
function addCost(a: ExactInventoryCost, b: ExactInventoryCost): ExactInventoryCost {
  if (a.currency !== b.currency) throw new Error('Incompatible currencies');
  const divisor = gcd(a.denominator, b.denominator);
  const denominator = (a.denominator / divisor) * b.denominator;
  const numerator =
    a.numerator * (b.denominator / divisor) + b.numerator * (a.denominator / divisor);
  const reduced = gcd(numerator, denominator);
  return {
    currency: a.currency,
    numerator: numerator / reduced,
    denominator: denominator / reduced,
  };
}
export function summarizeInventory(
  rows: readonly OverviewItem[],
  currency: InventoryCurrency | null,
  today: Date
) {
  let alerts = 0,
    lowStock = 0,
    expiring = 0,
    needsReview = 0,
    valued = 0;
  let total: ExactInventoryCost | null = null;
  for (const row of rows) {
    const stock = inventoryStockState(row.quantity, row.unit, row.low_stock_threshold);
    const expiry = expiryState(row.expiration_date, today);
    const low = stock === 'agotado' || stock === 'bajo stock';
    const exp = expiry === 'expired' || expiry === 'soon';
    if (low) lowStock++;
    if (exp) expiring++;
    if (low || exp) alerts++;
    if (stock === 'sin cantidad' || stock === 'revisar cantidad' || expiry === 'invalid')
      needsReview++;
    const price = readInventoryPrice(row);
    if (!currency || price.status !== 'known') continue;
    const cost = calculateInventoryCost({
      quantity: row.quantity,
      unit: row.unit,
      price: price.price,
      expectedCurrency: currency,
    });
    if (cost.status !== 'known') continue;
    total = total ? addCost(total, cost.cost) : cost.cost;
    valued++;
  }
  return {
    count: rows.length,
    alerts,
    lowStock,
    expiring,
    needsReview,
    valued,
    unvalued: rows.length - valued,
    currency,
    knownValue: total ? roundInventoryCost(total) : null,
  };
}
