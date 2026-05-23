'use client';

import { useState } from 'react';

import { addRatingOrThrow } from '../components/mockData';
import { RecipeRatingDto } from '@/services/types';

const currentUserId = 'user-1';
const currentGenerationId = 'gen-1';

export default function RecipeRatingPage() {
  const [ratings, setRatings] = useState<RecipeRatingDto[]>([]);
  const [message, setMessage] = useState<string>('');

  function rateRecipe(value: number): void {
    const now = new Date().toISOString();
    const nextRating: RecipeRatingDto = {
      id: `rating-${ratings.length + 1}`,
      generationId: currentGenerationId,
      tenantId: 'tenant-1',
      userId: currentUserId,
      rating: value,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const updated = addRatingOrThrow(ratings, nextRating);
      setRatings(updated);
      setMessage('Calificación guardada.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'No se pudo guardar la calificación.';
      setMessage(errorMessage);
    }
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '920px', margin: '0 auto' }}>
      <h1>Calificar receta generada</h1>
      <p>Podés calificar una vez por receta generada.</p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" onClick={() => rateRecipe(value)}>
            {value}
          </button>
        ))}
      </div>
      <p>{message}</p>
      <p>Total de calificaciones registradas: {ratings.length}</p>
    </main>
  );
}
