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

function normalizeIngredientTokens(value: string): string[] {
  return normalizeIngredientName(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export type IngredientRestrictionAssessment = {
  status: 'clear' | 'conflict' | 'review';
};

type DietaryCategory = 'vegan' | 'gluten-free' | 'lactose-free';

const DIETARY_CATEGORY_ALIASES: Record<DietaryCategory, readonly string[]> = {
  vegan: ['vegano', 'vegana', 'veganos', 'veganas', 'vegan', 'dieta vegana', 'veganismo'],
  'gluten-free': [
    'sin tacc',
    'intolerancia al gluten',
    'sin gluten',
    'libre de gluten',
    'gluten free',
    'celiaco',
    'celiaca',
    'celiaquia',
  ],
  'lactose-free': [
    'sin lactosa', 'libre de lactosa', 'intolerancia a la lactosa',
    'lactose free', 'lactose-free',
  ],
};

const VEGAN_ANIMAL_INGREDIENTS = [
  'pollo', 'gallina', 'chicken', 'carne', 'carnes', 'meat', 'meats', 'jamon', 'res', 'vacuno', 'beef', 'cerdo', 'puerco', 'pork',
  'cordero', 'lamb', 'pavo', 'turkey', 'pato', 'duck', 'pescado', 'fish', 'atun', 'salmon',
  'sardina', 'mariscos', 'camaron', 'langostino', 'huevo', 'egg', 'leche', 'lacteo', 'lacteos', 'dairy', 'milk', 'queso',
  'crema', 'nata', 'mantequilla', 'yogur', 'yogurt', 'suero', 'whey', 'miel', 'honey',
  'gelatina', 'gelatin',
] as const;
const GLUTEN_CONTAINING_INGREDIENTS = [
  'trigo', 'wheat', 'cebada', 'barley', 'centeno', 'rye', 'seitan', 'gluten', 'gluten vital',
] as const;
const LACTOSE_CONTAINING_INGREDIENTS = [
  'lactosa', 'lactose', 'leche', 'milk', 'crema de leche', 'nata', 'leche condensada',
  'leche evaporada', 'leche en polvo', 'suero de leche', 'whey',
] as const;

function containsTokenSequence(value: string, phrase: string): boolean {
  const tokens = normalizeIngredientTokens(value);
  const phraseTokens = normalizeIngredientTokens(phrase);
  return phraseTokens.length > 0 && tokens.some((_, start) =>
    phraseTokens.every((token, offset) => tokens[start + offset] === token)
  );
}

function containsAnyPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsTokenSequence(value, phrase));
}

function dietaryCategoryForRestriction(restriction: string): DietaryCategory | null {
  const normalized = normalizeIngredientName(restriction);
  return (
    Object.entries(DIETARY_CATEGORY_ALIASES).find(([, aliases]) =>
      aliases.some((alias) => normalizeIngredientName(alias) === normalized)
    )?.[0] as DietaryCategory | undefined
  ) ?? null;
}

const RECOGNIZED_PLANT_BASED_ALTERNATIVES = [
  'leche de almendra', 'leche de soya', 'leche de soja', 'leche de avena', 'leche de coco',
  'leche de arroz', 'leche vegetal', 'almond milk', 'soy milk', 'oat milk', 'coconut milk',
  'queso vegano', 'queso vegetal', 'yogur vegano', 'yogur vegetal', 'crema vegetal',
  'mantequilla vegana', 'carne vegetal', 'carne vegana', 'hamburguesa vegetal',
] as const;

function removeRecognizedPhrases(name: string, phrases: readonly string[]): string {
  const remainingTokens = normalizeIngredientTokens(name);
  for (const phrase of phrases) {
    const phraseTokens = normalizeIngredientTokens(phrase);
    if (phraseTokens.length === 0) continue;

    for (let start = 0; start <= remainingTokens.length - phraseTokens.length; start += 1) {
      const matches = phraseTokens.every(
        (token, offset) => remainingTokens[start + offset] === token
      );
      if (!matches) continue;
      remainingTokens.splice(start, phraseTokens.length);
      start -= 1;
    }
  }
  return remainingTokens.join(' ');
}

function assessVeganIngredient(name: string): IngredientRestrictionAssessment['status'] {
  const remaining = removeRecognizedPhrases(name, RECOGNIZED_PLANT_BASED_ALTERNATIVES);
  if (containsAnyPhrase(remaining, VEGAN_ANIMAL_INGREDIENTS)) return 'conflict';
  if (containsAnyPhrase(remaining, ['caldo', 'stock', 'margarina', 'saborizante'])) return 'review';
  return 'clear';
}

