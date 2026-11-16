import { describe, expect, it } from 'vitest';
import { buildTodayContext } from './context';
import type { RecipeAiHistoryRow, RecipeInventoryItemRow, UserCulinaryProfileRow, UserMealPlanRow } from '@/lib/db/types';

const profile: UserCulinaryProfileRow = {
  user_id: 'user-1', tenant_id: 'tenant-1', level: 'casual', available_time_minutes: 25,
  disliked_ingredients: ['olives'], allergies: ['peanuts'],
  household_members: [{ name: 'Private Name', ageGroup: 'adult' }, { name: 'Another Name', ageGroup: 'child' }],
  created_at: '', updated_at: '',
};
const inventory = [
  { tenant_id: 'tenant-1', ingredient_name: 'rice', quantity: '2', unit: 'kg', expiration_date: null, id: 'secret-id', notes: 'private note' },
  { tenant_id: 'tenant-1', ingredient_name: 'old fish', quantity: '1', unit: 'kg', expiration_date: '2025-04-09', id: 'expired-id' },
  { tenant_id: 'tenant-1', ingredient_name: 'tomato', quantity: '4', unit: 'units', expiration_date: '2025-04-11', id: 'fresh-id' },
] as RecipeInventoryItemRow[];
const terms = [
  { user_id: 'user-1', term_id: 't1', preference_type: 'avoid', weight: 1, created_at: '', term_label: 'cilantro' },
  { user_id: 'user-1', term_id: 't2', preference_type: 'prefer', weight: 1, created_at: '', term_label: 'Mexican' },
  { user_id: 'user-1', term_id: 't3', preference_type: 'goal', weight: 1, created_at: '', term_label: 'quick meals' },
] as const;
const base = {
  userId: 'user-1', tenantId: 'tenant-1', asOf: '2025-04-10', slot: 'lunch' as const,
  profile, terms, inventory, history: [] as RecipeAiHistoryRow[],
};

function plan(): UserMealPlanRow {
  const meals = (day: number) => ({ dayIndex: day, meals: [
    { mealType: 'breakfast', title: `Breakfast ${day}`, description: null, ingredients: [{ name: 'oats', quantity: 1, unit: 'cup' }] },
    { mealType: 'lunch', title: `Lunch ${day}`, description: null, ingredients: [{ name: 'rice', quantity: 1, unit: 'cup' }] },
    { mealType: 'dinner', title: `Dinner ${day}`, description: null, ingredients: [{ name: 'beans', quantity: 1, unit: 'cup' }] },
  ] });
  return {
    id: 'plan-id', tenant_id: 'tenant-1', user_id: 'user-1', people_count: 2, period: 'week', mode: 'balanced_ai',
    base_cuisine: 'private', fusion_cuisines: [], fusion_intensity: 'sutil', goal: null, restrictions: [],
    inventory_snapshot: { evaluatedHardRestrictions: ['cilantro'] }, calendar_payload: { period: 'week', dayCount: 7, days: Array.from({ length: 7 }, (_, i) => meals(i + 1)) },
    consumption_payload: { '1:lunch': { consumedAt: '2025-04-09T12:00:00Z', dayIndex: 1, mealType: 'lunch', mealTitle: 'Lunch 1', decrements: [], skipped: [] } },
    ai_content: 'do not expose', created_at: '', updated_at: '',
  };
}

