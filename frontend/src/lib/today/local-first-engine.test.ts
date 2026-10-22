import { describe, expect, it } from 'vitest';
import { recommendLocalFirst, type LocalFirstCandidate, type LocalFirstInput } from './local-first-engine';

const baseCandidate = (overrides: Partial<LocalFirstCandidate> = {}): LocalFirstCandidate => ({
  id: 'recipe-1',
  title: 'Rice bowl',
  slot: 'lunch',
  ingredients: [{ name: 'rice', quantity: 1, unit: 'kg' }],
  prepMinutes: 20,
  servings: 2,
  source: 'saved_recipe',
  identity: { userId: 'user-1', tenantId: 'tenant-1' },
  ...overrides,
});

const baseInput = (overrides: Partial<LocalFirstInput> = {}): LocalFirstInput => ({
  asOf: '2026-10-22',
  slot: 'lunch',
  maxPrepMinutes: 30,
  userId: 'user-1',
  tenantId: 'tenant-1',
  allergies: [],
  hardAvoid: [],
  dislikedIngredients: [],
  preferred: [],
  recentTitles: [],
  inventory: [],
  candidates: [baseCandidate()],
  plannedMeals: [],
  providerStatus: 'unavailable',
  ...overrides,
});

describe('recommendLocalFirst', () => {
  it('keeps inventory absence and an empty inventory unknown rather than treating it as zero', () => {
    const result = recommendLocalFirst(baseInput({ inventory: [] }));
    expect(result.status).toBe('ready');
    expect(result.recommendations[0]).toMatchObject({
      availability: 'unknown',
      provenance: 'saved_recipe',
      uncertainty: { inventory: true },
    });
    expect(result.recommendations[0]?.reason).toContain('availability-unknown');
  });

  it.each([
    ['sufficient', '2'],
    ['partial', '0.5'],
    ['missing', '0'],
  ] as const)('classifies explicitly observed stock as %s', (availability, quantity) => {
    const result = recommendLocalFirst(baseInput({
      inventory: [{ ingredient_name: 'rice', quantity, unit: 'kg' }],
    }));
    expect(result.recommendations[0]?.availability).toBe(availability);
  });

  it('hard-excludes unsafe, wrong-slot, invalid, and exactly planned candidates', () => {
    const result = recommendLocalFirst(baseInput({
      allergies: ['peanut'],
      candidates: [
        baseCandidate({ id: 'unsafe', title: 'Peanut rice', ingredients: [{ name: 'peanut', quantity: 1, unit: 'kg' }] }),
        baseCandidate({ id: 'wrong-slot', slot: 'dinner' }),
        baseCandidate({ id: 'planned', title: 'Planned rice' }),
        baseCandidate({ id: 'safe', title: 'Safe rice' }),
      ],
      plannedMeals: [{ recipeId: 'planned', date: '2026-10-22', slot: 'lunch' }],
    }));
    expect(result.recommendations.map(({ id }) => id)).toEqual(['safe']);
  });

  it('does not exclude a recipe planned on another date or slot', () => {
    const result = recommendLocalFirst(baseInput({
      plannedMeals: [
        { recipeId: 'recipe-1', date: '2026-10-21', slot: 'lunch' },
        { recipeId: 'recipe-1', date: '2026-10-22', slot: 'dinner' },
      ],
    }));
    expect(result.recommendations.map(({ id }) => id)).toEqual(['recipe-1']);
  });

  it('ranks by availability before timing and preference, and is stable for exact ties', () => {
    const result = recommendLocalFirst(baseInput({
      preferred: ['rice'],
      inventory: [{ ingredient_name: 'rice', quantity: '2', unit: 'kg' }],
      candidates: [
        baseCandidate({ id: 'unknown', title: 'Unknown stock', ingredients: [{ name: 'beans', quantity: 1, unit: 'kg' }], prepMinutes: 10 }),
        baseCandidate({ id: 'slow', title: 'Slow rice', prepMinutes: 40 }),
        baseCandidate({ id: 'fast', title: 'Fast rice', prepMinutes: 15 }),
        baseCandidate({ id: 'tie', title: 'Tie rice', prepMinutes: 15 }),
      ],
    }));
    expect(result.recommendations.map(({ id }) => id)).toEqual(['fast', 'tie', 'slow', 'unknown']);
  });

  it('uses preferred ingredients and penalizes disliked or recent options without excluding them', () => {
    const result = recommendLocalFirst(baseInput({
      preferred: ['rice'],
      dislikedIngredients: ['chili'],
      recentTitles: ['Bean soup'],
      inventory: [
        { ingredient_name: 'rice', quantity: '2', unit: 'kg' },
        { ingredient_name: 'beans', quantity: '2', unit: 'kg' },
        { ingredient_name: 'chili', quantity: '2', unit: 'kg' },
      ],
      candidates: [
        baseCandidate({ id: 'recent', title: 'Bean soup', source: 'history', ingredients: [{ name: 'beans', quantity: 1, unit: 'kg' }] }),
        baseCandidate({ id: 'preferred', title: 'Rice dish', ingredients: [{ name: 'rice', quantity: 1, unit: 'kg' }] }),
        baseCandidate({ id: 'disliked', title: 'Chili dish', ingredients: [{ name: 'chili', quantity: 1, unit: 'kg' }] }),
      ],
    }));
    expect(result.recommendations.map(({ id }) => id)).toEqual(['preferred', 'recent', 'disliked']);
    expect(result.recommendations.find(({ id }) => id === 'preferred')?.reason).toContain('preferred-ingredient');
    expect(result.recommendations.find(({ id }) => id === 'recent')?.reason).toContain('recent-repeat');
    expect(result.recommendations.find(({ id }) => id === 'disliked')?.reason).toContain('disliked-ingredient');
  });

  it('uses saved and history candidates when the provider is unavailable', () => {
    const result = recommendLocalFirst(baseInput({
      providerStatus: 'unavailable',
      candidates: [
        baseCandidate({ id: 'history-1', title: 'Past soup', source: 'history', prepMinutes: null }),
        baseCandidate({ id: 'saved-1', title: 'Saved meal', source: 'saved_recipe', prepMinutes: null }),
      ],
    }));
    expect(result.status).toBe('ready');
    expect(result.recommendations.map(({ source }) => source)).toEqual(['saved_recipe', 'history']);
    expect(result.recommendations.every(({ uncertainty }) => uncertainty.prepTime)).toBe(true);
  });

  it('preserves stored portions and prep-time uncertainty without scaling ingredients', () => {
    const candidate = baseCandidate({ servings: 4, prepMinutes: null });
    const result = recommendLocalFirst(baseInput({ candidates: [candidate], maxPrepMinutes: 15 }));
    expect(result.recommendations[0]).toMatchObject({
      servings: 4,
      prepMinutes: null,
      uncertainty: { prepTime: true },
      ingredients: candidate.ingredients,
    });
  });

  it('returns an invalid result for null or malformed input without throwing', () => {
    expect(recommendLocalFirst(null)).toEqual({ status: 'invalid', reason: 'invalid-input', recommendations: [] });
    expect(recommendLocalFirst({ ...baseInput(), asOf: 'not-a-date' })).toEqual({
      status: 'invalid', reason: 'invalid-input', recommendations: [],
    });
  });

  it('fails closed when restriction evidence or candidate identity is invalid', () => {
    const result = recommendLocalFirst(baseInput({
      allergies: ['peanut'],
      candidates: [
        baseCandidate({ id: '', title: 'Missing identity' }),
        baseCandidate({ id: 'no-ingredients', ingredients: [] }),
        baseCandidate({ id: 'unknown-ingredient', ingredients: undefined as never }),
        baseCandidate({ id: 'other-tenant', identity: { userId: 'user-1', tenantId: 'tenant-2' } }),
      ],
    }));
    expect(result.recommendations).toEqual([]);
  });
});
