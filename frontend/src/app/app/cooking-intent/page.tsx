'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { safeFetch } from '@/lib/api';
import CookingSessionPanel from '@/app/recipes/CookingSessionPanel';
import type { CookingIntentPreview } from '@/lib/cooking-intent-preview';

type PreviewResponse = { preview: CookingIntentPreview };

const statusCopy: Record<CookingIntentPreview['status'], string> = {
  ready: 'Listo para revisar',
  partial: 'Disponible parcialmente',
  unknown: 'Información incompleta',
  blocked: 'Bloqueado por restricciones',
};

const availabilityCopy = {
  sufficient: 'Disponible',
  partial: 'Parcial',
  missing: 'Faltante',
  unknown: 'Sin verificar',
} as const;

function CookingIntentPreviewContent() {
  const params = useSearchParams();
  const [preview, setPreview] = useState<CookingIntentPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const query = params.toString();

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError('');
    setPreview(null);

    void safeFetch<PreviewResponse>(`/api/cooking-intent-preview?${query}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPreview(result.data.preview);
      })
      .catch((cause: unknown) => {
        if (!current || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError('No se pudo cargar la vista previa.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
      controller.abort();
    };
  }, [query]);

  if (loading)
    return (
      <main className="p-6" aria-busy="true">
        Cargando vista previa…
      </main>
    );
  if (error)
    return (
      <main className="p-6" role="alert">
        {error}
      </main>
    );
  if (!preview)
    return (
      <main className="p-6" role="alert">
        No hay vista previa disponible.
      </main>
    );

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto max-w-4xl rounded-3xl border border-bistro-border bg-white/85 p-5 premium-shadow">
        <header className="border-b border-bistro-border pb-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-bistro-action-primary">
            Vista previa
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            {preview.title || 'Preparación seleccionada'}
          </h1>
          <p className="mt-2" role="status">
            {statusCopy[preview.status]}
          </p>
          <p className="mt-1 text-sm text-bistro-text-secondary">
            {preview.portions.requested ?? '—'} porciones · Solo lectura: no se modificó tu
            inventario ni tu menú.
          </p>
        </header>

        {preview.restrictions.status !== 'clear' && (
          <div
            className="mt-4 rounded-2xl border border-bistro-warning/30 bg-bistro-warning/10 p-4"
            role="alert"
          >
            <strong>Revisá las restricciones antes de cocinar.</strong>
            <p className="mt-1 text-sm">{preview.restrictions.reasons.join(', ')}</p>
          </div>
        )}

        {preview.source === 'confirmed_meal_slot' && preview.mealSlot && preview.recipeVersion.recipeId &&
          preview.recipeVersion.versionId && !preview.recipeVersion.versionId.startsWith('meal-slot:') && (
          <CookingSessionPanel key={JSON.stringify([preview.mealSlot, preview.recipeVersion])} recipeId={preview.recipeVersion.recipeId} versionId={preview.recipeVersion.versionId} pinnedSlot={preview.mealSlot} />
        )}

        <section className="mt-5" aria-labelledby="ingredients-heading">
          <h2 id="ingredients-heading" className="text-xl font-semibold">
            Ingredientes y evidencia
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {preview.ingredients.map((ingredient) => (
              <li
                key={`${ingredient.name}-${ingredient.requiredUnit}`}
                className="rounded-2xl border border-bistro-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <strong>{ingredient.name}</strong>
                  <span className="rounded-full bg-bistro-surface-warm px-2 py-1 text-xs">
                    {availabilityCopy[ingredient.availability]}
                  </span>
                </div>
                <p className="mt-2 text-sm text-bistro-text-secondary">
                  Requerido: {ingredient.requiredQuantity ?? '—'}{' '}
                  {ingredient.requiredUnit === 'unknown' ? '' : ingredient.requiredUnit}
                </p>
                <p className="text-sm text-bistro-text-secondary">
                  Disponible: {ingredient.availableQuantity ?? '—'}{' '}
                  {ingredient.availableUnit === 'unknown' ? '' : ingredient.availableUnit}
                </p>
                <p className="text-sm text-bistro-text-secondary">
                  Vencimiento: {ingredient.expiry}
                </p>
                {ingredient.evidence !== 'verified' && (
                  <p className="mt-1 text-xs text-bistro-warning">
                    Evidencia: {ingredient.evidence}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5" aria-labelledby="steps-heading">
          <h2 id="steps-heading" className="text-xl font-semibold">
            Pasos disponibles
          </h2>
          {preview.steps.length === 0 ? (
            <p className="mt-2 text-sm text-bistro-text-secondary">
              No hay instrucciones estructuradas disponibles.
            </p>
          ) : (
            <ol className="mt-3 grid gap-2">
              {preview.steps.map((step) => (
                <li key={step.index} className="rounded-xl bg-bistro-page p-3">
                  <strong>{step.title}</strong>
                  <p className="mt-1 text-sm">{step.instruction}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {preview.limitations.length > 0 && (
          <section
            className="mt-5 rounded-2xl border border-bistro-border bg-bistro-page p-4"
            aria-labelledby="limitations-heading"
          >
            <h2 id="limitations-heading" className="font-semibold">
              Limitaciones de evidencia
            </h2>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {preview.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
}

// The search-parameter consumer needs its own Suspense boundary for
// Next.js production prerendering and client navigation.
export default function CookingIntentPreviewPage() {
  return (
    <Suspense
      fallback={
        <main
          className="min-h-screen bg-bistro-page p-6 text-bistro-text-secondary"
          aria-busy="true"
        >
          Cargando vista previa…
        </main>
      }
    >
      <CookingIntentPreviewContent />
    </Suspense>
  );
}
