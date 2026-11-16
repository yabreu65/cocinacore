import { describe, expect, it } from 'vitest';
import { buildRecipeImportPayload } from './recipe-import';
import { buildRecipeImportFromHistory } from './recipe-history-import';
import { extractRecipeRequirements } from '@/lib/inventory/recipe-requirements';
import { readQuantityBasis, exactQuantityText } from '@/lib/inventory/exact-quantity';
import { CreatePersistentRecipeSchema, MealPlanWarmupSchema } from '@/lib/validation';
import { recipeAmountForImport } from './recipe-amount';
import { assessIngredientRestrictions, containsRestrictedRecipeContent } from './structured-ingredients';
import {
  buildGeneratedRecipeInstructions,
  generatedRecipeResponseJsonSchema,
  parseGeneratedRecipeResponse,
} from './generated-recipe-contract';

function candidate() {
  return {
    outcome: 'recipe',
    title: 'Arroz con tomate',
    servings: 4,
    ingredients: [
      { name: 'Arroz', quantity: '1/3', unit: 'taza', quantityNote: null },
      { name: 'Tomate', quantity: '1 1/2', unit: 'unidades', quantityNote: null },
      { name: 'Sal', quantity: null, unit: null, quantityNote: 'al gusto' },
    ],
    steps: ['Calentar la olla.', 'Cocinar {{1}} y agregar {{2}}.', 'Sazonar con {{3}}.'],
    tips: ['Servir caliente.'],
  };
}

function parse(value: unknown, servings = 4) {
  return parseGeneratedRecipeResponse(JSON.stringify(value), servings);
}

