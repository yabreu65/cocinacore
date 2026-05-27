'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { humanCopy } from '@/lib/copy';

type HistoryRow = {
  id: string;
  recipe_title: string | null;
  recipe_payload: unknown;
  user_feedback: 'accepted' | 'discarded' | null;
  created_at: string;
};

function toPrettyPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.full_recipe === 'string' && obj.full_recipe.trim().length > 0) {
      return obj.full_recipe;
    }

    const title = typeof obj.title === 'string' ? obj.title : null;
    const summary = typeof obj.summary === 'string' ? obj.summary : null;
    const ingredients = Array.isArray(obj.ingredients) ? obj.ingredients.filter((item): item is string => typeof item === 'string') : [];
    const steps = Array.isArray(obj.steps) ? obj.steps.filter((item): item is string => typeof item === 'string') : [];
    const tips = Array.isArray(obj.tips) ? obj.tips.filter((item): item is string => typeof item === 'string') : [];

    const blocks: string[] = [];
    if (title) blocks.push(`# ${title}`);
    if (summary) blocks.push(summary);
    if (ingredients.length > 0) {
      blocks.push('## Ingredientes');
      blocks.push(...ingredients.map((item) => `- ${item}`));
    }
    if (steps.length > 0) {
      blocks.push('## Preparación');
      blocks.push(...steps.map((item, index) => `${index + 1}. ${item}`));
    }
    if (tips.length > 0) {
      blocks.push('## Tips');
      blocks.push(...tips.map((item) => `- ${item}`));
    }

    if (blocks.length > 0) return blocks.join('\n');
    return JSON.stringify(payload, null, 2);
  }
  return 'Sin detalle disponible.';
}

export default function RecipeHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedbackWorkingId, setFeedbackWorkingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: queryErr } = await supabase
          .from('recipe_ai_history')
          .select('id,recipe_title,recipe_payload,user_feedback,created_at')
          .order('created_at', { ascending: false })
          .limit(30);

        if (queryErr) throw queryErr;
        setRows((data ?? []) as HistoryRow[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo cargar historial.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const deleteHistoryItem = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: deleteErr } = await supabase.from('recipe_ai_history').delete().eq('id', id);
      if (deleteErr) throw deleteErr;
      setRows((prev) => prev.filter((row) => row.id !== id));
      if (openId === id) setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar la receta.');
    } finally {
      setDeletingId(null);
    }
  };

  const setFeedback = async (id: string, value: 'accepted' | 'discarded') => {
    setFeedbackWorkingId(id);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateErr } = await supabase
        .from('recipe_ai_history')
        .update({ user_feedback: value, user_feedback_at: new Date().toISOString() })
        .eq('id', id);
      if (updateErr) throw updateErr;
      setRows((prev) => prev.map((row) => (row.id === id ? { ...row, user_feedback: value } : row)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar feedback.');
    } finally {
      setFeedbackWorkingId(null);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <h1 className="text-3xl font-semibold">Historial de recetas</h1>
        <p className="mt-1 text-[#6B5A50]">Recetas sugeridas para tu usuario y tenant.</p>

        {loading ? <p className="mt-4 text-sm text-[#6B5A50]">Cargando historial...</p> : null}
        {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {!loading && rows.length === 0 ? <p className="mt-4 text-sm text-[#6B5A50]">Aún no tienes recetas guardadas.</p> : null}

        <ul className="mt-4 grid gap-3">
          {rows.map((entry) => {
            const isOpen = openId === entry.id;
            return (
              <li key={entry.id} className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-[#3B2F26]">
                    <span className="font-semibold">{entry.recipe_title ?? humanCopy.suggestedRecipesForYou}</span> — {new Date(entry.created_at).toLocaleString()}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void setFeedback(entry.id, 'accepted')}
                      disabled={feedbackWorkingId === entry.id}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${entry.user_feedback === 'accepted' ? 'border-[#567A3B]/40 bg-[#567A3B]/10 text-[#567A3B]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
                    >
                      Me gustó
                    </button>
                    <button
                      type="button"
                      onClick={() => void setFeedback(entry.id, 'discarded')}
                      disabled={feedbackWorkingId === entry.id}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${entry.user_feedback === 'discarded' ? 'border-red-300 bg-red-50 text-red-700' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
                    >
                      No me gustó
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : entry.id)}
                      className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-1.5 text-sm font-semibold text-[#6B5A50]"
                    >
                      {isOpen ? 'Ocultar' : 'Ver detalle'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteHistoryItem(entry.id)}
                      disabled={deletingId === entry.id}
                      className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-70"
                    >
                      {deletingId === entry.id ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </div>
                </div>
                {isOpen ? (
                  <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-[#E8DDD2] bg-[#faf7f3] p-3 text-sm text-[#3B2F26]">
                    {toPrettyPayload(entry.recipe_payload)}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="mt-4">
          <Link href="/recipes/search" className="text-sm font-semibold text-[#A55412] hover:text-[#C56A1A]">
            Ir a búsqueda de recetas
          </Link>
        </div>
      </section>
    </main>
  );
}