function assessGlutenIngredient(name: string): IngredientRestrictionAssessment['status'] {
  const glutenFreeIngredientPhrases = [
    'harina de trigo sarraceno', 'trigo sarraceno', 'alforfon', 'buckwheat', 'malta de arroz',
    'harina de maiz', 'harina de arroz', 'harina de mandioca', 'harina de yuca',
    'harina de almendra', 'corn flour', 'rice flour', 'tapioca flour',
  ];
  const remaining = removeRecognizedPhrases(name, glutenFreeIngredientPhrases);
  if (containsAnyPhrase(remaining, [
    'malta con gluten', 'malta que contiene gluten', 'malta que contenga gluten',
    'malt with gluten', 'malt containing gluten', 'gluten-containing malt',
    'con gluten', 'contiene gluten', 'contains gluten',
  ])) return 'conflict';
  if (containsAnyPhrase(remaining, GLUTEN_CONTAINING_INGREDIENTS)) return 'conflict';
  if (containsAnyPhrase(remaining, [
    'harina', 'flour', 'pan', 'bread', 'pasta', 'avena', 'oat', 'malta', 'malt',
    'salsa de soja', 'soy sauce', 'salsa inglesa',
  ])) return 'review';
  return 'clear';
}

function assessLactoseIngredient(name: string): IngredientRestrictionAssessment['status'] {
  const safeProductPhrases = [
    ...RECOGNIZED_PLANT_BASED_ALTERNATIVES,
    'leche sin lactosa', 'leche deslactosada', 'lactose-free milk',
  ];
  const remaining = removeRecognizedPhrases(name, safeProductPhrases);
  if (containsAnyPhrase(remaining, LACTOSE_CONTAINING_INGREDIENTS)) return 'conflict';
  if (containsAnyPhrase(remaining, [
    'queso', 'yogur', 'yogurt', 'mantequilla', 'butter', 'margarina', 'crema', 'lacteo', 'lacteos',
  ])) {
    return 'review';
  }
  return 'clear';
}

function assessDietaryCategory(
  category: DietaryCategory,
  ingredientNames: readonly string[]
): IngredientRestrictionAssessment['status'] {
  const assess = category === 'vegan'
    ? assessVeganIngredient
    : category === 'gluten-free'
      ? assessGlutenIngredient
      : assessLactoseIngredient;
  const statuses = ingredientNames.map(assess);
  if (statuses.includes('conflict')) return 'conflict';
  return statuses.includes('review') ? 'review' : 'clear';
}

/** Classifies listed ingredient names only; `clear` is not a safety or contamination guarantee. */
export function assessIngredientRestrictions(
  ingredientNames: readonly string[],
  restrictions: readonly string[]
): IngredientRestrictionAssessment {
  const categories = new Set<DietaryCategory>();
  const explicitRestrictions: string[] = [];
  for (const restriction of restrictions) {
    const category = dietaryCategoryForRestriction(restriction);
    if (category) categories.add(category);
    else explicitRestrictions.push(restriction);
  }

  if (explicitRestrictions.some((restriction) =>
    ingredientNames.some((ingredient) => containsTokenSequence(ingredient, restriction))
  )) return { status: 'conflict' };

  let needsReview =
    categories.size > 0 &&
    (ingredientNames.length === 0 || ingredientNames.some((name) => normalizeIngredientTokens(name).length === 0));
  for (const category of categories) {
    const status = assessDietaryCategory(category, ingredientNames);
    if (status === 'conflict') return { status };
    if (status === 'review') needsReview = true;
  }
  return { status: needsReview ? 'review' : 'clear' };
}

/** Existing callers reject both known conflicts and names that require dietary review. */
export function containsRestrictedIngredientName(
  ingredientNames: readonly string[],
  restrictions: readonly string[]
): boolean {
  return assessIngredientRestrictions(ingredientNames, restrictions).status !== 'clear';
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
    .replace(/\bajos\b/g, 'ajo')
    .replace(/\b(almendra|almendras)\b/g, 'almendra')
    .replace(/\b(huevo|huevos)\b/g, 'huevo')
    .replace(/\b(nuez|nueces)\b/g, 'nuez')
    .replace(/\b(manis?|cacahuates?|cacahuetes?|peanuts?|groundnuts?)\b/g, 'mani');
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
