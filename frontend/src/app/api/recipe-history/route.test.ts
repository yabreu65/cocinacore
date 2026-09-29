import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const listRecipeHistoryByTenantMock = vi.fn();
const deleteRecipeHistoryMock = vi.fn();
const toggleRecipeSavedMock = vi.fn();
const updateRecipeFeedbackMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  listRecipeHistoryByTenant: listRecipeHistoryByTenantMock,
  deleteRecipeHistory: deleteRecipeHistoryMock,
  toggleRecipeSaved: toggleRecipeSavedMock,
  updateRecipeFeedback: updateRecipeFeedbackMock,
}));

const { GET, DELETE, PATCH } = await import('./route');

const historyRow = {
  id: 'recipe-1',
  recipe_title: 'Recipe title',
  recipe_payload: { title: 'Recipe title' },
  user_feedback: 'accepted',
  created_at: '2026-03-16T00:00:00.000Z',
  is_saved: false,
  tenant_id: 'tenant-1',
  user_id: 'user-1',
  source: 'recipe-search',
  restrictions_snapshot: {},
  inventory_snapshot: {},
};

function request(path: string): NextRequest {
  return new NextRequest(`https://app.example.test${path}`);
}

describe('/api/recipe-history', () => {
  beforeEach(() => {
    requireTenantMock.mockReset();
    requireUserMock.mockReset();
    listRecipeHistoryByTenantMock.mockReset();
    deleteRecipeHistoryMock.mockReset();
    toggleRecipeSavedMock.mockReset();
    updateRecipeFeedbackMock.mockReset();

    requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' });
    requireUserMock.mockResolvedValue({ id: 'user-1' });
    listRecipeHistoryByTenantMock.mockResolvedValue([historyRow]);
    deleteRecipeHistoryMock.mockResolvedValue(undefined);
    toggleRecipeSavedMock.mockResolvedValue(historyRow);
    updateRecipeFeedbackMock.mockResolvedValue(historyRow);
  });

  it('lists the authenticated user history with only the public item shape', async () => {
    const response = await GET(request('/api/recipe-history?tenantId=other-tenant&userId=other-user'));

    expect(response.status).toBe(200);
    expect(listRecipeHistoryByTenantMock).toHaveBeenCalledWith('tenant-1', { userId: 'user-1' });
    expect(await response.json()).toEqual({
      items: [
        {
          id: historyRow.id,
          recipe_title: historyRow.recipe_title,
          recipe_payload: historyRow.recipe_payload,
          user_feedback: historyRow.user_feedback,
          created_at: historyRow.created_at,
          is_saved: historyRow.is_saved,
        },
      ],
    });
  });

  it('lists only saved history for the authenticated user', async () => {
    const response = await GET(request('/api/recipe-history?saved=true'));

    expect(response.status).toBe(200);
    expect(listRecipeHistoryByTenantMock).toHaveBeenCalledWith('tenant-1', {
      userId: 'user-1',
      onlySaved: true,
    });
  });

  it('lists all authenticated history when saved=false', async () => {
    const response = await GET(request('/api/recipe-history?saved=false'));

    expect(response.status).toBe(200);
    expect(listRecipeHistoryByTenantMock).toHaveBeenCalledWith('tenant-1', { userId: 'user-1' });
  });

  it('rejects invalid saved filters', async () => {
    const response = await GET(request('/api/recipe-history?saved=yes'));

    expect(response.status).toBe(400);
    expect(listRecipeHistoryByTenantMock).not.toHaveBeenCalled();
  });

  it('deletes only within the authenticated tenant and user scope', async () => {
    const response = await DELETE(
      request('/api/recipe-history?id=recipe-owned-by-someone-else')
    );

    expect(response.status).toBe(200);
    expect(deleteRecipeHistoryMock).toHaveBeenCalledWith(
      'recipe-owned-by-someone-else',
      'tenant-1',
      'user-1'
    );
  });

  it('preserves feedback updates within the authenticated tenant and user scope', async () => {
    const response = await PATCH(
      request('/api/recipe-history?id=recipe-owned-by-someone-else&feedback=accepted')
    );

    expect(response.status).toBe(200);
    expect(updateRecipeFeedbackMock).toHaveBeenCalledWith(
      'recipe-owned-by-someone-else',
      'tenant-1',
      'user-1',
      'accepted'
    );
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('updates saved=%s within the authenticated tenant and user scope', async (saved, value) => {
    const response = await PATCH(
      request(
        `/api/recipe-history?id=recipe-1&tenantId=other-tenant&userId=other-user&saved=${saved}`
      )
    );

    expect(response.status).toBe(200);
    expect(toggleRecipeSavedMock).toHaveBeenCalledWith('recipe-1', 'tenant-1', 'user-1', value);
    expect(await response.json()).toEqual({
      item: {
        id: historyRow.id,
        recipe_title: historyRow.recipe_title,
        recipe_payload: historyRow.recipe_payload,
        user_feedback: historyRow.user_feedback,
        created_at: historyRow.created_at,
        is_saved: historyRow.is_saved,
      },
    });
  });

  it('rejects ambiguous feedback and saved intents', async () => {
    const response = await PATCH(request('/api/recipe-history?id=recipe-1&feedback=accepted&saved=true'));

    expect(response.status).toBe(400);
    expect(updateRecipeFeedbackMock).not.toHaveBeenCalled();
    expect(toggleRecipeSavedMock).not.toHaveBeenCalled();
  });

  it('rejects missing ids and invalid update values', async () => {
    const missingId = await PATCH(request('/api/recipe-history?saved=true'));
    const invalidValue = await PATCH(request('/api/recipe-history?id=recipe-1&saved=yes'));

    expect(missingId.status).toBe(400);
    expect(invalidValue.status).toBe(400);
  });

  it.each([
    ['same-tenant other-user recipe', 'tenant-1', 'other-user'],
    ['other-tenant recipe', 'other-tenant', 'user-1'],
  ])('returns 404 for a %s', async (_label, tenantId, userId) => {
    toggleRecipeSavedMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      request(`/api/recipe-history?id=not-owned&tenantId=${tenantId}&userId=${userId}&saved=true`)
    );

    expect(response.status).toBe(404);
    expect(toggleRecipeSavedMock).toHaveBeenCalledWith('not-owned', 'tenant-1', 'user-1', true);
    expect(await response.json()).toEqual({ error: 'Recipe history item not found' });
  });

  it('returns 404 when a scoped feedback update does not own a row', async () => {
    updateRecipeFeedbackMock.mockResolvedValueOnce(null);

    const response = await PATCH(request('/api/recipe-history?id=other-user-recipe&feedback=accepted'));

    expect(response.status).toBe(404);
  });

  it('returns a generic 500 when an update fails', async () => {
    toggleRecipeSavedMock.mockRejectedValueOnce(new Error('SQL connection details'));

    const response = await PATCH(request('/api/recipe-history?id=recipe-1&saved=true'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to update recipe history' });
  });
});
