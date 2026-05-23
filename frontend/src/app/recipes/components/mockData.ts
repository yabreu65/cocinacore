import { InventoryItemDto, RecipeHistoryItemDto, RecipeRatingDto, RestrictionProfile } from '@/services/types';

export const defaultRestrictionProfile: RestrictionProfile = {
  allergies: ['maní'],
  dietaryRules: ['sin gluten'],
};

export const mockInventory: InventoryItemDto[] = [
  {
    id: 'inv-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    ingredient: 'Tomate',
    quantity: '4 unidades',
    notes: null,
    createdAt: '2026-05-21T10:30:00.000Z',
    updatedAt: '2026-05-21T10:30:00.000Z',
  },
  {
    id: 'inv-2',
    tenantId: 'tenant-1',
    userId: 'user-1',
    ingredient: 'Albahaca',
    quantity: '1 manojo',
    notes: null,
    createdAt: '2026-05-21T10:31:00.000Z',
    updatedAt: '2026-05-21T10:31:00.000Z',
  },
];

export const mockHistory: RecipeHistoryItemDto[] = [
  {
    id: 'gen-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    ingredients: ['Tomate', 'Albahaca'],
    restrictions: defaultRestrictionProfile,
    recipe: 'Ensalada tibia de tomate y albahaca',
    citations: [{ sourceType: 'ai_generated', title: 'Chef Assistant' }],
    createdAt: '2026-05-21T12:00:00.000Z',
  },
];

export function addRatingOrThrow(
  ratings: RecipeRatingDto[],
  nextRating: RecipeRatingDto
): RecipeRatingDto[] {
  const duplicate = ratings.some(
    (rating) => rating.generationId === nextRating.generationId && rating.userId === nextRating.userId
  );

  if (duplicate) {
    throw new Error('La receta ya fue calificada por este usuario.');
  }

  return [...ratings, nextRating];
}
