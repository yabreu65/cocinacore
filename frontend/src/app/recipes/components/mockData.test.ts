import { describe, expect, it } from 'vitest';

import { addRatingOrThrow } from './mockData';
import { RecipeRatingDto } from '@/services/types';

function createRating(generationId: string, userId: string, rating: number): RecipeRatingDto {
  return {
    id: `${generationId}-${userId}-${rating}`,
    generationId,
    tenantId: 'tenant-1',
    userId,
    rating,
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
  };
}

describe('addRatingOrThrow', () => {
  it('adds a new rating when no duplicate exists', () => {
    const ratings = [createRating('gen-1', 'user-2', 4)];

    const nextRatings = addRatingOrThrow(ratings, createRating('gen-1', 'user-1', 5));

    expect(nextRatings).toHaveLength(2);
  });

  it('throws for duplicate generation rating by the same user', () => {
    const ratings = [createRating('gen-1', 'user-1', 4)];

    expect(() => addRatingOrThrow(ratings, createRating('gen-1', 'user-1', 5))).toThrow(
      'La receta ya fue calificada por este usuario.'
    );
  });
});
