import { describe, expect, it } from 'vitest';
import {
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
