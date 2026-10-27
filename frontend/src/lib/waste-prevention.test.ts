import { describe, expect, it } from 'vitest';
import {
  buildWastePreventionReport,
  classifyWasteExpiration,
  type WastePreventionInput,
} from './waste-prevention';

const baseInput: WastePreventionInput = {
  inventoryItems: [],
  recipes: [],
  culinaryProfileConfigured: true,
  allergies: [],
  hardAvoid: [],
  dislikedIngredients: [],
  now: '2026-10-26',
  timeZone: 'UTC',
  windowDays: 3,
};

function lot(overrides: Partial<WastePreventionInput['inventoryItems'][number]> = {}) {
  return {
    id: 'lot-1',
    ingredient_name: 'Tomato',
    quantity: '2',
    unit: 'unidad',
    expiration_date: '2026-10-27',
    ...overrides,
  };
}

function recipe(overrides: Partial<WastePreventionInput['recipes'][number]> = {}) {
  return {
    id: 'recipe-1',
    title: 'Tomato rice',
    ingredients: [
      { name: 'Tomato', quantity: '1', unit: 'unidad' },
      { name: 'Rice', quantity: '1', unit: 'kg' },
    ],
    ...overrides,
  };
}

describe('classifyWasteExpiration', () => {
  it.each([
    ['2026-10-25', 'expired', -1],
    ['2026-10-26', 'due_today', 0],
    ['2026-10-27', 'due_soon', 1],
    ['2026-11-01', 'later', 6],
  ] as const)('classifies %s as %s', (expirationDate, status, daysRemaining) => {
    expect(classifyWasteExpiration(expirationDate, '2026-10-26', 'UTC', 3)).toMatchObject({
      status,
      calendarDate: expirationDate,
      daysRemaining,
    });
  });

  it('keeps missing and invalid dates unknown', () => {
    expect(classifyWasteExpiration(null, '2026-10-26', 'UTC')).toMatchObject({
      status: 'unknown',
      reason: 'missing_expiration_date',
    });
    expect(classifyWasteExpiration('2026-02-30', '2026-10-26', 'UTC')).toMatchObject({
      status: 'unknown',
      reason: 'invalid_expiration_date',
    });
  });

  it('classifies timestamps by calendar date in the requested IANA timezone', () => {
    expect(
      classifyWasteExpiration('2026-10-27 00:30:00+00', '2026-10-26', 'America/Caracas', 3)
    ).toMatchObject({ status: 'due_today', calendarDate: '2026-10-26' });
    expect(
      classifyWasteExpiration('2026-10-27T00:30:00.000Z', '2026-10-26', 'America/Caracas', 3)
    ).toMatchObject({ status: 'due_today', calendarDate: '2026-10-26' });
    expect(
      classifyWasteExpiration('2026-10-27T00:00:00.000Z', '2026-10-26', 'America/Caracas', 3)
    ).toMatchObject({ status: 'due_soon', calendarDate: '2026-10-27', daysRemaining: 1 });
    expect(
      classifyWasteExpiration('2026-10-27 00:00:00+00', '2026-10-26', 'America/Caracas', 3)
    ).toMatchObject({ status: 'due_soon', calendarDate: '2026-10-27', daysRemaining: 1 });
  });

  it('fails closed for invalid timezone or now values', () => {
    expect(classifyWasteExpiration('2026-10-27', '2026-10-26', 'Not/AZone')).toMatchObject({
      status: 'unknown',
      reason: 'invalid_time_zone',
    });
    expect(classifyWasteExpiration('2026-10-27', 'not-a-date', 'UTC')).toMatchObject({
      status: 'unknown',
      reason: 'invalid_now',
    });
  });
});

