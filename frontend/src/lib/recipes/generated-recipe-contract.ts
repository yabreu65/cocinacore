import { z } from 'zod';
import { projectExactRecipeAmount, recipeAmountForImport } from './recipe-amount';
import { recipeImportIngredients, renderRecipeDisplay } from './recipe-import';
import { normalizeExplicitUnit } from '@/lib/inventory/quantity-normalization';
import { normalizeIngredientName, type StructuredRecipeIngredient } from './structured-ingredients';

const MAX_INGREDIENTS = 100;
const MAX_RECIPE_TEXT = 20_000;
const MAX_PROVIDER_TEXT = 100_000;

function singleLine(maxLength: number) {
  return z.string().trim().min(1).max(maxLength).refine(
    (value) => !/[\r\n\u0000-\u001f\u007f\u2028\u2029]/u.test(value),
    'Expected a single line of text'
  );
}

const ingredientSchema = z.object({
  name: singleLine(200),
  quantity: singleLine(100).nullable(),
  unit: singleLine(50).nullable(),
  quantityNote: singleLine(100).nullable(),
}).strict();

const providerRecipeSchema = z.object({
  outcome: z.enum(['recipe', 'unavailable']),
  title: singleLine(200),
  servings: z.number().int().min(1).max(100),
  ingredients: z.array(ingredientSchema).max(MAX_INGREDIENTS),
  steps: z.array(singleLine(1000)).max(40),
  // Older responses may still include tips; never discard them to evade validation.
  tips: z.array(singleLine(500)).max(10).optional().default([]),
}).strict();

type ProviderRecipe = z.infer<typeof providerRecipeSchema>;

/**
 * Provider-facing JSON Schema: use Gemini's supported structural subset.
 * Length, collection-size and semantic constraints remain enforced by
 * providerRecipeSchema and parseGeneratedRecipeResponse, not by the provider.
 * Avoid a large bounded grammar that the provider may reject.
 */
