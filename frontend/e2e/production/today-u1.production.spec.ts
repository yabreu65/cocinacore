import { expect, test } from '@playwright/test';
import { readProductionAuthEnvironment } from '../../src/lib/e2e-production-config';
import { authenticateProductionUser } from '../../src/lib/production-e2e-auth';

type TodaySource = 'provider' | 'history' | 'saved_plan' | 'saved_recipe';
type Availability = 'sufficient' | 'partial' | 'missing' | 'unknown';

const TODAY_SOURCES: readonly TodaySource[] = ['provider', 'history', 'saved_plan', 'saved_recipe'];
const AVAILABILITIES: readonly Availability[] = ['sufficient', 'partial', 'missing', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isTodaySource(value: unknown): value is TodaySource {
  return typeof value === 'string' && TODAY_SOURCES.includes(value as TodaySource);
}

function isAvailability(value: unknown): value is Availability {
  return typeof value === 'string' && AVAILABILITIES.includes(value as Availability);
}

function isTodayOption(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const uncertainty = value.uncertainty;
  if (!isRecord(uncertainty)) return false;
  if (
    !isNonEmptyString(value.title) ||
    value.slot !== 'lunch' ||
    !isStringArray(value.ingredients) ||
    value.ingredients.length === 0 ||
    !isTodaySource(value.source) ||
    !isTodaySource(value.provenance) ||
    value.source !== value.provenance ||
    !isAvailability(value.availability) ||
    !isNonEmptyString(value.reason) ||
    !isStringArray(value.availableIngredients) ||
    !isStringArray(value.missingIngredients) ||
    !isStringArray(value.unknownIngredients)
  ) {
    return false;
  }

  const { availableIngredients, missingIngredients, unknownIngredients } = value;
  const available = new Set(availableIngredients);
  const missing = new Set(missingIngredients);
  const unknown = new Set(unknownIngredients);
  const availabilityIsDisjoint =
    [...available].every((ingredient) => !missing.has(ingredient) && !unknown.has(ingredient)) &&
    [...missing].every((ingredient) => !unknown.has(ingredient));
  const uncertaintyIsBoolean = ['inventory', 'prepTime', 'planDate'].every(
    (key) => typeof uncertainty[key] === 'boolean'
  );

  return availabilityIsDisjoint && uncertaintyIsBoolean;
}

test('authenticated user receives read-only Today U1 lunch recommendations', async ({ request }) => {
  const auth = readProductionAuthEnvironment(process.env);
  await authenticateProductionUser(request, auth);

  const response = await request.post('/api/today', { data: { slot: 'lunch' } });
  expect(response.status()).toBe(200);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Today response was not valid JSON.');
  }
  if (!isRecord(payload) || !Array.isArray(payload.options)) {
    throw new Error('Today response has an invalid shape.');
  }

  const status = payload.status;
  const options: unknown[] = payload.options;
  const statusIsKnown = status === 'success' || status === 'degraded';
  expect(statusIsKnown).toBe(true);
  expect(options.length).toBeGreaterThan(0);
  expect(options.every(isTodayOption)).toBe(true);

  const sourceCounts: Record<TodaySource, number> = {
    provider: 0,
    history: 0,
    saved_plan: 0,
    saved_recipe: 0,
  };
  const availabilityCounts: Record<Availability, number> = {
    sufficient: 0,
    partial: 0,
    missing: 0,
    unknown: 0,
  };
  for (const option of options) {
    if (!isRecord(option)) continue;
    if (isTodaySource(option.source)) sourceCounts[option.source] += 1;
    if (isAvailability(option.availability)) availabilityCounts[option.availability] += 1;
  }

  // Deliberately emit only bounded aggregate metadata; never log the response or user content.
  console.info(
    JSON.stringify({
      status: statusIsKnown ? status : 'other',
      optionCount: options.length,
      sourceCounts,
      availabilityCounts,
    })
  );
});