describe('buildTodayContext', () => {
  it('allows only a missing profile with no terms and exposes no inferred restrictions', () => {
    const result = buildTodayContext({ ...base, profile: null, terms: [] });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.providerContext).toMatchObject({ allergies: [], hardAvoid: [], dislikedIngredients: [], preferred: [], goals: [], profileConfigured: false });
    expect(JSON.stringify(result.providerContext)).not.toMatch(/allerg(y|ies).{0,20}checked/i);
    expect(buildTodayContext({ ...base, profile: null, terms }).status).toBe('invalid');
    expect(buildTodayContext({ ...base, terms: [{ ...terms[0], user_id: 'user-other' }] }).status).toBe('invalid');
  });

  it('rejects a profile belonging to another user or tenant', () => {
    expect(buildTodayContext({ ...base, profile: { ...profile, tenant_id: 'tenant-other' } }).status).toBe('invalid');
    expect(buildTodayContext({ ...base, profile: { ...profile, user_id: 'user-other' } }).status).toBe('invalid');
  });

  it('builds an explicit privacy-allowlisted DTO with separate allergy, avoid, dislike, and household counts', () => {
    const result = buildTodayContext(base);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.providerContext).toMatchObject({ slot: 'lunch', asOf: '2025-04-10', maxPrepMinutes: 25,
      allergies: ['peanuts'], hardAvoid: ['cilantro'], dislikedIngredients: ['olives'], preferred: ['Mexican'], goals: ['quick meals'],
      householdCounts: { adult: 1, teen: 0, child: 1 } });
    expect(result.providerContext.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'rice', quantity: '2', unit: 'kg' }),
      expect.objectContaining({ name: 'tomato', expiresOn: '2025-04-11' }),
    ]));
    expect(result.providerContext.inventory.some((item) => item.name === 'old fish')).toBe(false);
    const serialized = JSON.stringify(result);
    for (const forbidden of ['user-1', 'tenant-1', 'Private Name', 'Another Name', 'secret-id', 'private note', 'recipe_payload', 'do not expose']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('retains seeded nutritional restrictions as hard exclusions', () => {
    const result = buildTodayContext({
      ...base, terms: [...terms,
        { ...terms[0], term_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbf', term_label: 'Keto' },
        { ...terms[0], term_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbd', term_label: 'Bajo en sodio' },
      ],
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.providerContext.hardAvoid).toEqual(['cilantro', 'Keto', 'Bajo en sodio']);
    expect(result.providerContext.goals).toEqual(['quick meals']);
  });

  it('preserves calendar expiry and uses local dates for legacy timestamps', () => {
    const result = buildTodayContext({
      ...base, asOf: '2025-04-10', timeZone: 'America/Bogota',
      inventory: [
        { ...inventory[0], ingredient_name: 'calendar', expiration_date: '2025-04-10T00:00:00.000Z' },
        { ...inventory[0], ingredient_name: 'expired locally', expiration_date: '2025-04-10T03:00:00Z' },
        { ...inventory[0], ingredient_name: 'valid locally', expiration_date: '2025-04-11T03:00:00Z' },
      ],
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.providerContext.inventory.map(({ name, expiresOn }) => ({ name, expiresOn }))).toEqual([
      { name: 'calendar', expiresOn: '2025-04-10' },
      { name: 'valid locally', expiresOn: '2025-04-10' },
    ]);
  });

  it('provides only unconsumed matching-slot saved-plan candidates and no snack candidates', () => {
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, latestPlan: plan() });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.localSignals.savedPlanCandidates.map((candidate) => candidate.title)).toContain('Lunch 2');
    expect(result.localSignals.savedPlanCandidates.every((candidate) => candidate.prepMinutes === null)).toBe(true);
    expect(result.localSignals.savedPlanCandidates.every((candidate) => candidate.source === 'saved_plan')).toBe(true);
    expect(result.localSignals.savedPlanCandidates[0]?.ingredients).toContainEqual({
      name: 'rice',
      quantity: 1,
      unit: 'cup',
    });
    expect(result.localSignals.savedPlanCandidates[0]?.quantityProvenance).toBe('ai_estimate');
    expect(JSON.stringify(result.providerContext)).not.toContain('saved_plan');
    expect(result.localSignals.savedPlanCandidates.map((candidate) => candidate.title)).not.toContain('Lunch 1');
    expect(result.localSignals.savedPlanCandidates.every((candidate) => candidate.slot === 'lunch')).toBe(true);
    const snack = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, slot: 'snack', latestPlan: plan() });
    expect(snack.status === 'ready' && snack.localSignals.savedPlanCandidates).toEqual([]);
  });

  it('uses history titles only as bounded local repeat signals and accepts payload candidates only with explicit supported matching slot', () => {
    const history = [
      { recipe_title: 'Explicit lunch', created_at: '2025-04-09T00:00:00Z', recipe_payload: { slot: 'lunch', prepMinutes: 18, structuredIngredients: [{ name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true }] } },
      { recipe_title: 'Unknown prep', created_at: '2025-04-08T00:00:00Z', recipe_payload: { slot: 'lunch', structuredIngredients: [{ name: 'beans', normalized_name: 'beans', quantity: 1, unit: 'cup', structured: true }] } },
      { recipe_title: 'Malformed prep', created_at: '2025-04-08T00:00:00Z', recipe_payload: { slot: 'lunch', prepMinutes: 0, structuredIngredients: [{ name: 'beans', normalized_name: 'beans', quantity: 1, unit: 'cup', structured: true }] } },
      { recipe_title: 'No inferred slot', created_at: '2025-04-08T00:00:00Z', recipe_payload: { structuredIngredients: [{ name: 'beans', normalized_name: 'beans', quantity: 1, unit: 'cup', structured: true }] } },
      ...Array.from({ length: 40 }, (_, i) => ({ recipe_title: `Recent ${i}`, created_at: '2025-04-07T00:00:00Z', recipe_payload: {} })),
    ] as RecipeAiHistoryRow[];
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, history });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.localSignals.recentTitles).toContain('Explicit lunch');
    expect(result.localSignals.historyCandidates.map((item) => item.title)).toEqual(['Explicit lunch', 'Unknown prep']);
    expect(result.localSignals.historyCandidates.map((item) => item.prepMinutes)).toEqual([18, null]);
    expect(result.localSignals.historyCandidates.map((item) => item.source)).toEqual(['history', 'history']);
    expect(JSON.stringify(result.providerContext)).not.toContain('history');
    expect(result.localSignals.recentTitles.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(result.providerContext)).not.toContain('Explicit lunch');
    expect(JSON.stringify(result.providerContext)).not.toContain('recipe_payload');
    const wrongSlot = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, slot: 'dinner', history });
    expect(wrongSlot.status === 'ready' && wrongSlot.localSignals.historyCandidates).toEqual([]);
    const explicitSnack = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, slot: 'snack', history: [
      { recipe_title: 'Snack', created_at: '2025-04-09T00:00:00Z', recipe_payload: { slot: 'snack', structuredIngredients: [{ name: 'apple', normalized_name: 'apple', quantity: null, unit: null, structured: true }] } },
    ] as RecipeAiHistoryRow[] });
    expect(explicitSnack.status === 'ready' && explicitSnack.localSignals.historyCandidates.map((item) => item.title)).toEqual(['Snack']);
    expect(explicitSnack.status === 'ready' && explicitSnack.localSignals.historyCandidates[0].prepMinutes).toBe(null);
  });

  it('omits history and saved-plan candidates that conflict with active restrictions while retaining safe candidates', () => {
    const history = [
      { recipe_title: 'Unsafe history', created_at: '2025-04-09', recipe_payload: { slot: 'lunch', structuredIngredients: [{ name: 'cilantro', normalized_name: 'cilantro', quantity: 1, unit: 'cup', structured: true }] } },
      { recipe_title: 'Safe history', created_at: '2025-04-09', recipe_payload: { slot: 'lunch', structuredIngredients: [{ name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true }] } },
    ] as RecipeAiHistoryRow[];
    const restrictedPlan = plan();
    const days = restrictedPlan.calendar_payload as { days: Array<{ meals: Array<{ title: string; ingredients: Array<{ name: string }> }> }> };
    days.days[1].meals[1].ingredients = [{ ...days.days[1].meals[1].ingredients[0], name: 'cilantro' }];
    days.days[2].meals[1].ingredients = [{ ...days.days[2].meals[1].ingredients[0], name: 'cilantro' }];
    days.days[3].meals[1].title = 'Safe plan lunch';

    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, history, latestPlan: restrictedPlan });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.localSignals.historyCandidates.map(({ title }) => title)).toEqual(['Safe history']);
    expect(result.localSignals.savedPlanCandidates.map(({ title }) => title)).toContain('Safe plan lunch');
    expect(result.localSignals.savedPlanCandidates.map(({ title }) => title)).not.toContain('Lunch 2');
    expect(result.localSignals.savedPlanCandidates.map(({ title }) => title)).not.toContain('Lunch 3');
    expect(result.localSignals.recentTitles).toContain('Unsafe history');
  });

  it('omits restricted candidates when ingredient lists are absent, invalid, or empty', () => {
    const history = [
      { recipe_title: 'Absent', created_at: '2025-04-09', recipe_payload: { slot: 'lunch' } },
      { recipe_title: 'Invalid', created_at: '2025-04-09', recipe_payload: { slot: 'lunch', structuredIngredients: 'peanuts' } },
      { recipe_title: 'Empty', created_at: '2025-04-09', recipe_payload: { slot: 'lunch', structuredIngredients: [] } },
      { recipe_title: 'Safe', created_at: '2025-04-09', recipe_payload: { slot: 'lunch', structuredIngredients: [{ name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true }] } },
    ] as RecipeAiHistoryRow[];
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, history });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.localSignals.historyCandidates.map(({ title }) => title)).toEqual(['Safe']);
  });

  it('retains structured history quantities as explicit AI estimates', () => {
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, history: [{
      recipe_title: 'Estimated rice',
      source: 'gemini',
      created_at: '2025-04-09T00:00:00Z',
      recipe_payload: {
        slot: 'lunch',
        structuredIngredients: [{ name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true }],
      },
    }] as RecipeAiHistoryRow[] });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.localSignals.historyCandidates[0]).toMatchObject({
      ingredients: [{ name: 'rice', quantity: 1, unit: 'cup' }],
      quantityProvenance: 'ai_estimate',
    });
  });

  it('fails closed on malformed candidate structures and bounds provider inventory and quantities', () => {
    const unsafe = [{ recipe_title: 'Unsafe', created_at: '2025-04-09', recipe_payload: { slot: 'lunch', structuredIngredients: [{ name: 'x'.repeat(200), quantity: -1, unit: 'cup' }] } }];
    const result = buildTodayContext({ ...base, history: unsafe as RecipeAiHistoryRow[], inventory: Array.from({ length: 80 }, (_, i) => ({ tenant_id: 'tenant-1', ingredient_name: `item-${i}`, quantity: 'x'.repeat(300), unit: 'kg', expiration_date: null })) as RecipeInventoryItemRow[] });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.localSignals.historyCandidates).toEqual([]);
    expect(result.providerContext.inventory.length).toBeLessThanOrEqual(50);
    expect(result.providerContext.inventory.every((item) => item.quantity === undefined || item.quantity.length <= 40)).toBe(true);
  });
  it('defers saved recommendations under broad legacy categories without erasing the provider restriction', () => {
    const result = buildTodayContext({
      ...base,
      terms: [{ ...terms[0], term_label: 'shellfish' }],
      latestPlan: plan(),
      history: [{
        recipe_title: 'Rice proposal', created_at: '2025-04-09', recipe_payload: {
          slot: 'lunch', structuredIngredients: [{ name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true }],
        },
      }] as RecipeAiHistoryRow[],
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.providerContext.hardAvoid).toEqual(['shellfish']);
    expect(result.localSignals.historyCandidates).toEqual([]);
    expect(result.localSignals.savedPlanCandidates).toEqual([]);
  });

  it('passes all hard restrictions to the model and omits unassessed allergy candidates', () => {
    const allergies = [...Array.from({ length: 20 }, (_, i) => 'allergy ' + i), 'x'.repeat(160)];
    const avoids = [...Array.from({ length: 20 }, (_, i) => ({ ...terms[0], term_id: 'term-' + i, term_label: 'avoid ' + i })), { ...terms[0], term_id: 'long', term_label: 'y'.repeat(180) }];
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies }, terms: avoids, latestPlan: plan() });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.providerContext.allergies).toEqual(allergies);
    expect(result.providerContext.hardAvoid).toEqual(avoids.map(({ term_label }) => term_label));
    expect(result.localSignals.savedPlanCandidates).toEqual([]);
  });

  it('rejects a history candidate with a conflict only in the full recipe text', () => {
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, history: [{
      recipe_title: 'Rice', source: 'gemini', created_at: '2025-04-09',
      recipe_payload: { slot: 'lunch', full_recipe: 'Add cilantro', structuredIngredients: [{ name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true }] },
    }] as RecipeAiHistoryRow[] });
    expect(result.status === 'ready' && result.localSignals.historyCandidates).toEqual([]);
  });

  it('keeps a saved plan one-off exclusion when suggesting a previously planned meal', () => {
    const stored = plan();
    stored.restrictions = ['rice'];
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, latestPlan: stored });
    expect(result.status === 'ready' && result.localSignals.savedPlanCandidates).toEqual([]);
  });

  it('omits a linked meal rather than recommending its obsolete ingredients', () => {
    const saved = plan();
    const payload = saved.calendar_payload as { days: Array<{ meals: Array<Record<string, unknown>> }> };
    payload.days[1].meals[1].recipeRef = { recipeId: '00000000-0000-4000-8000-000000000001', versionId: '00000000-0000-4000-8000-000000000002' };
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, latestPlan: saved });
    expect(result.status === 'ready' && result.localSignals.savedPlanCandidates.map(({ title }) => title)).not.toContain('Lunch 2');
  });

  it('does not reuse a saved menu under an unevaluated new exclusion', () => {
    const saved = plan();
    const result = buildTodayContext({ ...base, profile: { ...profile, allergies: [] }, latestPlan: saved,
      terms: [...terms, { ...terms[0], term_id: 'new', term_label: 'ingredient not listed anywhere' }] });
    expect(result.status === 'ready' && result.localSignals.savedPlanCandidates).toEqual([]);
  });

});
