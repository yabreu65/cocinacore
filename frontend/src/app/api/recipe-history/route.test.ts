import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireTenantMock = vi.fn();
const requireUserMock = vi.fn();
const listRecipeHistoryByTenantMock = vi.fn();
const deleteRecipeHistoryMock = vi.fn();
const updateRecipeFeedbackMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireTenant: requireTenantMock,
  requireUser: requireUserMock,
}));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  listRecipeHistoryByTenant: listRecipeHistoryByTenantMock,
  deleteRecipeHistory: deleteRecipeHistoryMock,
  updateRecipeFeedback: updateRecipeFeedbackMock,
}));

const { GET, DELETE, PATCH } = await import('./route');

describe('/api/recipe-history', () => {
  beforeEach(() => {
    requireTenantMock.mockReset();
    requireUserMock.mockReset();
    listRecipeHistoryByTenantMock.mockReset();
    deleteRecipeHistoryMock.mockReset();
    updateRecipeFeedbackMock.mockReset();

    requireTenantMock.mockResolvedValue({ tenantId: 'tenant-1' });
    requireUserMock.mockResolvedValue({ id: 'user-1' });
    listRecipeHistoryByTenantMock.mockResolvedValue([]);
    deleteRecipeHistoryMock.mockResolvedValue(undefined);
    updateRecipeFeedbackMock.mockResolvedValue({ id: 'recipe-1', user_feedback: 'accepted' });
  });

  it('lists history within the authenticated tenant and user scope', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(listRecipeHistoryByTenantMock).toHaveBeenCalledWith('tenant-1', { userId: 'user-1' });
  });

  it('deletes only within the authenticated tenant and user scope', async () => {
    const response = await DELETE(
      new NextRequest('https://app.example.test/api/recipe-history?id=recipe-owned-by-someone-else')
    );

    expect(response.status).toBe(200);
    expect(deleteRecipeHistoryMock).toHaveBeenCalledWith(
      'recipe-owned-by-someone-else',
      'tenant-1',
      'user-1'
    );
  });

  it('updates feedback only within the authenticated tenant and user scope', async () => {
    const response = await PATCH(
      new NextRequest('https://app.example.test/api/recipe-history?id=recipe-owned-by-someone-else&feedback=accepted')
    );

    expect(response.status).toBe(200);
    expect(updateRecipeFeedbackMock).toHaveBeenCalledWith(
      'recipe-owned-by-someone-else',
      'tenant-1',
      'user-1',
      'accepted'
    );
  });
});
