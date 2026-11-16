import { describe, expect, it } from 'vitest';
import {
  conflictAfter409,
  conflictAfterReload,
  conflictAfterReview,
  conversionConfirmationKey,
  isExactConversionConfirmed,
  matchingDuplicateNames,
  maySubmitConflict,
  metadataPatch,
  rebaseMetadata,
} from './inventory-editor';

describe('inventory editor conflict handling', () => {
  it('requires a successful reload and explicit review after every conflict', () => {
    expect(maySubmitConflict(conflictAfter409())).toBe(false);
    expect(conflictAfterReload(false)).toBe('reload-required');
    expect(maySubmitConflict(conflictAfterReload(false))).toBe(false);
    const review = conflictAfterReload(true);
    expect(maySubmitConflict(review)).toBe(false);
    const ready = conflictAfterReview(true);
    expect(maySubmitConflict(ready)).toBe(true);
    expect(maySubmitConflict(conflictAfter409())).toBe(false);
  });

  it('patches only changed metadata and rebases untouched fields onto latest values', () => {
    const baseline = { ingredientName: 'Rice', notes: 'old note', category: 'Granos' };
    const draft = { ingredientName: 'Brown rice', notes: 'old note', category: '' };
    expect(metadataPatch(baseline, draft, ['category', 'notes'])).toEqual({
      ingredientName: 'Brown rice',
      category: null,
    });
    expect(
      rebaseMetadata(baseline, draft, {
        ingredientName: 'Rice',
        notes: 'new concurrent note',
        category: 'Despensa',
      })
    ).toEqual({
      ingredientName: 'Brown rice',
      notes: 'new concurrent note',
      category: '',
    });
  });

  it('binds conversion confirmation to the exact current preview', () => {
    const preview = '1 kg → 1000 g';
    const confirmation = conversionConfirmationKey(preview);
    expect(isExactConversionConfirmed(preview, confirmation)).toBe(true);
    expect(isExactConversionConfirmed('2 kg → 2000 g', confirmation)).toBe(false);
    expect(isExactConversionConfirmed(preview, '')).toBe(false);
  });

  it('returns every matching duplicate lot for confirmation', () => {
    const rows = [
      { ingredient_name: 'Tomate' },
      { ingredient_name: 'Tomates' },
      { ingredient_name: 'Arroz' },
    ];
    const matches = matchingDuplicateNames(
      rows,
      ' TOMATE ',
      (value) => value.trim().toLowerCase(),
      (row) => row.ingredient_name
    );
    expect(matches.map((row) => row.ingredient_name)).toEqual(['Tomate']);
    expect(
      matchingDuplicateNames(
        rows,
        'Arroz',
        (value) => value.toLowerCase(),
        (row) => row.ingredient_name
      )
    ).toEqual([rows[2]]);
  });
});
