import { describe, expect, it } from 'vitest';
import {
  assessIngredientRestrictions,
  assessLocalIngredientRestrictions,
  containsRestrictedIngredientName,
  extractStructuredIngredients,
  mergeDuplicateIngredients,
  normalizeIngredientName,
  parseStructuredIngredient,
  validateStructuredIngredients,
} from './structured-ingredients';

describe('structured ingredients', () => {
  it('normalizes ingredient names with synonyms', () => {
    expect(normalizeIngredientName('Tomates')).toBe('tomate');
    expect(normalizeIngredientName('Jitomates')).toBe('tomate');
  });

  it('canonicalizes common peanut synonyms in both directions without partial-word collisions', () => {
    const synonyms = [
      ['maní', 'cacahuate'],
      ['cacahuate', 'peanuts'],
      ['cacahuates', 'groundnuts'],
      ['cacahuete', 'peanut'],
      ['cacahuetes', 'groundnut'],
      ['peanut', 'cacahuete'],
      ['peanuts', 'cacahuates'],
      ['groundnut', 'maní'],
      ['groundnuts', 'cacahuetes'],
    ];

    for (const [restriction, ingredient] of synonyms) {
      expect(containsRestrictedIngredientName([ingredient], [restriction])).toBe(true);
    }
    expect(containsRestrictedIngredientName(['peanut butter'], ['cacahuate'])).toBe(true);
    expect(normalizeIngredientName('Manís')).toBe('mani');
    expect(containsRestrictedIngredientName(['manís'], ['maní'])).toBe(true);
    expect(containsRestrictedIngredientName(['maní'], ['manís'])).toBe(true);
    expect(containsRestrictedIngredientName(['manis asados'], ['maní'])).toBe(true);
    expect(containsRestrictedIngredientName(['manis'], ['manitas'])).toBe(false);
    expect(containsRestrictedIngredientName(['peanutty flavor'], ['cacahuate'])).toBe(false);
    expect(containsRestrictedIngredientName(['sesame'], ['cacahuate'])).toBe(false);
  });

  it('matches canonical restricted ingredient names as whole token sequences', () => {
    expect(containsRestrictedIngredientName(['Queso LÁCTEO'], ['lacteo'])).toBe(true);
    expect(containsRestrictedIngredientName(['lácteos'], ['LACTEOS'])).toBe(true);
    expect(containsRestrictedIngredientName(['Tomates'], ['jitomates'])).toBe(true);
    expect(containsRestrictedIngredientName(['CEBOLLAS'], ['cebolla'])).toBe(true);
    expect(containsRestrictedIngredientName(['almendra'], ['almendras'])).toBe(true);
    expect(containsRestrictedIngredientName(['huevo'], ['huevos'])).toBe(true);
    expect(containsRestrictedIngredientName(['nuez'], ['nueces'])).toBe(true);
    expect(containsRestrictedIngredientName(['almendras'], ['almendra'])).toBe(true);
    expect(containsRestrictedIngredientName(['huevos'], ['huevo'])).toBe(true);
    expect(containsRestrictedIngredientName(['nueces'], ['nuez'])).toBe(true);
    expect(containsRestrictedIngredientName(['almendrado'], ['almendra'])).toBe(false);
    expect(containsRestrictedIngredientName(['chocolate'], ['late'])).toBe(false);
    expect(containsRestrictedIngredientName(['tomateado'], ['jitomates'])).toBe(false);
    expect(containsRestrictedIngredientName(['maní tostado'], ['maní'])).toBe(true);
    expect(containsRestrictedIngredientName(['ajos'], ['ajo'])).toBe(true);
  });

  it.each([
    ['Vegano', 'pollo'],
    ['Vegano', 'carne de res'],
    ['Vegano', 'carnes'],
    ['Vegano', 'pescado'],
    ['Vegano', 'dairy'],
    ['Vegano', 'lácteos'],
    ['Vegano', 'leche convencional'],
    ['Vegano', 'huevo'],
    ['Sin TACC', 'harina de trigo'],
    ['Sin TACC', 'cebada'],
    ['Sin TACC', 'centeno'],
    ['Sin TACC', 'malta de cebada'],
    ['Vegano', 'milk'],
    ['Vegano', 'jamón'],
    ['Sin TACC', 'gluten'],
    ['Sin lactosa', 'leche convencional'],
    ['Sin lactosa', 'leche condensada'],
    ['Sin lactosa', 'suero de leche'],
    ['Sin lactosa', 'lactosa'],
  ])('rejects %s when ingredient %s is incompatible', (restriction, ingredient) => {
    expect(containsRestrictedIngredientName([ingredient], [restriction])).toBe(true);
  });

  it.each([
    'trigo sarraceno con trigo',
    'malta de arroz con cebada',
  ])('does not let a gluten-free ingredient phrase hide %s', (ingredient) => {
    expect(assessIngredientRestrictions([ingredient], ['Sin TACC'])).toEqual({
      status: 'conflict',
    });
  });

  it('marks malt explicitly described as containing gluten as a conflict', () => {
    expect(assessIngredientRestrictions(['malta con gluten'], ['Sin TACC'])).toEqual({
      status: 'conflict',
    });
  });

  it('classifies plural eggs as a vegan conflict after ingredient normalization', () => {
    expect(assessIngredientRestrictions(['huevos'], ['Vegano'])).toEqual({
      status: 'conflict',
    });
  });

  it('rejects vital wheat gluten under Sin TACC', () => {
    expect(assessIngredientRestrictions(['vital wheat gluten'], ['Sin TACC'])).toEqual({
      status: 'conflict',
    });
  });

  it('rejects gluten vital under Sin TACC', () => {
    expect(assessIngredientRestrictions(['gluten vital'], ['Sin TACC'])).toEqual({
      status: 'conflict',
    });
  });

  it.each([
    ['arroz sin gluten', 'clear'],
    ['harina de maíz sin gluten', 'clear'],
    ['gluten-free pasta', 'review'],
    ['sin gluten', 'review'],
  ])('does not treat an explicit gluten-free qualifier as gluten content: %s', (ingredient, status) => {
    expect(assessIngredientRestrictions([ingredient], ['Sin TACC'])).toEqual({ status });
  });

  it('does not reject a recipe body solely because its title says gluten-free', () => {
    const recipe =
      'Arroz sin gluten\n\nINGREDIENTES\n- 1 taza arroz\n- 1 cucharada aceite de oliva\n\nPREPARACIÓN\nCocinar.';

    expect(assessIngredientRestrictions([recipe], ['Sin TACC'])).toEqual({ status: 'clear' });
  });

  it.each([
    'harina de trigo sin gluten',
    'sin gluten, pero contiene gluten',
    'gluten-free rice, con gluten vital',
    'no es sin gluten',
  ])('preserves a real gluten conflict despite a gluten-free qualifier: %s', (ingredient) => {
    expect(assessIngredientRestrictions([ingredient], ['Sin TACC'])).toEqual({ status: 'conflict' });
  });

  it('lets a conflicting ingredient override a separate gluten-free claim', () => {
    expect(assessIngredientRestrictions(['arroz sin gluten', 'harina de trigo'], ['Sin TACC'])).toEqual({
      status: 'conflict',
    });
  });

  it.each([
    ['Vegana', 'egg'],
    ['Sin gluten', 'barley'],
    ['Libre de gluten', 'rye'],
    ['Sin TACC', 'malta de cebada'],
    ['Lactose-free', 'milk'],
  ])('recognizes common dietary labels and ingredient terms: %s / %s', (restriction, ingredient) => {
    expect(containsRestrictedIngredientName([ingredient], [restriction])).toBe(true);
  });

  it.each([
    ['Vegano', 'leche de almendras con pollo'],
    ['Sin lactosa', 'leche de almendras con leche condensada'],
  ])('does not let a safe alternative hide conflicts for %s', (restriction, ingredient) => {
    expect(assessIngredientRestrictions([ingredient], [restriction])).toEqual({ status: 'conflict' });
  });

  it('preserves the meaning of bare legacy dietary labels', () => {
    expect(containsRestrictedIngredientName(['harina de trigo'], ['Gluten'])).toBe(true);
    expect(containsRestrictedIngredientName(['milk'], ['Lactosa'])).toBe(true);
  });

  it.each([
    ['Vegano', ['leche de almendras', 'harina de maíz', 'arroz']],
    ['Vegano', ['soy milk', 'leche de soya', 'arroz']],
    ['Sin TACC', ['harina de maíz', 'trigo sarraceno']],
    ['Sin lactosa', ['leche de almendras', 'arroz']],
  ])('does not reject explicit non-conflicting ingredients for %s', (restriction, ingredients) => {
    expect(assessIngredientRestrictions(ingredients, [restriction])).toEqual({ status: 'clear' });
  });

  it.each([
    ['Vegano', ['caldo']],
    ['Sin TACC', ['harina']],
    ['Sin TACC', ['malta']],
    ['Sin lactosa', ['queso']],
    ['Sin lactosa', ['lácteos']],
    ['Sin lactosa', ['crema']],
  ])('marks ambiguous ingredient names for %s as review-needed', (restriction, ingredients) => {
    expect(assessIngredientRestrictions(ingredients, [restriction])).toEqual({ status: 'review' });
    expect(containsRestrictedIngredientName(ingredients, [restriction])).toBe(true);
  });

  it('marks missing or blank category-restricted ingredient data as review-needed', () => {
    expect(assessIngredientRestrictions([], ['Sin TACC'])).toEqual({ status: 'review' });
    expect(assessIngredientRestrictions([''], ['Sin TACC'])).toEqual({ status: 'review' });
    expect(assessIngredientRestrictions(['   '], ['Vegano'])).toEqual({ status: 'review' });
    expect(assessIngredientRestrictions(['', 'pollo'], ['Vegano'])).toEqual({ status: 'conflict' });
  });

  it.each([
    ['Maní', 'cacahuate'], ['Frutos secos', 'almendras'], ['Leche', 'queso'],
    ['Huevo', 'mayonesa'], ['Pescado', 'atún'], ['Crustáceos', 'camarones'],
    ['Moluscos', 'mejillones'], ['Trigo', 'harina de trigo'], ['Soja', 'tofu'],
    ['Sésamo', 'tahini'], ['Mostaza', 'semillas de mostaza'], ['Apio', 'apio'],
  ])('blocks a representative conflict for selected %s (%s)', (restriction, ingredient) => {
    expect(assessIngredientRestrictions([ingredient], [restriction])).toEqual({ status: 'conflict' });
    expect(assessIngredientRestrictions(['arroz'], [restriction])).toEqual({ status: 'clear' });
  });

  it('keeps distinct allergy categories and does not confuse milk allergy with lactose intolerance', () => {
    expect(assessIngredientRestrictions(['maní'], ['Frutos secos'])).toEqual({ status: 'clear' });
    expect(assessIngredientRestrictions(['almendra'], ['Maní'])).toEqual({ status: 'clear' });
    expect(assessIngredientRestrictions(['leche sin lactosa'], ['Leche'])).toEqual({ status: 'conflict' });
    expect(assessIngredientRestrictions(['leche sin lactosa'], ['Sin lactosa'])).toEqual({ status: 'clear' });
  });

  it('requires review for unassessed local categories and custom descriptions, but never hides a conflict', () => {
    expect(assessLocalIngredientRestrictions(['arroz'], ['Frutos secos'])).toEqual({ status: 'review' });
    expect(assessLocalIngredientRestrictions(['queso'], ['Leche'])).toEqual({ status: 'conflict' });
    expect(assessLocalIngredientRestrictions(['arroz'], ['alergia a la proteína de la leche'])).toEqual({ status: 'review' });
    expect(assessLocalIngredientRestrictions(['arroz'], ['Maní'])).toEqual({ status: 'review' });
    expect(assessLocalIngredientRestrictions(['arroz'], ['Keto'])).toEqual({ status: 'review' });
    expect(assessLocalIngredientRestrictions(['arroz'], ['Bajo en sodio'])).toEqual({ status: 'review' });
    expect(assessLocalIngredientRestrictions(['arroz'], ['alergia al maní y nueces'])).toEqual({ status: 'review' });
    expect(assessLocalIngredientRestrictions(['arroz'], [])).toEqual({ status: 'clear' });
    expect(assessIngredientRestrictions([], ['Maní'])).toEqual({ status: 'review' });
  });

  it('parses structured amounts', () => {
    const parsed = parseStructuredIngredient('1/2 kg pollo');
    expect(parsed.structured).toBe(true);
    expect(parsed.quantity).toBe(0.5);
    expect(parsed.unit).toBe('kg');
    expect(parsed.normalized_name).toContain('pollo');
  });

  it('marks ambiguous amount as unstructured', () => {
    const parsed = parseStructuredIngredient('sal al gusto');
    expect(parsed.structured).toBe(false);
    expect(parsed.quantity).toBeNull();
  });

  it('extracts only ingredients section and merges duplicates', () => {
    const recipe = `[TITULO]\n\nINGREDIENTES\n- 2 tomate\n- 3 tomates\n- 500 g arroz\n\nPREPARACIÓN\n1. Mezclar`;
    const extracted = extractStructuredIngredients(recipe);
    const tomato = extracted.find((item) => item.normalized_name === 'tomate');
    expect(tomato?.quantity).toBe(5);
    expect(extracted.some((item) => item.normalized_name === 'arroz')).toBe(true);
  });

  it('validates structured payload shape', () => {
    const list = [parseStructuredIngredient('2 cebollas')];
    expect(validateStructuredIngredients(list)).toBe(true);
  });

  it('keeps unknown duplicates safely', () => {
    const merged = mergeDuplicateIngredients([
      parseStructuredIngredient('aceite para freír'),
      parseStructuredIngredient('aceite para freír'),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].structured).toBe(false);
  });
});
