import {
  normalizeInventoryUnit,
  parseInventoryDecimal,
  type InventoryUnit,
} from './inventory-input';

// Initial supported currencies, chosen explicitly by the organization. Never infer
// a historical price's currency from the current preference or the browser locale.
export const INVENTORY_CURRENCIES = [
  'ARS',
  'COP',
  'VES',
  'USD',
  'EUR',
  'MXN',
  'CLP',
  'PEN',
] as const;
export type InventoryCurrency = (typeof INVENTORY_CURRENCIES)[number];

export function isInventoryCurrency(value: unknown): value is InventoryCurrency {
  return INVENTORY_CURRENCIES.some((currency) => currency === value);
}

const COUNTRY_CURRENCY: Readonly<Record<string, InventoryCurrency>> = {
  AR: 'ARS',
  CO: 'COP',
  VE: 'VES',
  US: 'USD',
  ES: 'EUR',
  MX: 'MXN',
  CL: 'CLP',
  PE: 'PEN',
};

export function suggestInventoryCurrency(countryCode: string): InventoryCurrency | null {
  return (
    Object.entries(COUNTRY_CURRENCY).find(
      ([code]) => code === countryCode.trim().toUpperCase()
    )?.[1] ?? null
  );
}

export type InventoryPriceReference = Readonly<{
  amount: string;
  currency: InventoryCurrency;
  referenceQuantity: string;
  referenceUnit: InventoryUnit;
}>;

type PriceFields = {
  amount?: string | number | null;
  currency?: unknown;
  referenceQuantity?: string | number | null;
  referenceUnit?: string | null;
};

type PriceValidation = { ok: true; price: InventoryPriceReference } | { ok: false; error: string };

export function validatePriceReference(input: PriceFields): PriceValidation {
  const amount = parseInventoryDecimal(input.amount);
  const quantity = parseInventoryDecimal(input.referenceQuantity);
  const unit = normalizeInventoryUnit(input.referenceUnit);
  if (amount === null) return { ok: false, error: 'Introduce un precio válido y no negativo.' };
  if (!isInventoryCurrency(input.currency))
    return { ok: false, error: 'Selecciona una moneda válida.' };
  if (quantity === null || quantity <= 0)
    return { ok: false, error: 'Introduce una cantidad de referencia mayor que cero.' };
  if (unit === null) return { ok: false, error: 'Selecciona una unidad de referencia válida.' };
  return {
    ok: true,
    price: {
      amount: String(amount),
      currency: input.currency,
      referenceQuantity: String(quantity),
      referenceUnit: unit,
    },
  };
}

export type StoredInventoryPrice = {
  estimated_unit_price: string | number | null;
  price_currency?: string | null;
  price_reference_quantity?: string | number | null;
  price_reference_unit?: string | null;
};

export type InventoryPriceState =
  | { status: 'known'; price: InventoryPriceReference }
  | { status: 'missing' | 'unconfirmed' | 'invalid'; price: null };

// PostgreSQL numeric values may be strings. Keep the legacy amount without
// treating it as a verified price, and never supply a default currency/basis.
export function readInventoryPrice(row: StoredInventoryPrice): InventoryPriceState {
  const metadata = [row.price_currency, row.price_reference_quantity, row.price_reference_unit];
  const hasMetadata = metadata.some((value) => value !== null && value !== undefined);
  if (row.estimated_unit_price === null)
    return { status: hasMetadata ? 'invalid' : 'missing', price: null };
  if (!hasMetadata) return { status: 'unconfirmed', price: null };
  const validated = validatePriceReference({
    amount: row.estimated_unit_price,
    currency: row.price_currency,
    referenceQuantity: row.price_reference_quantity,
    referenceUnit: row.price_reference_unit,
  });
  return validated.ok
    ? { status: 'known', price: validated.price }
    : { status: 'invalid', price: null };
}

// Exact rational monetary values, not JSON DTOs. Keep unrounded values until
// display/totalization; do not mix currencies or use floating-point unit prices.
export type ExactInventoryCost = Readonly<{
  currency: InventoryCurrency;
  numerator: bigint;
  denominator: bigint;
}>;
export type InventoryCostResult =
  | { status: 'known'; cost: ExactInventoryCost }
  | {
      status: 'unknown';
      reason: 'invalid-price' | 'invalid-quantity' | 'incompatible-unit' | 'different-currency';
    };

const DECIMAL_SCALE = BigInt(10000);

function scaledDecimal(raw: string | number | null | undefined): bigint | null {
  const parsed = parseInventoryDecimal(raw);
  if (parsed === null) return null;
  const [whole, fraction = ''] = String(parsed).split('.');
  return BigInt(whole) * DECIMAL_SCALE + BigInt(fraction.padEnd(4, '0'));
}

function compatibleUnits(a: InventoryUnit, b: InventoryUnit): boolean {
  return (
    a === b ||
    (['g', 'kg'].includes(a) && ['g', 'kg'].includes(b)) ||
    (['ml', 'l'].includes(a) && ['ml', 'l'].includes(b))
  );
}

function baseFactor(unit: InventoryUnit): bigint {
  return BigInt(unit === 'kg' || unit === 'l' ? 1000 : 1);
}

export function calculateInventoryCost(input: {
  quantity: string | number | null;
  unit: string | null;
  price: InventoryPriceReference;
  expectedCurrency?: InventoryCurrency;
}): InventoryCostResult {
  const validated = validatePriceReference(input.price);
  if (!validated.ok) return { status: 'unknown', reason: 'invalid-price' };
  const price = validated.price;
  if (input.expectedCurrency !== undefined && input.expectedCurrency !== price.currency)
    return { status: 'unknown', reason: 'different-currency' };
  const quantity = scaledDecimal(input.quantity);
  const unit = normalizeInventoryUnit(input.unit);
  if (quantity === null || unit === null) return { status: 'unknown', reason: 'invalid-quantity' };
  if (!compatibleUnits(unit, price.referenceUnit))
    return { status: 'unknown', reason: 'incompatible-unit' };
  const amount = scaledDecimal(price.amount);
  const reference = scaledDecimal(price.referenceQuantity);
  if (amount === null || reference === null || reference <= BigInt(0))
    return { status: 'unknown', reason: 'invalid-price' };
  return {
    status: 'known',
    cost: {
      currency: price.currency,
      numerator: amount * quantity * baseFactor(unit),
      denominator: DECIMAL_SCALE * reference * baseFactor(price.referenceUnit),
    },
  };
}

// Round only at the display/settlement boundary. CLP has zero minor digits;
// the other initial currencies have two. Return a decimal string (JSON-safe),
// avoiding conversion of potentially large totals to an unsafe JS number.
export function roundInventoryCost(cost: ExactInventoryCost): string {
  if (
    cost.numerator < BigInt(0) ||
    cost.denominator <= BigInt(0) ||
    !isInventoryCurrency(cost.currency)
  )
    throw new RangeError('Invalid inventory cost');
  const digits = cost.currency === 'CLP' ? 0 : 2;
  const factor = BigInt(10) ** BigInt(digits);
  const scaled = cost.numerator * factor;
  const minor = (scaled * BigInt(2) + cost.denominator) / (cost.denominator * BigInt(2));
  if (digits === 0) return minor.toString();
  return `${minor / factor}.${(minor % factor).toString().padStart(digits, '0')}`;
}
