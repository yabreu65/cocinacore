import { randomUUID } from 'node:crypto';
import { expect, test, type APIResponse } from '@playwright/test';
import { readProductionAuthEnvironment } from '../../src/lib/e2e-production-config';
import { authenticateProductionUser } from '../../src/lib/production-e2e-auth';

interface RecipeIdentity {
  id: string;
}

interface RecipeVersions {
  versions: Array<{ id: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function recipeItems(payload: unknown): unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error('Recipe list response has an invalid shape.');
  }
  return payload.items;
}

function recipeIdentity(payload: unknown): RecipeIdentity {
  if (!isRecord(payload) || !isRecord(payload.recipe) || typeof payload.recipe.id !== 'string') {
    throw new Error('Recipe response did not contain a safe recipe ID.');
  }
  return { id: payload.recipe.id };
}

async function assertStatus(response: APIResponse, status: number): Promise<void> {
  expect(response.status()).toBe(status);
}

async function readVersions(response: APIResponse): Promise<RecipeVersions> {
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.versions)) {
    throw new Error('Recipe versions response has an invalid shape.');
  }
  const versions: Array<{ id: string }> = [];
  for (const version of payload.versions) {
    if (!isRecord(version) || typeof version.id !== 'string') {
      throw new Error('Recipe versions response has an invalid shape.');
    }
    versions.push({ id: version.id });
  }
  return { versions };
}

const syntheticWritesApproved = process.env.E2E_PRODUCTION_SYNTHETIC_WRITES === 'approved';
test.skip(!syntheticWritesApproved, 'Synthetic production writes require explicit approval.');

test('synthetic recipe supports the bounded U5 lifecycle', async ({ request }) => {
  const auth = readProductionAuthEnvironment(process.env);
  await authenticateProductionUser(request, auth);

  const marker = `e2e-synthetic-${randomUUID()}`;
  const original = {
    title: `${marker} original`,
    instructions: 'Synthetic acceptance recipe; safe to archive after the run.',
    servings: 2,
    ingredients: [{ name: 'synthetic ingredient', quantity: '1', unit: 'unit' }],
    tags: [marker],
  };
  const updated = { ...original, title: `${marker} updated`, instructions: 'Updated synthetic instructions.' };
  let syntheticRecipeId: string | undefined;

  try {
    const createResponse = await request.post('/api/recipes', { data: original });
    await assertStatus(createResponse, 201);
    syntheticRecipeId = recipeIdentity(await createResponse.json()).id;

    const detailResponse = await request.get(`/api/recipes/${syntheticRecipeId}`);
    await assertStatus(detailResponse, 200);
    expect(recipeIdentity(await detailResponse.json()).id).toBe(syntheticRecipeId);

    const listResponse = await request.get(`/api/recipes?search=${encodeURIComponent(marker)}&archived=active&limit=10&offset=0`);
    await assertStatus(listResponse, 200);
    const listPayload: unknown = await listResponse.json();
    const activeItems = recipeItems(listPayload);
    expect(activeItems.some((item) => isRecord(item) && item.id === syntheticRecipeId)).toBe(true);

    const firstVersionsResponse = await request.get(`/api/recipes/${syntheticRecipeId}/versions`);
    await assertStatus(firstVersionsResponse, 200);
    const firstVersions = await readVersions(firstVersionsResponse);
    expect(firstVersions.versions.length).toBeGreaterThan(0);
    const priorVersionId = firstVersions.versions[0]?.id;
    if (typeof priorVersionId !== 'string') {
      throw new Error('No observed prior recipe version is available to restore.');
    }

    const updateResponse = await request.patch(`/api/recipes/${syntheticRecipeId}`, { data: updated });
    await assertStatus(updateResponse, 200);

    const updatedVersionsResponse = await request.get(`/api/recipes/${syntheticRecipeId}/versions`);
    await assertStatus(updatedVersionsResponse, 200);
    const updatedVersions = await readVersions(updatedVersionsResponse);
    expect(updatedVersions.versions.length).toBeGreaterThan(firstVersions.versions.length);

    const archiveResponse = await request.patch(`/api/recipes/${syntheticRecipeId}/archive`, { data: { archived: true } });
    await assertStatus(archiveResponse, 200);

    const archivedSearchResponse = await request.get(`/api/recipes?search=${encodeURIComponent(marker)}&archived=archived&limit=10&offset=0`);
    await assertStatus(archivedSearchResponse, 200);
    const archivedPayload: unknown = await archivedSearchResponse.json();
    const archivedItems = recipeItems(archivedPayload);
    expect(archivedItems.some((item) => isRecord(item) && item.id === syntheticRecipeId)).toBe(true);

    const restoreResponse = await request.post(`/api/recipes/${syntheticRecipeId}/restore`, { data: { versionId: priorVersionId } });
    await assertStatus(restoreResponse, 200);
  } finally {
    if (syntheticRecipeId) {
      // No DELETE route exists. Residual cleanup is archive-only pending the U6/product decision.
      const cleanupResponse = await request.patch(`/api/recipes/${syntheticRecipeId}/archive`, { data: { archived: true } });
      await assertStatus(cleanupResponse, 200);
    }
  }
});
