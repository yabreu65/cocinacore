export type NormalizedUnit =
  | 'unidad'
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'paquete'
  | 'cucharada'
  | 'cucharadita'
  | 'taza'
  | 'unknown';

export type ParsedQuantity = {
  raw: string;
  value: number | null;
  unit: NormalizedUnit;
  structured: boolean;
  reason?: 'empty' | 'text-only' | 'unrecognized';
};

export type QuantityComparisonResult = {
  available: number | null;
  required: number | null;
  missing: number | null;
  remaining: number | null;
  status: 'sufficient' | 'partial' | 'missing' | 'unknown';
  unit: NormalizedUnit;
};

type UnitFamily = 'mass' | 'volume' | 'count' | 'package' | 'spoon' | 'cup' | 'unknown';

const UNIT_ALIASES: Record<string, NormalizedUnit> = {
  u: 'unidad',
  und: 'unidad',
  unidad: 'unidad',
  unidades: 'unidad',
  tomate: 'unidad',
  tomates: 'unidad',
  g: 'g',
  gr: 'g',
  gramo: 'g',
  gramos: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogramo: 'kg',
  kilogramos: 'kg',
  ml: 'ml',
  mililitro: 'ml',
  mililitros: 'ml',
  l: 'l',
  litro: 'l',
  litros: 'l',
  paquete: 'paquete',
  paquetes: 'paquete',
  cda: 'cucharada',
  cucharada: 'cucharada',
  cucharadas: 'cucharada',
  cdta: 'cucharadita',
  cucharadita: 'cucharadita',
  cucharaditas: 'cucharadita',
  taza: 'taza',
  tazas: 'taza',
};

function unitFamily(unit: NormalizedUnit): UnitFamily {
  if (unit === 'g' || unit === 'kg') return 'mass';
  if (unit === 'ml' || unit === 'l') return 'volume';
  if (unit === 'unidad') return 'count';
  if (unit === 'paquete') return 'package';
  if (unit === 'cucharada' || unit === 'cucharadita') return 'spoon';
  if (unit === 'taza') return 'cup';
  return 'unknown';
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function parseNumericValue(raw: string): number | null {
  const compact = raw.replace(',', '.').trim();
  if (!compact) return null;

  const fraction = compact.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator;
    }
  }

  const mixedFraction = compact.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (
      Number.isFinite(whole) &&
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator !== 0
    ) {
      return whole + numerator / denominator;
    }
  }

  const numericMatch = compact.match(/^\d+(\.\d+)?$/);
  if (!numericMatch) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeUnit(unit: string | null): NormalizedUnit {
  if (!unit) return 'unknown';
  const normalized = normalizeText(unit);
  return UNIT_ALIASES[normalized] ?? 'unknown';
}

export function parseQuantity(input: string): ParsedQuantity {
  const raw = input ?? '';
  const normalized = normalizeText(raw);

  if (!normalized) {
    return { raw, value: null, unit: 'unknown', structured: false, reason: 'empty' };
  }

  if (normalized === 'al gusto') {
    return { raw, value: null, unit: 'unknown', structured: false, reason: 'text-only' };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { raw, value: null, unit: 'unknown', structured: false, reason: 'empty' };
  }

  let value: number | null = null;
  let unit: NormalizedUnit = 'unknown';
  let consumed = 0;

  if (tokens.length >= 2) {
    value = parseNumericValue(`${tokens[0]} ${tokens[1]}`);
    if (value !== null) consumed = 2;
  }
  if (value === null) {
    value = parseNumericValue(tokens[0]);
    if (value !== null) consumed = 1;
  }

  if (value === null) {
    return { raw, value: null, unit: 'unknown', structured: false, reason: 'unrecognized' };
  }

  const unitToken = tokens[consumed] ?? '';
  if (unitToken) {
    unit = normalizeUnit(unitToken);
  }
  if (unit === 'unknown' && consumed === tokens.length) {
    unit = 'unidad';
  }
  if (unit === 'unknown' && tokens.length > consumed + 1) {
    unit = normalizeUnit(`${tokens[consumed]} ${tokens[consumed + 1]}`);
  }

  return {
    raw,
    value,
    unit,
    structured: true,
  };
}

