'use client';

import { useState } from 'react';

import { PremiumRecipeDetailDto } from '@/services/types';

interface PremiumRecipeDetailClientProps {
  recipe: PremiumRecipeDetailDto;
  currentUserId: string;
}

export default function PremiumRecipeDetailClient({
  recipe,
  currentUserId,
}: PremiumRecipeDetailClientProps) {
  const [message, setMessage] = useState<string>('');
  const isCreator = recipe.creatorUserId === currentUserId;

  function handleReview(): void {
    setMessage('Review enviada (mock).');
  }

  function handleReport(): void {
    setMessage('Reporte enviado (mock).');
  }

  function handleWithdraw(): void {
    if (!isCreator) {
      setMessage('Solo el creador puede retirar esta receta.');
      return;
    }

    setMessage('Receta retirada por creador (mock).');
  }

  return (
    <section>
      <h2>{recipe.creatorDisplayName ?? 'Creator'}</h2>
      <p>Estado: {recipe.status}</p>
      <p>Modo: solo lectura para no creadores. No hay acciones de copy/adapt/fork.</p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', margin: '1rem 0' }}>
        <button type="button" onClick={handleReview}>
          Enviar review
        </button>
        <button type="button" onClick={handleReport}>
          Reportar
        </button>
        <button
          type="button"
          onClick={handleWithdraw}
          disabled={!isCreator}
          aria-disabled={!isCreator}
          title={isCreator ? 'Retirar receta' : 'No autorizado: solo creador'}
        >
          Retirar receta (solo creador)
        </button>
      </div>

      {!isCreator ? (
        <p style={{ color: '#555' }}>
          No sos creador de esta receta. Podés leer, calificar y reportar, pero no retirarla.
        </p>
      ) : null}

      <h3>Reviews</h3>
      <ul>
        {recipe.reviews.map((review) => (
          <li key={review.id}>
            {review.stars}★ — {review.comment ?? 'Sin comentario'}
          </li>
        ))}
      </ul>

      <p>{message}</p>
    </section>
  );
}
