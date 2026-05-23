import { PremiumRecipeDetailDto, PremiumRecipeDto, PremiumRecipeReviewDto } from '@/services/types';

const now = '2026-05-22T12:00:00.000Z';

export const currentUserId = 'user-2';

export const premiumRecipes: PremiumRecipeDto[] = [
  {
    id: 'premium-1',
    sourceRecipeHistoryId: 'hist-100',
    sourceTenantId: 'tenant-creator',
    creatorUserId: 'user-1',
    creatorDisplayName: 'Chef Valentina',
    eligibilityScore: 97,
    creatorOptedIn: true,
    status: 'published',
    publishedAt: now,
    withdrawnAt: null,
    createdAt: now,
    updatedAt: now,
  },
];

export const premiumReviews: PremiumRecipeReviewDto[] = [
  {
    id: 'review-1',
    premiumRecipeId: 'premium-1',
    userId: 'user-9',
    stars: 5,
    comment: 'Gran técnica y sabor.',
    createdAt: now,
    updatedAt: now,
  },
];

export function getPremiumRecipeDetail(recipeId: string): PremiumRecipeDetailDto | null {
  const recipe = premiumRecipes.find((entry) => entry.id === recipeId);
  if (!recipe) {
    return null;
  }

  return {
    ...recipe,
    reviews: premiumReviews.filter((review) => review.premiumRecipeId === recipe.id),
  };
}
