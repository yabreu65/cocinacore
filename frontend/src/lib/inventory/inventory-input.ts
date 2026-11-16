import { normalizeUnit, type NormalizedUnit } from './quantity-normalization';

export const INVENTORY_UNITS = [
  { value: 'g', label: 'Gramos (g)' },
  { value: 'kg', label: 'Kilogramos (kg)' },
  { value: 'ml', label: 'Mililitros (ml)' },
  { value: 'l', label: 'Litros (l)' },
  { value: 'unidad', label: 'Unidades' },
  { value: 'paquete', label: 'Paquetes' },
  { value: 'taza', label: 'Tazas' },
  { value: 'cucharada', label: 'Cucharadas' },
  { value: 'cucharadita', label: 'Cucharaditas' },
] as const satisfies readonly { value: Exclude<NormalizedUnit, 'unknown'>; label: string }[];

export type InventoryUnit = (typeof INVENTORY_UNITS)[number]['value'];

export const INVENTORY_CATEGORIES = [
  'Proteínas',
  'Verduras',
  'Frutas',
  'Lácteos',
  'Granos',
  'Especias',
  'Despensa',
  'Otros',
] as const;

// Match the existing NUMERIC(12,4) movement/threshold precision. No exponents,
// grouping separators, negative values, embedded units or silent rounding.
export function parseInventoryDecimal(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!/^\d{1,8}(?:[.,]\d{1,4})?$/.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function normalizeInventoryUnit(raw: string | null | undefined): InventoryUnit | null {
  if (!raw?.trim() || /\d/.test(raw) || /^tomates?$/i.test(raw.trim())) return null;
  const normalized = normalizeUnit(raw);
  return INVENTORY_UNITS.find((option) => option.value === normalized)?.value ?? null;
}

type InventoryFields = {
  quantity?: string | null;
  unit?: string | null;
  lowStockThreshold?: string | number | null;
  estimatedUnitPrice?: string | number | null;
};

type ValidationResult =
  | {
      ok: true;
      quantity: string | null;
      unit: InventoryUnit | null;
      lowStockThreshold: number | null;
      estimatedUnitPrice: number | null;
    }
  | { ok: false; error: string };

const supplied = (value: string | number | null | undefined) =>
  value != null && String(value).trim() !== '';

export function validateInventoryFields(input: InventoryFields): ValidationResult {
  const quantity = parseInventoryDecimal(input.quantity);
  const unit = normalizeInventoryUnit(input.unit);
  const lowStockThreshold = parseInventoryDecimal(input.lowStockThreshold);
  const estimatedUnitPrice = parseInventoryDecimal(input.estimatedUnitPrice);
  if (supplied(input.quantity) && quantity === null)
    return {
      ok: false,
      error: 'Introduce una cantidad válida, no negativa y con hasta cuatro decimales.',
    };
  if (supplied(input.unit) && unit === null)
    return { ok: false, error: 'Selecciona una unidad de medida válida.' };
  if (quantity !== null && unit === null)
    return { ok: false, error: 'Selecciona una unidad para la cantidad.' };
  if (supplied(input.lowStockThreshold) && lowStockThreshold === null)
    return { ok: false, error: 'Introduce un stock mínimo válido y no negativo.' };
  if (lowStockThreshold !== null && unit === null)
    return { ok: false, error: 'Selecciona la unidad del stock mínimo.' };
  if (supplied(input.estimatedUnitPrice) && estimatedUnitPrice === null)
    return { ok: false, error: 'Introduce un precio válido y no negativo.' };
  return {
    ok: true,
    quantity: quantity === null ? null : String(quantity),
    unit,
    lowStockThreshold,
    estimatedUnitPrice,
  };
}

// Inventory expiry is a calendar date, not a locale-dependent timestamp.
export function isValidInventoryExpirationDate(raw?: string | null): boolean {
  if (raw == null || raw === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith('0000-')) return false;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}

export type InventoryStockState =
  | 'agotado'
  | 'bajo stock'
  | 'suficiente'
  | 'disponible'
  | 'sin cantidad'
  | 'revisar cantidad';

// Never repair ambiguous legacy rows by guessing; distinguish unknown from zero.
export function inventoryStockState(
  quantity: string | null,
  unit: string | null,
  threshold: string | number | null
): InventoryStockState {
  if (!supplied(quantity)) return 'sin cantidad';
  const parsed = validateInventoryFields({ quantity, unit, lowStockThreshold: threshold });
  if (!parsed.ok || parsed.quantity === null) return 'revisar cantidad';
  const amount = Number(parsed.quantity);
  if (amount === 0) return 'agotado';
  if (parsed.lowStockThreshold === null) return 'disponible';
  return amount <= parsed.lowStockThreshold ? 'bajo stock' : 'suficiente';
}