export function formatQuantity(value: number | null, unit: NormalizedUnit): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const safeUnit = unit === 'unknown' ? '' : ` ${unit}`;
  return `${Number(value.toFixed(2)).toString()}${safeUnit}`;
}

export function canCompareUnits(a: NormalizedUnit, b: NormalizedUnit): boolean {
  if (a === 'unknown' || b === 'unknown') return false;
  return unitFamily(a) === unitFamily(b);
}

export function convertQuantity(
  value: number,
  fromUnit: NormalizedUnit,
  toUnit: NormalizedUnit
): number | null {
  if (!Number.isFinite(value)) return null;
  if (fromUnit === toUnit) return value;
  if (!canCompareUnits(fromUnit, toUnit)) return null;

  if (fromUnit === 'kg' && toUnit === 'g') return value * 1000;
  if (fromUnit === 'g' && toUnit === 'kg') return value / 1000;
  if (fromUnit === 'l' && toUnit === 'ml') return value * 1000;
  if (fromUnit === 'ml' && toUnit === 'l') return value / 1000;

  return null;
}

export function compareInventoryToRequirement(
  inventoryItem: { quantity: string | null; unit: string | null },
  requiredIngredient: { quantity: string | null; unit: string | null }
): QuantityComparisonResult {
  const inventoryParsed = parseQuantity(
    [inventoryItem.quantity ?? '', inventoryItem.unit ?? ''].filter(Boolean).join(' ').trim()
  );
  const requiredParsed = parseQuantity(
    [requiredIngredient.quantity ?? '', requiredIngredient.unit ?? '']
      .filter(Boolean)
      .join(' ')
      .trim()
  );

  if (!inventoryParsed.structured || !requiredParsed.structured) {
    return {
      available: inventoryParsed.value,
      required: requiredParsed.value,
      missing: null,
      remaining: null,
      status: 'unknown',
      unit: requiredParsed.unit !== 'unknown' ? requiredParsed.unit : inventoryParsed.unit,
    };
  }

  const targetUnit = requiredParsed.unit !== 'unknown' ? requiredParsed.unit : inventoryParsed.unit;
  if (
    !canCompareUnits(inventoryParsed.unit, targetUnit) ||
    !canCompareUnits(requiredParsed.unit, targetUnit)
  ) {
    return {
      available: inventoryParsed.value,
      required: requiredParsed.value,
      missing: null,
      remaining: null,
      status: 'unknown',
      unit: targetUnit,
    };
  }

  const available =
    inventoryParsed.unit === targetUnit
      ? inventoryParsed.value
      : convertQuantity(inventoryParsed.value ?? 0, inventoryParsed.unit, targetUnit);
  const required =
    requiredParsed.unit === targetUnit
      ? requiredParsed.value
      : convertQuantity(requiredParsed.value ?? 0, requiredParsed.unit, targetUnit);

  if (available === null || required === null) {
    return {
      available,
      required,
      missing: null,
      remaining: null,
      status: 'unknown',
      unit: targetUnit,
    };
  }

  const diff = available - required;
  if (diff >= 0) {
    return {
      available,
      required,
      missing: 0,
      remaining: Number(diff.toFixed(2)),
      status: 'sufficient',
      unit: targetUnit,
    };
  }

  if (available > 0) {
    return {
      available,
      required,
      missing: Number(Math.abs(diff).toFixed(2)),
      remaining: 0,
      status: 'partial',
      unit: targetUnit,
    };
  }

  return {
    available,
    required,
    missing: Number(Math.abs(diff).toFixed(2)),
    remaining: 0,
    status: 'missing',
    unit: targetUnit,
  };
}
