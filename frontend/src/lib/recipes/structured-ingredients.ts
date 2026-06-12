export type StructuredRecipeIngredient = {
  name: string;
  normalized_name: string;
  quantity: number | null;
  unit: string | null;
  optional_quantity_text: string | null;
  category: string | null;
  estimated_cost_optional: number | null;
  structured: boolean;
};

const UNIT_ALIASES: Array<{ pattern: RegExp; unit: string }> = [
  { pattern: /^(kg|kilo(?:s)?|kilogramo(?:s)?)$/i, unit: 'kg' },
  { pattern: /^(g|gr|gramo(?:s)?)$/i, unit: 'g' },
  { pattern: /^(l|litro(?:s)?)$/i, unit: 'l' },
  { pattern: /^(ml|mililitro(?:s)?)$/i, unit: 'ml' },
  { pattern: /^(unidad(?:es)?|u)$/i, unit: 'unidad' },
  { pattern: /^(taza(?:s)?)$/i, unit: 'taza' },
  { pattern: /^(cucharada(?:s)?)$/i, unit: 'cucharada' },
  { pattern: /^(cucharadita(?:s)?)$/i, unit: 'cucharadita' },
  { pattern: /^(diente(?:s)?)$/i, unit: 'diente' },
  { pattern: /^(ramita(?:s)?)$/i, unit: 'ramita' },
  { pattern: /^(paquete(?:s)?)$/i, unit: 'paquete' },
];

function normalizeFraction(value: string): number | null {
  const clean = value.replace(',', '.').trim();
  if (/^\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  const fraction = clean.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return numerator / denominator;
  }
  const mixed = clean.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    return whole + numerator / denominator;
  }
  return null;
}

function normalizeMarkdownLine(value: string): string {
  return value
    .replace(/^[\s>*-]+/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

export function normalizeIngredientName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(tomates|jitomates)\b/g, 'tomate')
    .replace(/\bcebollas\b/g, 'cebolla')
    .replace(/\bajos\b/g, 'ajo');
}

function normalizeUnit(rawUnit: string | null): string | null {
  if (!rawUnit) return null;
  const clean = rawUnit.toLowerCase().trim();
  const found = UNIT_ALIASES.find((entry) => entry.pattern.test(clean));
  return found?.unit ?? clean;
}

function inferCategory(name: string): string | null {
  const normalized = normalizeIngredientName(name);
  if (/(pollo|carne|pescado|atun|huevo)/.test(normalized)) return 'Proteínas';
  if (/(tomate|cebolla|zanahoria|pimenton|aji|lechuga|pepino)/.test(normalized)) return 'Verduras';
  if (/(leche|queso|mantequilla|yogur)/.test(normalized)) return 'Lácteos';
  if (/(arroz|pasta|harina|avena|pan)/.test(normalized)) return 'Granos';
  if (/(pimienta|oregano|comino|sal|azucar|aceite)/.test(normalized)) return 'Despensa';
  return null;
}

export function parseStructuredIngredient(line: string): StructuredRecipeIngredient {
  const clean = normalizeMarkdownLine(line)
    .replace(/^[-•*]\s*/, '')
    .trim();
  if (!clean) {
    return {
      name: '',
      normalized_name: '',
      quantity: null,
      unit: null,
      optional_quantity_text: null,
      category: null,
      estimated_cost_optional: null,
      structured: false,
    };
  }

  if (/\bal gusto\b|\bpara freir\b|\bcantidad necesaria\b/i.test(clean)) {
    return {
      name: clean,
      normalized_name: normalizeIngredientName(clean),
      quantity: null,
      unit: null,
      optional_quantity_text: 'cantidad libre',
      category: inferCategory(clean),
      estimated_cost_optional: null,
      structured: false,
    };
  }

  const match = clean.match(
    /^(\d+(?:[.,]\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)\s*(kg|kilo(?:s)?|kilogramo(?:s)?|g|gr|gramo(?:s)?|l|litro(?:s)?|ml|mililitro(?:s)?|taza(?:s)?|cucharada(?:s)?|cucharadita(?:s)?|unidad(?:es)?|u|diente(?:s)?|ramita(?:s)?|paquete(?:s)?)?\s+(.+)$/i
  );

  if (!match) {
    return {
      name: clean,
      normalized_name: normalizeIngredientName(clean),
      quantity: null,
      unit: null,
      optional_quantity_text: clean,
      category: inferCategory(clean),
      estimated_cost_optional: null,
      structured: false,
    };
  }

  const quantity = normalizeFraction(match[1]);
  const unit = normalizeUnit(match[2] ?? null);
  const ingredientName = match[3].trim();

  if (quantity === null) {
    return {
      name: ingredientName,
      normalized_name: normalizeIngredientName(ingredientName),
      quantity: null,
      unit,
      optional_quantity_text: match[1],
      category: inferCategory(ingredientName),
      estimated_cost_optional: null,
      structured: false,
    };
  }

  return {
    name: ingredientName,
    normalized_name: normalizeIngredientName(ingredientName),
    quantity: Number(quantity.toFixed(3)),
    unit,
    optional_quantity_text: null,
    category: inferCategory(ingredientName),
    estimated_cost_optional: null,
    structured: true,
  };
}

export function extractStructuredIngredients(recipe: string): StructuredRecipeIngredient[] {
  const lines = recipe
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const ingredients: StructuredRecipeIngredient[] = [];
  let inIngredients = false;

  for (const line of lines) {
    const lower = normalizeMarkdownLine(line).toLowerCase().replace(/:$/, '');
    if (lower.startsWith('ingredientes')) {
      inIngredients = true;
      continue;
    }
    if (
      inIngredients &&
      (lower.startsWith('preparación') ||
        lower.startsWith('preparacion') ||
        lower.startsWith('fuente') ||
        lower.startsWith('tips'))
    ) {
      inIngredients = false;
    }
    if (!inIngredients) continue;
    ingredients.push(parseStructuredIngredient(line));
  }

  return mergeDuplicateIngredients(ingredients);
}

export function validateStructuredIngredients(items: StructuredRecipeIngredient[]): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every(
    (item) =>
      typeof item.name === 'string' &&
      typeof item.normalized_name === 'string' &&
      typeof item.structured === 'boolean'
  );
}

export function mergeDuplicateIngredients(
  items: StructuredRecipeIngredient[]
): StructuredRecipeIngredient[] {
  const map = new Map<string, StructuredRecipeIngredient>();

  for (const item of items) {
    const key = `${item.normalized_name}::${item.unit ?? 'unknown'}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item });
      continue;
    }

    if (
      existing.structured &&
      item.structured &&
      existing.quantity !== null &&
      item.quantity !== null
    ) {
      existing.quantity = Number((existing.quantity + item.quantity).toFixed(3));
    } else {
      existing.structured = false;
      existing.quantity = existing.quantity ?? item.quantity;
      existing.optional_quantity_text =
        existing.optional_quantity_text ?? item.optional_quantity_text;
    }

    if (!existing.category && item.category) existing.category = item.category;
  }

  return Array.from(map.values());
}
