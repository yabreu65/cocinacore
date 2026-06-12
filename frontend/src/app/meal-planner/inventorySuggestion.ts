export type SuggestedInventoryItem = {
  canonical_name: string;
  display_name: string;
  quantity: number | null;
  unit: string;
  estimated: boolean;
  confidence: number;
  sources: string[];
};

export type RawSuggestedItem = {
  ingredient?: string;
  quantity?: number | null;
  unit?: string | null;
  estimated?: boolean;
  confidence?: number;
  source?: string | null;
};

const CANONICAL_EQUIVALENTS: Record<string, string> = {
  jitomate: 'tomate',
  tomate: 'tomate',
  tomatoes: 'tomate',
  tomato: 'tomate',
  cebollin: 'cebollín',
  cebollín: 'cebollín',
  cilantro: 'cilantro',
  parsley: 'perejil',
};

const UNIT_CANONICAL: Record<string, string> = {
  gramos: 'g',
  gramo: 'g',
  g: 'g',
  kilogramo: 'kg',
  kilogramos: 'kg',
  kg: 'kg',
  mililitros: 'ml',
  mililitro: 'ml',
  ml: 'ml',
  litros: 'l',
  litro: 'l',
  l: 'l',
  unidad: 'unidad',
  unidades: 'unidad',
  u: 'unidad',
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function canonicalIngredient(name: string): string {
  const normalized = normalizeText(name);
  return CANONICAL_EQUIVALENTS[normalized] ?? normalized;
}

function canonicalUnit(unit: string): string {
  const normalized = normalizeText(unit);
  return UNIT_CANONICAL[normalized] ?? normalized;
}

function convertToCanonical(
  quantity: number | null,
  unit: string
): { quantity: number | null; unit: string } {
  if (quantity === null || !Number.isFinite(quantity)) {
    return { quantity: null, unit: canonicalUnit(unit || 'unidad') || 'unidad' };
  }

  const baseUnit = canonicalUnit(unit || 'unidad') || 'unidad';

  if (baseUnit === 'kg') {
    return { quantity: quantity * 1000, unit: 'g' };
  }

  if (baseUnit === 'l') {
    return { quantity: quantity * 1000, unit: 'ml' };
  }

  return { quantity, unit: baseUnit };
}

export function buildInventorySuggestion(
  rawItems: RawSuggestedItem[],
  peopleCount: number
): SuggestedInventoryItem[] {
  const safePeople = Number.isFinite(peopleCount) && peopleCount > 0 ? peopleCount : 4;
  const map = new Map<string, SuggestedInventoryItem>();

  for (const raw of rawItems) {
    const ingredient = (raw.ingredient ?? '').trim();
    if (!ingredient) continue;

    const canonical_name = canonicalIngredient(ingredient);
    const source = (raw.source ?? '').trim();
    const estimated = Boolean(raw.estimated);
    const confidence =
      typeof raw.confidence === 'number'
        ? Math.max(0, Math.min(1, raw.confidence))
        : estimated
          ? 0.6
          : 1;

    const quantityValue =
      typeof raw.quantity === 'number' && Number.isFinite(raw.quantity) ? raw.quantity : null;
    const converted = convertToCanonical(quantityValue, raw.unit ?? 'unidad');
    const scaledQuantity =
      converted.quantity === null ? null : Number((converted.quantity * safePeople).toFixed(2));

    const existing = map.get(canonical_name);
    if (!existing) {
      map.set(canonical_name, {
        canonical_name,
        display_name: ingredient,
        quantity: scaledQuantity,
        unit: converted.unit || 'unidad',
        estimated,
        confidence,
        sources: source ? [source] : [],
      });
      continue;
    }

    if (existing.unit === converted.unit && existing.quantity !== null && scaledQuantity !== null) {
      existing.quantity = Number((existing.quantity + scaledQuantity).toFixed(2));
    } else if (existing.quantity === null && scaledQuantity !== null) {
      existing.quantity = scaledQuantity;
      existing.unit = converted.unit;
    } else if (existing.quantity !== null && scaledQuantity === null) {
      // keep numeric existing quantity
    } else {
      existing.quantity = null;
      existing.unit = existing.unit || converted.unit;
    }

    existing.estimated = existing.estimated || estimated;
    existing.confidence = Number(Math.min(existing.confidence, confidence).toFixed(2));
    if (source && !existing.sources.includes(source)) existing.sources.push(source);
  }

  return Array.from(map.values()).sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
}