describe('generated recipe contract', () => {
  it('rejects an ambiguous broth from the real vegan generation but accepts a simple explicit alternative', () => {
    const real = {
      outcome: 'recipe',
      title: 'Arroz con Tomate Vegano',
      servings: 2,
      ingredients: [
        { name: 'Arroz de grano redondo', quantity: '1', unit: 'taza', quantityNote: null },
        { name: 'Tomates maduros', quantity: '2', unit: 'unidades', quantityNote: null },
        { name: 'Caldo de verduras', quantity: '2.5', unit: 'tazas', quantityNote: null },
      ],
      steps: ['Cocina {{1}} con {{2}} y {{3}}.'],
      tips: [],
    };
    const restrictions = ['maní', 'Vegano'];
    const actual = parse(real, 2);
    expect(actual.success).toBe(true);
    if (!actual.success) throw new Error(actual.reason);
    expect(assessIngredientRestrictions(['Caldo de verduras'], restrictions)).toEqual({ status: 'review' });
    expect(containsRestrictedRecipeContent(actual.value.structuredIngredients.map(i => i.name), actual.value.recipe, restrictions)).toBe(true);
    const alternative = parse({
      ...real,
      ingredients: real.ingredients.map(i => i.name === 'Caldo de verduras' ? { ...i, name: 'Agua' } : i),
    }, 2);
    expect(alternative.success).toBe(true);
    if (!alternative.success) throw new Error(alternative.reason);
    expect(containsRestrictedRecipeContent(alternative.value.structuredIngredients.map(i => i.name), alternative.value.recipe, restrictions)).toBe(false);
  });

  it('normalizes the real tomato size note without changing the explicit count', () => {
    const original = {
      ...candidate(),
      servings: 2,
      ingredients: [{ name: 'Tomates maduros', quantity: '2', unit: 'unidades', quantityNote: 'medianos' }],
      steps: ['Cocina {{1}}.'],
      tips: [],
    };
    const normalized = parse(original, 2);
    expect(normalized.success).toBe(true);
    if (!normalized.success) throw new Error(normalized.reason);
    expect(normalized.value.structuredIngredients[0]).toMatchObject({
      name: 'Tomates maduros medianos', quantity: 2, exact_quantity_text: '2', unit: 'unidad', optional_quantity_text: null,
    });
    expect(normalized.value.preparation).toContain('Tomates maduros medianos');
    expect(buildGeneratedRecipeInstructions(2)).toContain('Tomates maduros medianos');
  });

  it.each(['al gusto', 'entre 2 y 4 unidades', 'aproximadamente', 'o 4'])(
    'preserves a contradictory note as uncertain text, never exact stock (%s)', (note) => {
      const original = {
        ...candidate(),
        ingredients: [{ name: 'Tomate', quantity: '2', unit: 'unidades', quantityNote: note }],
        steps: ['Cocina el tomate.'], tips: [],
      };
      const result = parse(original);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.reason);
      const item = result.value.structuredIngredients[0];
      expect(item).toMatchObject({ name: 'Tomate', quantity: null, unit: null, structured: false,
        optional_quantity_text: `Por confirmar: 2 unidades (${note})` });
      expect(item).not.toHaveProperty('exact_quantity_text');
      const imported = buildRecipeImportPayload({
        title: result.value.title, instructions: result.value.recipe, preparation: result.value.preparation,
        servings: 4, structuredIngredients: result.value.structuredIngredients, recipeHistoryId: 'f1e2d3c4-a5b6-47c8-9012-3456789abcde',
      });
      expect(imported.ingredients[0]).toEqual({ name: 'Tomate', quantity: item.optional_quantity_text, unit: null });
      expect(extractRecipeRequirements(imported.ingredients)[0]?.requiredQuantity).toBeNull();
    }
  );

  it('accepts natural steps and mixed valid references without inferring ingredient coverage', () => {
    const result = parse({ ...candidate(), steps: ['Cocinar el arroz y el tomate.', 'Sazonar con {{3}}.'] });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    expect(result.value.preparation).toContain('Cocinar el arroz y el tomate.');
    expect(result.value.preparation).toContain('Sazonar con Sal.');
  });

  it('keeps the provider schema simple without relaxing local response bounds', () => {
    const wire = JSON.stringify(generatedRecipeResponseJsonSchema);
    expect(wire).not.toMatch(/"(?:minLength|maxLength|minItems|maxItems|minimum|maximum)"/);
    const input = candidate();
    expect(parse({ ...input, title: 'x'.repeat(201) })).toMatchObject({ success: false });
    expect(parse({ ...input, ingredients: Array.from({ length: 101 }, () => input.ingredients[0]) })).toMatchObject({ success: false });
    expect(parse({ ...input, steps: Array.from({ length: 41 }, () => '{{1}}') })).toMatchObject({ success: false });
    expect(parse({ ...input, tips: Array.from({ length: 11 }, () => 'Tip') })).toMatchObject({ success: false });
    expect(parse({ ...input, steps: ['x'.repeat(1001)] })).toMatchObject({ success: false });
    expect(parse({ ...input, ingredients: [{ ...input.ingredients[0], name: 'x'.repeat(201) }] })).toMatchObject({ success: false });
  });

  it('accepts the minimal provider contract without tips while retaining validation of legacy tips', () => {
    const { tips, ...minimal } = candidate();
    const result = parse(minimal);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    expect(result.value.recipe).not.toContain('TIPS');
    expect(parse({ ...minimal, tips })).toMatchObject({ success: true });
    expect(parse({ ...minimal, tips: ['Añadir {{99}}.'] })).toEqual({ success: false, reason: 'invalid_ingredient_references' });
  });

  it('renders validated Spanish steps and retains exact source amounts without inventing data', () => {
    const result = parse(candidate());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    expect(result.value.title).toBe('Arroz con tomate');
    expect(result.value.servings).toBe(4);
    expect(result.value.recipe).toBe([
      'Arroz con tomate', '', 'INGREDIENTES',
      '- 1/3 taza Arroz', '- 1 1/2 unidad Tomate', '- al gusto Sal',
      '', 'PREPARACIÓN',
      '1. Calentar la olla.', '2. Cocinar Arroz y agregar Tomate.', '3. Sazonar con Sal.',
      '', 'TIPS', '- Servir caliente.',
    ].join('\n'));
    expect(result.value.ingredients).toEqual(candidate().ingredients);
    expect(result.value.structuredIngredients).toEqual([
      { name: 'Arroz', normalized_name: 'arroz', quantity: null, exact_quantity_text: '1/3', unit: 'taza', optional_quantity_text: null, category: null, estimated_cost_optional: null, structured: false },
      { name: 'Tomate', normalized_name: 'tomate', quantity: 1.5, exact_quantity_text: '1 1/2', unit: 'unidad', optional_quantity_text: null, category: null, estimated_cost_optional: null, structured: true },
      { name: 'Sal', normalized_name: 'sal', quantity: null, unit: null, optional_quantity_text: 'al gusto', category: null, estimated_cost_optional: null, structured: false },
    ]);
  });

  it('preserves explicit quantities without assuming an unknown unit or count', () => {
    const input = {
      ...candidate(),
      ingredients: [
        { name: 'Arroz', quantity: '0,25', unit: 'kilogramos', quantityNote: null },
        { name: 'Tomate', quantity: '2', unit: null, quantityNote: null },
        { name: 'Sal', quantity: '1', unit: 'pizca', quantityNote: null },
      ],
    };
    const result = parse(input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    expect(result.value.structuredIngredients).toMatchObject([
      { quantity: 0.25, unit: 'kg', structured: true },
      { quantity: 2, unit: null, structured: false },
      { quantity: 1, unit: 'pizca', structured: false },
    ]);
  });

  it('leaves quantities absent in the source unknown and explicitly displays them', () => {
    const input = candidate();
    const result = parse({
      ...input,
      ingredients: input.ingredients.map((ingredient) => ({
        ...ingredient, quantity: null, unit: null, quantityNote: null,
      })),
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    expect(result.value.recipe).toContain('- cantidad no especificada Arroz');
    expect(result.value.structuredIngredients.every((item) => item.quantity === null && !item.structured)).toBe(true);
  });

  it('rejects malformed JSON, Markdown, additional fields and missing data', () => {
    expect(parseGeneratedRecipeResponse('INGREDIENTES\n- Arroz', 4)).toEqual({ success: false, reason: 'invalid_json' });
    expect(parseGeneratedRecipeResponse('x'.repeat(100_001), 4)).toEqual({ success: false, reason: 'response_too_large' });
    expect(parse({ ...candidate(), sources: ['Libro inventado'] })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse({ ...candidate(), ingredients: [] })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse({ ...candidate(), steps: [] })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse({ ...candidate(), title: ' ' })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse({ ...candidate(), title: 'Arroz\nINGREDIENTES' })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse(candidate(), 2)).toEqual({ success: false, reason: 'servings_mismatch' });
    expect(parse({ ...candidate(), servings: 101 }, 101)).toEqual({ success: false, reason: 'invalid_recipe_shape' });
  });

  it.each(['0', '-2', '1/0', 'dos', '2 kg', '1e3', '1-2'])('rejects a nonpositive or nonexact numeric amount: %s', (quantity) => {
    const input = candidate();
    expect(parse({ ...input, ingredients: [{ ...input.ingredients[0], quantity }, ...input.ingredients.slice(1)] })).toEqual({
      success: false, reason: 'invalid_ingredient',
    });
  });

  it.each([
    ['Cocinar {{1}}, {{2}}, {{3}} y {{4}}.'],
    ['Cocinar {{1}}, {{2}}, {{3}} y {{0}}.'],
    ['Cocinar {{1}}, {{2}}, {{3}} y {{01}}.'],
    ['Cocinar {{1}}, {{2}}, {{3}} y {{abc}}.'],
    ['Cocinar {{1}}, {{2}}, {{3}} y {{4}.'],
  ])('rejects out-of-range and malformed ingredient references', (...steps) => {
    expect(parse({ ...candidate(), steps })).toEqual({ success: false, reason: 'invalid_ingredient_references' });
  });

  it('rejects hidden multiline ingredient text and malformed references in names and tips', () => {
    const input = candidate();
    expect(parse({ ...input, ingredients: [{ ...input.ingredients[0], name: 'Arroz\nPREPARACIÓN' }, ...input.ingredients.slice(1)] })).toEqual({
      success: false, reason: 'invalid_recipe_shape',
    });
    expect(parse({ ...input, ingredients: [{ ...input.ingredients[0], name: 'Arroz {{2}}' }, ...input.ingredients.slice(1)] })).toEqual({
      success: false, reason: 'invalid_ingredient',
    });
    expect(parse({ ...input, tips: ['Agregar {{4}}'] })).toEqual({ success: false, reason: 'invalid_ingredient_references' });
  });

  it('preserves distinct ingredient rows instead of combining amounts or preparations', () => {
    const input = candidate();
    const result = parse({
      ...input,
      ingredients: [
        { name: 'Tomate', quantity: '1', unit: 'unidad', quantityNote: null },
        { name: 'Tomate', quantity: '2', unit: 'unidad', quantityNote: null },
        input.ingredients[2],
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    expect(result.value.structuredIngredients.map((item) => item.quantity)).toEqual([1, 2, null]);
  });

  it('bounds the final text independently of the provider shape', () => {
    const step = '{{1}} {{2}} {{3}} ' + 'a'.repeat(970);
    expect(parse({ ...candidate(), steps: Array.from({ length: 25 }, () => step) })).toEqual({
      success: false, reason: 'recipe_too_large',
    });
  });

  it('instructs Gemini to use Spanish, exact quantities, references and the requested portions', () => {
    expect(buildGeneratedRecipeInstructions(6)).toContain('servings debe ser 6');
    expect(buildGeneratedRecipeInstructions(6)).toContain('en español');
    expect(buildGeneratedRecipeInstructions(6)).toContain('{{1}}');
    expect(buildGeneratedRecipeInstructions(6)).toContain('quantity: null');
    expect(buildGeneratedRecipeInstructions(6)).toContain('usa agua en vez de caldo');
    expect(buildGeneratedRecipeInstructions(6)).toContain('composición incierta');
    expect(generatedRecipeResponseJsonSchema.required).toEqual(['outcome', 'title', 'servings', 'ingredients', 'steps']);
    expect(generatedRecipeResponseJsonSchema.properties).not.toHaveProperty('tips');
    expect(generatedRecipeResponseJsonSchema.properties.ingredients.items.properties.quantity.type).toEqual(['string', 'null']);
  });
  it('preserves a source fraction and tiny decimal through direct and history import into exact inventory requirements', () => {
    const input = candidate();
    input.ingredients[1] = { name: 'Tomate', quantity: '0.0000001', unit: 'kg', quantityNote: null };
    const result = parse(input);
    if (!result.success) throw new Error(result.reason);
    const value = result.value;
    expect(value.structuredIngredients[1]).toMatchObject({ quantity: 0.0000001, exact_quantity_text: '0.0000001', structured: true });
    const id = 'f1e2d3c4-a5b6-47c8-9012-3456789abcde';
    const imported = buildRecipeImportPayload({
      title: value.title, instructions: value.recipe, preparation: value.preparation, servings: value.servings,
      structuredIngredients: value.structuredIngredients, recipeHistoryId: id,
    });
    const recovered = buildRecipeImportFromHistory({ id, title: value.title, payload: {
      title: value.title, full_recipe: value.recipe, preparation: value.preparation, peopleCount: value.servings,
      structuredIngredients: JSON.parse(JSON.stringify(value.structuredIngredients)) as unknown,
    } });
    expect(recovered).toEqual(imported);
    expect(imported.instructions).not.toContain('INGREDIENTES');
    expect(imported.instructions).toContain('TIPS');
    expect(imported.ingredients).toEqual([
      { name: 'Arroz', quantity: '1/3', unit: 'taza' },
      { name: 'Tomate', quantity: '0.0000001', unit: 'kg' },
      { name: 'Sal', quantity: 'al gusto', unit: null },
    ]);
    expect(CreatePersistentRecipeSchema.safeParse(imported).success).toBe(true);
    const persistedRequirements = extractRecipeRequirements(imported.ingredients);
    const warmupRequirements = extractRecipeRequirements({ structured_ingredients: value.structuredIngredients });
    expect(warmupRequirements).toEqual(persistedRequirements);
    expect(persistedRequirements[0].exactQuantityBasis).toEqual({ numerator: '1', denominator: '3' });
    expect(persistedRequirements[1].requiredQuantity).toBe(0.0000001);
    const exact = readQuantityBasis(persistedRequirements[0].requiredQuantity, persistedRequirements[0].exactQuantityBasis);
    expect(exact && exactQuantityText(exact)).toBe('1/3');
    expect(persistedRequirements[2].requiredQuantity).toBeNull();
  });

  it('rejects contradictory exact evidence at import and warmup boundaries', () => {
    expect(recipeAmountForImport(2, '1/3')).toBeNull();
    expect(recipeAmountForImport(null, 'al gusto')).toBeNull();
    expect(recipeAmountForImport(null, '1/3', 'al gusto')).toBeNull();
    expect(recipeAmountForImport(0.0000001)).toBe('0.0000001');
    const result = parse(candidate());
    if (!result.success) throw new Error(result.reason);
    const ingredients = result.value.structuredIngredients;
    const meal = {
      name: 'Arroz', time: '15 min', difficulty: 'Fácil', badge: '', fusionTag: '', missing: 0, aiScore: 1,
      structured_ingredients: ingredients,
    };
    const warmup = {
      calendar: [{ day: 'Lunes', meals: { Desayuno: meal, Almuerzo: meal, Cena: meal } }],
      targetDays: ['Lunes'], inventory: [], baseCuisine: 'Latinoamericana', fusionCuisines: [], peopleCount: 4, culinaryProfile: {},
    };
    expect(MealPlanWarmupSchema.safeParse(warmup).success).toBe(true);
    const invalid = { ...ingredients[0], quantity: 2 };
    const badMeal = { ...meal, structured_ingredients: [invalid] };
    expect(MealPlanWarmupSchema.safeParse({
      ...warmup, calendar: [{ day: 'Lunes', meals: { Desayuno: badMeal, Almuerzo: meal, Cena: meal } }],
    }).success).toBe(false);
    expect(extractRecipeRequirements([invalid])[0].requiredQuantity).toBeNull();
    const unsupportedUnit = { ...ingredients[0], unit: 'pizca' };
    expect(extractRecipeRequirements([unsupportedUnit])[0].requiredQuantity).toBeNull();
  });

  it('marks structurally valid free prose as a proposal even when semantic completeness is uncertain', () => {
    const input = candidate();
    const result = parse({ ...input, steps: [...input.steps, 'Mezclar {{1}} con dos huevos.'] });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    expect(result.value.recipeReviewRequired).toBe(true);
    expect(result.value.recipe).toContain('dos huevos');
    expect(result.value.structuredIngredients.map((item) => item.normalized_name)).not.toContain('huevo');
  });

  it.each(['2', '2 g', '1/3', 'Sal'])('rejects a numeric or duplicated-name quantity note: %s', (quantityNote) => {
    const input = candidate();
    expect(parse({ ...input, ingredients: [...input.ingredients.slice(0, 2), { ...input.ingredients[2], quantityNote }] })).toEqual({
      success: false, reason: 'invalid_ingredient',
    });
  });

  it('accepts an explicit no-proposal outcome but never renders or persists a fictitious recipe', () => {
    const unavailable = {
      outcome: 'unavailable', title: 'Sin propuesta compatible', servings: 4,
      ingredients: [], steps: [], tips: [],
    };
    expect(parse(unavailable)).toEqual({ success: false, reason: 'no_compatible_recipe' });
    expect(parse({ ...unavailable, ingredients: candidate().ingredients })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse({ ...unavailable, steps: ['Cocinar.'] })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse({ ...unavailable, tips: ['Probar otro ingrediente.'] })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(parse({ ...candidate(), outcome: undefined })).toEqual({ success: false, reason: 'invalid_recipe_shape' });
    expect(buildGeneratedRecipeInstructions(4)).toContain('Las restricciones obligatorias prevalecen');
  });

});
