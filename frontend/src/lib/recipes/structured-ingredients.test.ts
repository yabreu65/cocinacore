import { describe, expect, it } from 'vitest';
import {
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