export const generatedRecipeResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'title', 'servings', 'ingredients', 'steps'],
  properties: {
    outcome: { type: 'string', enum: ['recipe', 'unavailable'] },
    title: { type: 'string' },
    servings: { type: 'integer' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unit', 'quantityNote'],
        properties: {
          name: { type: 'string' },
          quantity: { type: ['string', 'null'] },
          unit: { type: ['string', 'null'] },
          quantityNote: { type: ['string', 'null'] },
        },
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function buildGeneratedRecipeInstructions(servings: number): string {
  return [
    'Devuelve exclusivamente JSON conforme al esquema, sin Markdown, en español.',
    'Interpreta y respeta todas las restricciones obligatorias del perfil y la solicitud. Las restricciones obligatorias prevalecen sobre preferencias, inventario y recetario. No afirmes que la receta garantiza ausencia de alérgenos o contaminación cruzada.',
    'Si hay restricciones, elige alimentos de composición identificable; evita productos de composición incierta. Si es apropiado, usa agua en vez de caldo. Si no puedes formular una propuesta compatible o la composición necesaria es incierta, devuelve outcome: "unavailable", title: "Sin propuesta compatible", ingredients: [], steps: [].',
    `Las cantidades son totales para ${servings} comensales; servings debe ser ${servings}. Declara todos los ingredientes utilizados.`,
    'quantity es un número positivo expresado como texto (decimal o fracción); unit es la unidad explícita o null. Ejemplo: {"name":"Tomates maduros medianos","quantity":"2","unit":"unidades","quantityNote":null}. Si la cantidad falta o es al gusto, usa quantity: null y la indicación original en quantityNote. No inventes cantidades, unidades ni referencias bibliográficas.',
    'Escribe pasos claros de cocina en lenguaje natural, usando los ingredientes declarados. Puedes usar sus nombres o referencias {{1}}, {{2}}, etc. por posición. No agregues ingredientes fuera de la lista ni menciones ingredientes excluidos.',
    'Integra la técnica culinaria necesaria en los pasos. No añadas un apartado de consejos, sustituciones ni afirmaciones sobre seguridad o adaptación. Las fuentes se adjuntan en el servidor.',
  ].join('\n');
}

export type GeneratedRecipeResult = {
  title: string;
  servings: number;
  recipe: string;
  preparation: string;
  structuredIngredients: StructuredRecipeIngredient[];
  /** A generated proposal, not a human-reviewed ingredient list. */
  recipeReviewRequired: true;
  /** Exact amounts as supplied, before projection to the legacy numeric DTO. */
  ingredients: ProviderRecipe['ingredients'];
};

type ParseResult = { success: true; value: GeneratedRecipeResult } | { success: false; reason: string };

/**
 * Normalize only unambiguous presentation differences at the provider boundary.
 * A simultaneous amount and other note is evidence to review, not an exact
 * quantity. Preserve both as text so no downstream stock calculation guesses.
 */
function toStructuredIngredient(ingredient: ProviderRecipe['ingredients'][number]): StructuredRecipeIngredient | null {
  let { name, quantity: exactText, unit: rawUnit, quantityNote: note } = ingredient;
  let quantity: number | null = null;
  if (exactText !== null) {
    const projected = projectExactRecipeAmount(exactText);
    if (!projected) return null;
    if (note !== null) {
      // A standalone size adjective on an explicit count cannot change the count.
      if (normalizeExplicitUnit(rawUnit) === 'unidad' && /^(?:pequeñ[oa]s?|median[oa]s?|grandes?)$/iu.test(note)) {
        name = `${name} ${note}`;
        note = null;
      } else {
        note = `Por confirmar: ${[exactText, rawUnit].filter(Boolean).join(' ')} (${note})`;
        exactText = null;
        rawUnit = null;
      }
    }
    if (exactText !== null) quantity = projected.quantity;
  }
  const normalizedName = normalizeIngredientName(name);
  if (name.length > 200 || !/\p{L}/u.test(normalizedName) || /[{}]/u.test(name)) return null;
  if (exactText === null && note !== null && recipeAmountForImport(null, undefined, note, name) === null) return null;
  const explicitUnit = normalizeExplicitUnit(rawUnit);
  const unit = explicitUnit === 'unknown' ? rawUnit : explicitUnit;
  return {
    name,
    normalized_name: normalizedName,
    quantity,
    ...(exactText !== null ? { exact_quantity_text: exactText } : {}),
    unit,
    optional_quantity_text: note,
    category: null,
    estimated_cost_optional: null,
    structured: quantity !== null && explicitUnit !== 'unknown',
  };
}

function renderSteps(input: ProviderRecipe, ingredients: readonly StructuredRecipeIngredient[]): string[] | null {
  const steps: string[] = [];
  for (const step of input.steps) {
    let invalid = false;
    const rendered = step.replace(/\{\{([1-9]\d*)\}\}/g, (_, rawIndex: string) => {
      const index = Number(rawIndex) - 1;
      const ingredient = ingredients[index];
      if (!Number.isSafeInteger(index) || !ingredient) {
        invalid = true;
        return '';
      }
      return ingredient.name;
    });
    // Reject malformed references rather than displaying or dropping them.
    if (invalid || /[{}]/u.test(rendered)) return null;
    steps.push(rendered);
  }
  return steps;
}

/**
 * Parses and normalizes provider proposals before persistence. Natural prose
 * is allowed; any supplied positional reference must be valid. Neither prose
 * nor references certify complete ingredients or allergen safety.
 */
export function parseGeneratedRecipeResponse(raw: string, expectedServings: number): ParseResult {
  if (raw.length > MAX_PROVIDER_TEXT) return { success: false, reason: 'response_too_large' };
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { success: false, reason: 'invalid_json' };
  }
  const parsed = providerRecipeSchema.safeParse(value);
  if (!parsed.success) return { success: false, reason: 'invalid_recipe_shape' };
  const input = parsed.data;
  if (input.servings !== expectedServings) return { success: false, reason: 'servings_mismatch' };
  if (input.outcome === 'unavailable') {
    if (input.ingredients.length || input.steps.length || input.tips.length) {
      return { success: false, reason: 'invalid_recipe_shape' };
    }
    return { success: false, reason: 'no_compatible_recipe' };
  }
  if (!input.ingredients.length || !input.steps.length) {
    return { success: false, reason: 'invalid_recipe_shape' };
  }
  const structuredIngredients: StructuredRecipeIngredient[] = [];
  for (const ingredient of input.ingredients) {
    const item = toStructuredIngredient(ingredient);
    if (!item || /[{}]/u.test(ingredient.name)) return { success: false, reason: 'invalid_ingredient' };
    structuredIngredients.push(item);
  }
  const steps = renderSteps(input, structuredIngredients);
  if (!steps || input.tips.some((tip) => /[{}]/u.test(tip))) {
    return { success: false, reason: 'invalid_ingredient_references' };
  }
  const preparation = [
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    ...(input.tips.length ? ['', 'TIPS', ...input.tips.map((tip) => '- ' + tip)] : []),
  ].join('\n');
  const recipe = renderRecipeDisplay(input.title, recipeImportIngredients(structuredIngredients), preparation);
  if (recipe.length > MAX_RECIPE_TEXT) return { success: false, reason: 'recipe_too_large' };
  return {
    success: true,
    value: { title: input.title, servings: input.servings, recipe, preparation, structuredIngredients, ingredients: input.ingredients, recipeReviewRequired: true },
  };
}