describe('buildWastePreventionReport', () => {
  it('keeps separate lots and preserves unknown dates and quantities', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [
        lot({ id: 'lot-b', expiration_date: null, quantity: null }),
        lot({ id: 'lot-a', expiration_date: '2026-10-25', quantity: '2' }),
      ],
    });

    expect(report.lots).toHaveLength(2);
    expect(report.lots.map(({ lotId }) => lotId)).toEqual(['lot-a', 'lot-b']);
    expect(report.lots[0]).toMatchObject({ status: 'expired', quantityStatus: 'known' });
    expect(report.lots[1]).toMatchObject({
      status: 'unknown',
      reason: 'missing_expiration_date',
      quantityStatus: 'unknown',
      parsedQuantity: null,
    });
    expect(report.lots[0]).not.toHaveProperty('tenantId');
    expect(Object.keys(report.suggestions[0] ?? {})).not.toContain('userId');
  });

  it('does not infer a count unit when a quantity has no explicit unit', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [lot({ quantity: '2', unit: null })],
      recipes: [recipe({ ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }] })],
    });

    expect(report.lots[0]).toMatchObject({ quantityStatus: 'unknown', parsedQuantity: null });
    expect(report.suggestions[0]).toMatchObject({ coverage: 'unknown' });
    expect(report.suggestions[0]?.ingredients[0]).toMatchObject({ status: 'unknown' });
  });

  it('accepts a Date as now and resolves its calendar date in the requested timezone', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      timeZone: 'America/Caracas',
      now: new Date('2026-10-26T03:30:00.000Z'),
      inventoryItems: [lot({ expiration_date: '2026-10-27' })],
    });
    expect(report).toMatchObject({ status: 'ready', asOfDate: '2026-10-25' });
  });

  it('returns no suggestions with no recipes, no inventory, or no configured profile', () => {
    expect(buildWastePreventionReport(baseInput).suggestions).toEqual([]);
    expect(
      buildWastePreventionReport({
        ...baseInput,
        recipes: [recipe()],
      }).suggestions
    ).toEqual([]);

    const report = buildWastePreventionReport({
      ...baseInput,
      culinaryProfileConfigured: false,
      inventoryItems: [lot({ ingredient_name: 'Tomato' })],
      recipes: [recipe({ ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }] })],
    });
    expect(report.suggestions).toEqual([]);

    const configuredReport = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [lot({ ingredient_name: 'Tomato' })],
      recipes: [recipe({ ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }] })],
    });
    expect(configuredReport.suggestions[0]).toMatchObject({
      recipeId: 'recipe-1',
      coverage: 'full',
    });
  });

  it('excludes recipes conflicting with allergies or hard avoids', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [lot({ ingredient_name: 'Peanut', quantity: '1', unit: 'kg' })],
      recipes: [
        recipe({
          id: 'allergy',
          ingredients: [{ name: 'Peanut', quantity: '1', unit: 'kg' }],
        }),
        recipe({
          id: 'hard-avoid',
          ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }],
        }),
        recipe({
          id: 'disliked',
          ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }],
        }),
      ],
      allergies: ['peanut'],
      hardAvoid: ['tomato'],
      dislikedIngredients: ['rice'],
    });
    expect(report.suggestions).toEqual([]);
  });

  it('keeps disliked ingredients as a lower-priority preference instead of a safety block', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [
        lot({ id: 'tomato', ingredient_name: 'Tomato' }),
        lot({ id: 'onion', ingredient_name: 'Onion' }),
      ],
      recipes: [
        recipe({
          id: 'disliked',
          title: 'Tomato meal',
          ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }],
        }),
        recipe({
          id: 'preferred',
          title: 'Onion meal',
          ingredients: [{ name: 'Onion', quantity: '1', unit: 'unidad' }],
        }),
      ],
      dislikedIngredients: ['tomato'],
    });

    expect(report.suggestions.map(({ recipeId }) => recipeId)).toEqual(['preferred', 'disliked']);
    expect(report.suggestions[1]).toMatchObject({ dislikedIngredientCount: 1 });
  });

  it('suggests compatible recipes with full and partial coverage', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [
        lot(),
        lot({ id: 'rice', ingredient_name: 'Rice', quantity: '1', unit: 'kg' }),
      ],
      recipes: [
        recipe(),
        recipe({
          id: 'partial',
          title: 'Partial tomato meal',
          ingredients: [
            { name: 'Tomato', quantity: '1', unit: 'unidad' },
            { name: 'Onion', quantity: '1', unit: 'unidad' },
          ],
        }),
      ],
    });

    expect(report.suggestions.map(({ recipeId }) => recipeId)).toEqual(['recipe-1', 'partial']);
    expect(report.suggestions[0]?.coverage).toBe('full');
    expect(report.suggestions[1]?.coverage).toBe('partial');
    expect(report.suggestions[1]?.ingredients[1]).toMatchObject({ status: 'missing' });
  });

  it('uses existing quantity helpers for compatible and incompatible units', () => {
    const compatible = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [lot({ quantity: '1', unit: 'kg' })],
      recipes: [
        recipe({
          ingredients: [{ name: 'Tomato', quantity: '500', unit: 'g' }],
        }),
      ],
    });
    expect(compatible.suggestions[0]).toMatchObject({
      coverage: 'full',
      ingredients: [{ status: 'sufficient', availableQuantity: 1000, availableUnit: 'g' }],
    });

    const incompatible = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [lot({ quantity: '2', unit: 'kg' })],
      recipes: [
        recipe({
          ingredients: [{ name: 'Tomato', quantity: '1', unit: 'l' }],
        }),
      ],
    });
    expect(incompatible.suggestions[0]).toMatchObject({
      coverage: 'unknown',
      ingredients: [{ status: 'unknown', availableQuantity: null }],
    });
  });

  it('keeps unknown quantities unknown instead of assuming zero or sufficient stock', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [lot({ quantity: null })],
      recipes: [recipe({ ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }] })],
    });
    expect(report.suggestions[0]).toMatchObject({ coverage: 'unknown' });
    expect(report.suggestions[0]?.ingredients[0]).toMatchObject({
      status: 'unknown',
      availableQuantity: null,
    });
  });

  it('does not suggest a recipe when a required ingredient exists only in expired lots', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [
        lot({ id: 'expired-tomato', expiration_date: '2026-10-25' }),
        lot({ id: 'rice', ingredient_name: 'Rice', quantity: '1', unit: 'kg' }),
      ],
      recipes: [recipe()],
    });
    expect(report.suggestions).toEqual([]);
  });

  it('requires at least one due-today or due-soon matched lot', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [
        lot({ id: 'later', expiration_date: '2026-11-10' }),
        lot({ id: 'unknown', expiration_date: null }),
      ],
      recipes: [
        recipe({
          id: 'later-only',
          ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }],
        }),
        recipe({
          id: 'unknown-only',
          ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }],
        }),
      ],
    });

    expect(report.suggestions).toEqual([]);
  });

  it('ranks suggestions by earliest upcoming lot and then coverage', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      inventoryItems: [
        lot({ id: 'tomorrow', expiration_date: '2026-10-27' }),
        lot({
          id: 'later-rice',
          ingredient_name: 'Rice',
          quantity: '1',
          unit: 'kg',
          expiration_date: '2026-11-05',
        }),
        lot({
          id: 'today-onion',
          ingredient_name: 'Onion',
          quantity: '1',
          unit: 'unidad',
          expiration_date: '2026-10-26',
        }),
      ],
      recipes: [
        recipe({
          id: 'later',
          title: 'Later meal',
          ingredients: [{ name: 'Tomato', quantity: '1', unit: 'unidad' }],
        }),
        recipe({
          id: 'today',
          title: 'Today meal',
          ingredients: [{ name: 'Onion', quantity: '1', unit: 'unidad' }],
        }),
      ],
    });

    expect(report.suggestions.map(({ recipeId }) => recipeId)).toEqual(['today', 'later']);
    expect(
      report.suggestions.map(({ earliestUpcomingLotDate }) => earliestUpcomingLotDate)
    ).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('is deterministic regardless of input row order', () => {
    const input: WastePreventionInput = {
      ...baseInput,
      inventoryItems: [
        lot({ id: 'b', ingredient_name: 'Tomato', expiration_date: '2026-10-27' }),
        lot({ id: 'a', ingredient_name: 'Tomato', expiration_date: '2026-10-26' }),
      ],
      recipes: [recipe({ id: 'b-recipe', title: 'B' }), recipe({ id: 'a-recipe', title: 'A' })],
    };
    const reversed = {
      ...input,
      inventoryItems: [...input.inventoryItems].reverse(),
      recipes: [...input.recipes].reverse(),
    };

    expect(buildWastePreventionReport(input)).toEqual(buildWastePreventionReport(reversed));
  });

  it('returns unknown report state and no suggestions for invalid calendar context', () => {
    const report = buildWastePreventionReport({
      ...baseInput,
      now: 'invalid',
      inventoryItems: [lot()],
      recipes: [recipe()],
    });
    expect(report).toMatchObject({ status: 'unknown', reason: 'invalid_now', suggestions: [] });
    expect(report.lots[0]?.status).toBe('unknown');
  });
});
