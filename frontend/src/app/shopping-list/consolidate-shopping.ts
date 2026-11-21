import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import { parseExplicitQuantity } from '@/lib/inventory/quantity-normalization';
import type { ShoppingItem } from './ShoppingTransferControls';

type BaseUnit = 'g' | 'ml' | 'unidad' | 'paquete' | 'cucharada' | 'cucharadita' | 'taza';

export type ConsolidatedShoppingProduct = {
  key: string;
  name: string;
  status: ShoppingItem['status'];
  rows: ShoppingItem[];
  required: string;
  purchase: string | null;
  needsReview: boolean;
};

const ALIASES: Record<string, { key: string; name: string }> = {
  huevo: { key: 'huevos', name: 'Huevos' },
  huevos: { key: 'huevos', name: 'Huevos' },
  berenjena: { key: 'berenjenas', name: 'Berenjenas' },
  berenjenas: { key: 'berenjenas', name: 'Berenjenas' },
  tomate: { key: 'tomates', name: 'Tomates' },
  tomates: { key: 'tomates', name: 'Tomates' },
  champiñones: { key: 'champiñones frescos', name: 'Champiñones frescos' },
  champinones: { key: 'champiñones frescos', name: 'Champiñones frescos' },
  'champiñones frescos': { key: 'champiñones frescos', name: 'Champiñones frescos' },
  'champinones frescos': { key: 'champiñones frescos', name: 'Champiñones frescos' },
  'espinaca fresca': { key: 'espinacas frescas', name: 'Espinacas frescas' },
  'espinacas frescas': { key: 'espinacas frescas', name: 'Espinacas frescas' },
  cilantro: { key: 'cilantro fresco', name: 'Cilantro fresco' },
  'cilantro fresco': { key: 'cilantro fresco', name: 'Cilantro fresco' },
  'parmigiano rallado': { key: 'parmesano rallado', name: 'Parmesano rallado' },
  'queso parmigiano rallado': { key: 'parmesano rallado', name: 'Parmesano rallado' },
};

function identity(name: string): { key: string; name: string } {
  const key = normalizeInventoryName(name);
  return ALIASES[key] ?? { key, name: name.trim() };
}

function baseAmount(unit: string, amount: number): { unit: BaseUnit; amount: number } | null {
  switch (unit) {
    case 'kg':
      return { unit: 'g', amount: amount * 1000 };
    case 'g':
      return { unit: 'g', amount };
    case 'l':
      return { unit: 'ml', amount: amount * 1000 };
    case 'ml':
      return { unit: 'ml', amount };
    case 'unidad':
      return { unit: 'unidad', amount };
    case 'paquete':
      return { unit: 'paquete', amount };
    case 'cucharada':
      return { unit: 'cucharada', amount };
    case 'cucharadita':
      return { unit: 'cucharadita', amount };
    case 'taza':
      return { unit: 'taza', amount };
    default:
      return null;
  }
}

function niceNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

function formatRequired(amount: number, unit: BaseUnit): string {
  const quantity = niceNumber(amount);
  if (unit === 'unidad') return `${quantity} ${amount === 1 ? 'unidad' : 'unidades'}`;
  if (unit === 'paquete') return `${quantity} ${amount === 1 ? 'paquete' : 'paquetes'}`;
  return `${quantity} ${unit}`;
}

function packRule(
  key: string,
  unit: BaseUnit
): { size: number; singular: string; plural: string } | null {
  if (key === 'huevos' && unit === 'unidad')
    return { size: 30, singular: 'cartón de 30 huevos', plural: 'cartones de 30 huevos' };
  if (/^arroz (blanco|basmati|jazmin|arborio)$/.test(key) && unit === 'g')
    return { size: 1000, singular: 'paquete de 1 kg', plural: 'paquetes de 1 kg' };
  if (/^(harina de trigo|harina de maiz precocida)$/.test(key) && unit === 'g')
    return { size: 1000, singular: 'paquete de 1 kg', plural: 'paquetes de 1 kg' };
  if (key === 'leche' && unit === 'ml')
    return { size: 1000, singular: 'cartón de 1 litro', plural: 'cartones de 1 litro' };
  return null;
}

function formatPurchase(key: string, amount: number, unit: BaseUnit): string | null {
  const pack = packRule(key, unit);
  if (pack) {
    const packs = Math.ceil(amount / pack.size);
    return `${packs} ${packs === 1 ? pack.singular : pack.plural} · ${formatRequired(packs * pack.size, unit)}`;
  }
  if (unit === 'unidad' || unit === 'paquete') return formatRequired(Math.ceil(amount), unit);
  if (unit === 'g' || unit === 'ml')
    return `${formatRequired(amount, unit)} (presentación a elegir)`;
  return null;
}

function consolidateOne(
  key: string,
  name: string,
  status: ShoppingItem['status'],
  rows: ShoppingItem[]
): ConsolidatedShoppingProduct {
  const quantities = rows.map((row) => {
    if (row.quantity === null) return null;
    const parsed = parseExplicitQuantity(row.quantity);
    return parsed ? baseAmount(parsed.unit, parsed.value) : null;
  });
  const known = quantities.filter(
    (quantity): quantity is NonNullable<typeof quantity> => quantity !== null
  );
  const units = Array.from(new Set(known.map((q) => q.unit)));
  const unresolvedAlternative = /\(\s*o\s+|\s+(?:o|u)\s+/i.test(name);
  const needsReview =
    quantities.some((q) => q === null) || units.length !== 1 || unresolvedAlternative;
  const totals = new Map<BaseUnit, number>();
  for (const q of known) totals.set(q.unit, (totals.get(q.unit) ?? 0) + q.amount);
  const formatted = Array.from(totals).map(([unit, amount]) => formatRequired(amount, unit));
  const required = formatted.join(' + ') || 'Cantidad pendiente';
  const unit = units[0];
  const amount = unit === undefined ? null : (totals.get(unit) ?? null);
  const valid =
    !needsReview &&
    unit !== undefined &&
    amount !== null &&
    amount > 0 &&
    Number.isFinite(amount) &&
    amount < Number.MAX_SAFE_INTEGER;
  return {
    key: `${status}:${key}`,
    name,
    status,
    rows,
    required:
      needsReview && formatted.length > 0
        ? `${required} (${unresolvedAlternative ? 'elegir alternativa' : 'revisar equivalencias'})`
        : required,
    purchase: valid ? formatPurchase(key, amount, unit) : null,
    needsReview,
  };
}

/**
 * Display-only consolidation. Preserve all persisted shopping rows for their
 * individual status, deletion, provenance and inventory-transfer operations.
 */
export function consolidateShoppingItems(
  items: readonly ShoppingItem[]
): ConsolidatedShoppingProduct[] {
  const groups = new Map<
    string,
    { name: string; key: string; status: ShoppingItem['status']; rows: ShoppingItem[] }
  >();
  for (const item of items) {
    const canonical = identity(item.ingredient_name);
    const groupKey = `${item.status}:${canonical.key}`;
    const group = groups.get(groupKey);
    if (group) group.rows.push(item);
    else
      groups.set(groupKey, {
        key: canonical.key,
        name: canonical.name,
        status: item.status,
        rows: [item],
      });
  }
  return Array.from(groups.values()).map(({ key, name, status, rows }) =>
    consolidateOne(key, name, status, rows)
  );
}
