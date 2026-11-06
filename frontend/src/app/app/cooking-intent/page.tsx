'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { safeFetch } from '@/lib/api';
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

export default function CookingIntentPreviewPage() {
  const params = useSearchParams();
  const [preview, setPreview] = useState<CookingIntentPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const query = params.toString();
    setLoading(true);
    setError('');
    void safeFetch<PreviewResponse>(`/api/cooking-intent-preview?${query}`, {
      credentials: 'same-origin',
    })
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPreview(result.data.preview);
      })
      .catch(() => setError('No se pudo cargar la vista previa.'))
      .finally(() => setLoading(false));
  }, [params]);

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
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/85 p-5 premium-shadow">
        <header className="border-b border-[#E8DDD2] pb-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#8C4712]">
            Vista previa
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            {preview.title || 'Preparación seleccionada'}
          </h1>
          <p className="mt-2" role="status">
            {statusCopy[preview.status]}
          </p>
          <p className="mt-1 text-sm text-[#6B5A50]">
            {preview.portions.requested ?? '—'} porciones · Solo lectura: no se modificó tu
            inventario ni tu menú.
          </p>
        </header>

        {preview.restrictions.status !== 'clear' && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alert">
            <strong>Revisá las restricciones antes de cocinar.</strong>
            <p className="mt-1 text-sm">{preview.restrictions.reasons.join(', ')}</p>
          </div>
        )}

        <section className="mt-5" aria-labelledby="ingredients-heading">
          <h2 id="ingredients-heading" className="text-xl font-semibold">
            Ingredientes y evidencia
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {preview.ingredients.map((ingredient) => (
              <li
                key={`${ingredient.name}-${ingredient.requiredUnit}`}
                className="rounded-2xl border border-[#E8DDD2] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <strong>{ingredient.name}</strong>
                  <span className="rounded-full bg-[#F4E8DD] px-2 py-1 text-xs">
                    {availabilityCopy[ingredient.availability]}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[#6B5A50]">
                  Requerido: {ingredient.requiredQuantity ?? '—'}{' '}
                  {ingredient.requiredUnit === 'unknown' ? '' : ingredient.requiredUnit}
                </p>
                <p className="text-sm text-[#6B5A50]">
                  Disponible: {ingredient.availableQuantity ?? '—'}{' '}
                  {ingredient.availableUnit === 'unknown' ? '' : ingredient.availableUnit}
                </p>
                <p className="text-sm text-[#6B5A50]">Vencimiento: {ingredient.expiry}</p>
                {ingredient.evidence !== 'verified' && (
                  <p className="mt-1 text-xs text-amber-800">Evidencia: {ingredient.evidence}</p>
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
            <p className="mt-2 text-sm text-[#6B5A50]">
              No hay instrucciones estructuradas disponibles.
            </p>
          ) : (
            <ol className="mt-3 grid gap-2">
              {preview.steps.map((step) => (
                <li key={step.index} className="rounded-xl bg-[#FAF6F1] p-3">
                  <strong>{step.title}</strong>
                  <p className="mt-1 text-sm">{step.instruction}</p>
                </li>
              ))}
            </ol>
          )}
        </section>

        {preview.limitations.length > 0 && (
          <section
            className="mt-5 rounded-2xl border border-[#E8DDD2] bg-[#FAF6F1] p-4"
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
