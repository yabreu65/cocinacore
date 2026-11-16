import { describe, expect, it } from 'vitest';
import { rankOneSlotOptions, TODAY_SLOT_VALUES, type TodaySlot } from './one-slot';

const asOf = '2025-04-10';

type Candidate = {
  title: string;
  slot: TodaySlot;
  ingredients?: string[];
  prepMinutes: number | null;
  source?: 'provider' | 'history' | 'saved_plan';
};

function context(overrides: Record<string, unknown> = {}) {
  return {
    asOf,
    slot: 'lunch' as TodaySlot,
    maxPrepMinutes: 30,
    allergies: [] as string[],
    hardAvoid: [] as string[],
    dislikedIngredients: [] as string[],
    recentTitles: [] as string[],
    inventory: [] as { name: string; expiresOn?: string }[],
    ...overrides,
  };
}

function candidates(count: number, overrides: Partial<Candidate> = {}): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `Meal ${index + 1}`,
    slot: 'lunch',
    ingredients: ['rice', 'tomato'],
    prepMinutes: 20,
    ...overrides,
  }));
}

describe('rankOneSlotOptions', () => {
  it('exports the strict shared runtime slot tuple including snack', () => {
    expect(TODAY_SLOT_VALUES).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
  });
  it.each(['breakfast', 'lunch', 'snack', 'dinner'] as const)(
    'accepts the %s slot',
    (slot) => {
      const result = rankOneSlotOptions(candidates(3, { slot }), context({ slot }));
      expect(result.status).toBe('success');
      expect(result.options).toHaveLength(3);
      expect(result.options.every((option) => option.slot === slot)).toBe(true);
    }
  );

  it('accepts the persisted profile maximum and rejects values above it', () => {
    expect(rankOneSlotOptions(candidates(3), context({ maxPrepMinutes: 240 })).status).toBe('success');
    expect(rankOneSlotOptions(candidates(3), context({ maxPrepMinutes: 241 })).status).toBe('invalid');
  });

  it('rejects invalid slots and out-of-bounds or malformed context', () => {
    expect(rankOneSlotOptions(candidates(3), context({ slot: 'brunch' })).status).toBe('invalid');
    expect(rankOneSlotOptions(candidates(3), context({ maxPrepMinutes: 0 })).status).toBe('invalid');
    expect(rankOneSlotOptions(candidates(3), context({ asOf: '2025-02-30' })).status).toBe('invalid');
    expect(rankOneSlotOptions(candidates(3), context({ allergies: [''] })).status).toBe('invalid');
    expect(rankOneSlotOptions(candidates(3), context({ hardAvoid: [null] })).status).toBe('invalid');
  });

  it('hard-rejects allergy and hard-avoid matches including aliases', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Unsafe allergy', ingredients: ['peanut butter'] },
      { ...candidates(1)[0], title: 'Unsafe avoid', ingredients: ['tomates frescos'] },
      ...candidates(3),
    ], context({ allergies: ['cacahuate'], hardAvoid: ['tomate'] }));
    expect(result.status).toBe('success');
    expect(result.options.map(({ title }) => title)).not.toContain('Unsafe allergy');
    expect(result.options.map(({ title }) => title)).not.toContain('Unsafe avoid');
  });

  it('fails closed on missing or unparseable ingredients when hard restrictions are active', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Missing', ingredients: undefined },
      { ...candidates(1)[0], title: 'Unparseable', ingredients: [''] },
      ...candidates(2),
    ], context({ allergies: ['peanut'] }));
    expect(result.status).toBe('degraded');
    expect(result.options.map(({ title }) => title)).toEqual(['Meal 1', 'Meal 2']);
  });

  it('does not reject ingredient-name false-positive boundaries', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Boundary', ingredients: ['manitas'] },
      ...candidates(2),
    ], context({ allergies: ['maní'] }));
    expect(result.options.map(({ title }) => title)).toContain('Boundary');
  });

  it('ranks soon-expiring inventory matches first, ignoring already-expired inventory', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Expired match', ingredients: ['expired'] },
      { ...candidates(1)[0], title: 'Later match', ingredients: ['later'] },
      { ...candidates(1)[0], title: 'Soon match', ingredients: ['soon'] },
    ], context({ inventory: [
      { name: 'expired', expiresOn: '2025-04-09' },
      { name: 'later', expiresOn: '2025-04-20' },
      { name: 'soon', expiresOn: '2025-04-11' },
    ] }));
    expect(result.options.map(({ title }) => title)).toEqual(['Soon match', 'Later match', 'Expired match']);
  });

  it('does not treat a partial inventory name as an expiring ingredient match', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Stable option', ingredients: ['onion'] },
      { ...candidates(1)[0], title: 'Rice vinegar', ingredients: ['rice vinegar'] },
    ], context({ inventory: [{ name: 'rice', expiresOn: '2025-04-11' }] }));
    expect(result.options.map(({ title }) => title)).toEqual(['Stable option', 'Rice vinegar']);
  });

  it('matches normalized plural inventory ingredient names exactly', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Tomate match', ingredients: ['tomate'] },
      { ...candidates(1)[0], title: 'Stable option', ingredients: ['onion'] },
    ], context({ inventory: [{ name: 'tomates', expiresOn: '2025-04-11' }] }));
    expect(result.options.map(({ title }) => title)).toEqual(['Tomate match', 'Stable option']);
  });

  it('ranks better available-ingredient fit ahead of weaker fit', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'One fit', ingredients: ['rice', 'onion'] },
      { ...candidates(1)[0], title: 'Two fit', ingredients: ['rice', 'tomato'] },
    ], context({ inventory: [{ name: 'rice' }, { name: 'tomato' }] }));
    expect(result.options.map(({ title }) => title)).toEqual(['Two fit', 'One fit']);
  });

  it('ranks feasible prep time first', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Too long', prepMinutes: 40 },
      { ...candidates(1)[0], title: 'Feasible', prepMinutes: 20 },
    ], context({ maxPrepMinutes: 25 }));
    expect(result.options.map(({ title }) => title)).toEqual(['Feasible', 'Too long']);
  });

  it('rejects unknown prep time without an explicit local source and accepts it for history', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Missing source', prepMinutes: null },
      { ...candidates(1)[0], title: 'Provider source', prepMinutes: null, source: 'provider' },
      { ...candidates(1)[0], title: 'Invalid source', prepMinutes: null, source: 'other' },
      { ...candidates(1)[0], title: 'History source', prepMinutes: null, source: 'history' },
      { ...candidates(1)[0], title: 'Saved plan source', prepMinutes: null, source: 'saved_plan' },
      { ...candidates(1)[0], title: 'Saved recipe source', prepMinutes: null, source: 'saved_recipe' },
      { ...candidates(1)[0], title: 'Numeric provider', prepMinutes: 20 },
    ], context());
    expect(result.options.map(({ title, source }) => ({ title, source }))).toEqual([
      { title: 'Numeric provider', source: 'provider' },
      { title: 'History source', source: 'history' },
      { title: 'Saved plan source', source: 'saved_plan' },
      { title: 'Saved recipe source', source: 'saved_recipe' },
    ]);
  });

  it('rejects options with missing prepMinutes', () => {
    const missingPrep = { title: 'Meal 1', slot: 'lunch' as const, ingredients: ['rice', 'tomato'] };
    const result = rankOneSlotOptions([missingPrep, ...candidates(2)], context());
    expect(result.options.map(({ title }) => title)).toEqual(['Meal 1', 'Meal 2']);
  });

  it('ranks known feasible before unknown and known-infeasible regardless of inventory fit', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Unknown', ingredients: ['tomato', 'onion'], prepMinutes: null, source: 'history' },
      { ...candidates(1)[0], title: 'Known infeasible', ingredients: ['milk', 'spinach'], prepMinutes: 40 },
      { ...candidates(1)[0], title: 'Known feasible', ingredients: ['rice'], prepMinutes: 20 },
    ], context({ maxPrepMinutes: 25, inventory: [
      { name: 'milk', expiresOn: '2025-04-10' },
      { name: 'spinach', expiresOn: '2025-04-11' },
      { name: 'tomato', expiresOn: '2025-04-12' },
      { name: 'onion', expiresOn: '2025-04-13' },
      { name: 'rice', expiresOn: '2025-04-20' },
    ] }));
    expect(result.options.map(({ title, prepMinutes }) => ({ title, prepMinutes }))).toEqual([
      { title: 'Known feasible', prepMinutes: 20 },
      { title: 'Unknown', prepMinutes: null },
      { title: 'Known infeasible', prepMinutes: 40 },
    ]);
  });

  it('penalizes disliked ingredients and recent-title repeats without excluding repeats', () => {
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Recent', ingredients: ['rice'] },
      { ...candidates(1)[0], title: 'Disliked', ingredients: ['onion'] },
      { ...candidates(1)[0], title: 'Fresh', ingredients: ['rice'] },
    ], context({ dislikedIngredients: ['onion'], recentTitles: ['recent'] }));
    expect(result.options.map(({ title }) => title)).toEqual(['Fresh', 'Recent', 'Disliked']);
    expect(result.options.map(({ title }) => title)).toContain('Recent');
  });

  it('preserves stable input order for exact ties', () => {
    const result = rankOneSlotOptions(candidates(3), context());
    expect(result.options.map(({ title }) => title)).toEqual(['Meal 1', 'Meal 2', 'Meal 3']);
  });

  it('returns success only with 3–5 options', () => {
    expect(rankOneSlotOptions(candidates(3), context()).status).toBe('success');
    expect(rankOneSlotOptions(candidates(5), context()).status).toBe('success');
    expect(rankOneSlotOptions(candidates(6), context()).options).toHaveLength(5);
  });

  it('truthfully degrades with only zero to two safe options and never fabricates choices', () => {
    const zero = rankOneSlotOptions([], context());
    const two = rankOneSlotOptions(candidates(2), context());
    expect(zero).toMatchObject({ status: 'degraded', reason: 'fewer-than-three-safe-options', options: [] });
    expect(two).toMatchObject({ status: 'degraded', reason: 'fewer-than-three-safe-options' });
    expect(two.options.map(({ title }) => title)).toEqual(['Meal 1', 'Meal 2']);
  });
  it('keeps legacy restrictions through ranking and checks the provider title', () => {
    const hardAvoid = [...Array.from({ length: 20 }, (_, i) => 'excluded ' + i), 'tomato', 'x'.repeat(160)];
    const result = rankOneSlotOptions([
      { ...candidates(1)[0], title: 'Tomato rice', ingredients: ['rice'] },
      { ...candidates(1)[0], title: 'Rice', ingredients: ['rice'] },
    ], context({ hardAvoid }));
    expect(result.options.map(({ title }) => title)).toEqual(['Rice']);
  });

  it.each([81, 120])('accepts a recent history title of %s characters without invalidating ranking', (length) => {
    const title = 'x'.repeat(length);
    const options = [...candidates(3), { ...candidates(1)[0], title }];
    expect(rankOneSlotOptions(options, context({ recentTitles: [title] })).status).toBe('success');
  });
  it('does not extend the bounds of other ranking fields or accept overlong history titles', () => {
    expect(rankOneSlotOptions(candidates(3), context({ recentTitles: ['x'.repeat(121)] })).status).toBe('invalid');
    expect(rankOneSlotOptions(candidates(3), context({ dislikedIngredients: ['x'.repeat(81)] })).status).toBe('invalid');
  });

});
