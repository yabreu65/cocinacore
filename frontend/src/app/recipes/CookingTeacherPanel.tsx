'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { safeFetch } from '@/lib/api';

type TeacherResponse = {
  kind: 'explanation' | 'clarification' | 'safe_refusal' | 'provider_unavailable';
  answer: string;
  evidence: 'supported' | 'partial' | 'unknown' | 'unavailable';
  citations: Array<{ title: string; page: number | null }>;
  limitations: string[];
  sessionMutation: 'none';
};

type Props = { sessionId: string };

export async function requestCookingTeacher(
  sessionId: string,
  question: string,
  signal?: AbortSignal
): Promise<{ response: TeacherResponse } | { error: string }> {
  try {
    const result = await safeFetch<{ response: TeacherResponse }>(
      `/api/cooking-sessions/${encodeURIComponent(sessionId)}/teacher`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
        signal,
      }
    );
    return result.ok ? result.data : { error: result.error };
  } catch {
    return { error: 'No se pudo consultar al profesor. Intentá nuevamente.' };
  }
}

const suggestedQuestions = [
  'Explicame la técnica de este paso.',
  '¿Qué señales debería observar?',
  '¿Por qué importa este orden?',
];

const evidenceCopy: Record<TeacherResponse['evidence'], string> = {
  supported: 'Con respaldo en fuentes autorizadas',
  partial: 'Explicación parcial; revisá las limitaciones',
  unknown: 'Evidencia insuficiente',
  unavailable: 'Proveedor no disponible',
};

export default function CookingTeacherPanel({ sessionId }: Props) {
  const instanceId = useId().replace(/:/g, '');
  const headingId = `cooking-teacher-heading-${instanceId}`;
  const questionId = `cooking-teacher-question-${sessionId}-${instanceId}`;
  const requestController = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<TeacherResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [feedback, setFeedback] = useState<'helpful' | 'not_helpful' | null>(null);

  const ask = async (value = question) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setLoading(true);
    setError('');
    setResponse(null);
    setFeedback(null);
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    try {
      const result = await requestCookingTeacher(sessionId, trimmed, controller.signal);
      if ('response' in result) setResponse(result.response);
      else if (!controller.signal.aborted) setError(result.error);
    } finally {
      if (requestController.current === controller) requestController.current = null;
      setLoading(false);
    }
  };

  useEffect(() => () => requestController.current?.abort(), []);

  if (hidden) {
    return (
      <button
        type="button"
        className="rounded-xl border border-bistro-border bg-white px-3 py-2 text-sm font-semibold"
        onClick={() => setHidden(false)}
      >
        Mostrar profesor
      </button>
    );
  }

  return (
    <section
      className="grid gap-3 rounded-xl border border-bistro-border bg-white p-3"
      aria-labelledby={headingId}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="font-semibold">
            Profesor de cocina
          </h3>
          <p className="text-sm text-bistro-text-secondary">
            Explicaciones sobre el paso actual. No modifica tu sesión, inventario ni receta.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border px-2 py-1 text-xs"
          onClick={() => setHidden(true)}
          aria-label="Ocultar profesor de cocina"
        >
          Ocultar
        </button>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Preguntas sugeridas">
        {suggestedQuestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="rounded-full border border-bistro-border px-3 py-1 text-left text-xs"
            disabled={loading}
            onClick={() => void ask(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label className="sr-only" htmlFor={questionId}>
          Pregunta sobre el paso actual
        </label>
        <input
          id={questionId}
          className="rounded-xl border border-bistro-border px-3 py-2 text-sm"
          value={question}
          maxLength={1000}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Escribí una duda sobre este paso"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="rounded-xl bg-bistro-action-secondary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Consultando…' : 'Preguntar'}
        </button>
      </form>
      {loading && <p role="status">Preparando una explicación segura…</p>}
      {error && <p role="alert">{error}</p>}
      {response && (
        <div className="grid gap-2 rounded-xl bg-bistro-surface-warm p-3" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-bistro-action-secondary">
            {evidenceCopy[response.evidence]}
          </p>
          <p className="text-sm">{response.answer}</p>
          {response.citations.length > 0 && (
            <ul
              className="text-xs text-bistro-text-secondary"
              aria-label="Fuentes de la explicación"
            >
              {response.citations.map((citation, index) => (
                <li key={`${citation.title}:${citation.page ?? 'unknown'}:${index}`}>
                  {citation.title}
                  {citation.page ? ` · página ${citation.page}` : ''}
                </li>
              ))}
            </ul>
          )}
          {response.limitations.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-bistro-warning" aria-label="Limitaciones">
              {response.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>¿Te resultó útil?</span>
            <button
              type="button"
              className="rounded border px-2 py-1"
              aria-pressed={feedback === 'helpful'}
              onClick={() => setFeedback('helpful')}
            >
              Sí
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1"
              aria-pressed={feedback === 'not_helpful'}
              onClick={() => setFeedback('not_helpful')}
            >
              No
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
