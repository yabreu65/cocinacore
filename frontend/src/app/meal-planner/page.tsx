'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { humanCopy } from '@/lib/copy';

const CUISINES = ['Venezolana', 'Colombiana', 'Latinoamericana', 'Asiática', 'Italiana', 'Mediterránea', 'Mexicana'];
const COUNTRIES = ['Venezuela', 'Colombia', 'México', 'Perú', 'Argentina', 'Japón', 'Tailandia', 'Italia', 'España'];

type ErrorPayload = { error?: string };

async function readErrorPayload(response: Response, fallback: string): Promise<ErrorPayload> {
  const payload: unknown = await response.json().catch(() => ({ error: fallback }));
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const maybeError = (payload as { error?: unknown }).error;
    return { error: typeof maybeError === 'string' ? maybeError : fallback };
  }
  return { error: fallback };
}

export default function MealPlannerPage() {
  const [mode, setMode] = useState<'inventory_to_menu' | 'menu_to_shopping'>('menu_to_shopping');
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [cuisine, setCuisine] = useState('Latinoamericana');
  const [country, setCountry] = useState('Venezuela');
  const [inventory, setInventory] = useState<string[]>([]);
  const [culinaryProfile, setCulinaryProfile] = useState<{
    preferred: string[];
    avoid: string[];
    goals: string[];
    level: string | null;
  }>({
    preferred: [],
    avoid: [],
    goals: [],
    level: null,
  });
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState('');

  useEffect(() => {
    const loadInventory = async () => {
      setLoadingInventory(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: queryErr } = await supabase
          .from('recipe_inventory_items')
          .select('ingredient_name')
          .order('created_at', { ascending: false })
          .limit(200);

        if (queryErr) throw queryErr;
        const items = (data ?? []).map((r) => r.ingredient_name).filter(Boolean);
        setInventory(items);

        const [{ data: profileRow }, { data: profileTermRows }] = await Promise.all([
          supabase.from('user_culinary_profiles').select('level').maybeSingle(),
          supabase.from('user_culinary_profile_terms').select('preference_type,term_id'),
        ]);

        const rows = (profileTermRows ?? []) as Array<{
          preference_type: 'identity' | 'prefer' | 'avoid' | 'goal';
          term_id: string;
        }>;
        const termIds = Array.from(new Set(rows.map((row) => row.term_id)));
        let termLabelById = new Map<string, string>();
        if (termIds.length > 0) {
          const { data: termRows } = await supabase
            .from('culinary_terms')
            .select('id,label')
            .in('id', termIds);
          termLabelById = new Map((termRows ?? []).map((row) => [row.id, row.label]));
        }
        const labelsByType = (type: 'identity' | 'prefer' | 'avoid' | 'goal') =>
          rows
            .filter((row) => row.preference_type === type)
            .map((row) => termLabelById.get(row.term_id) ?? null)
            .filter((label): label is string => Boolean(label));

        const preferred = labelsByType('prefer');
        const suggestedCuisine = preferred.find((term) => CUISINES.includes(term));
        if (suggestedCuisine) setCuisine(suggestedCuisine);

        setCulinaryProfile({
          preferred,
          avoid: labelsByType('avoid'),
          goals: labelsByType('goal'),
          level: profileRow?.level ?? null,
        });
      } catch {
        setInventory([]);
      } finally {
        setLoadingInventory(false);
      }
    };

    void loadInventory();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult('');

    try {
      const res = await fetch('/api/meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, period, cuisine, country, inventory, culinaryProfile }),
      });

      if (!res.ok) {
        const payload = await readErrorPayload(res, 'Error generando menú.');
        throw new Error(payload.error ?? 'Error generando menú.');
      }

      const payload = (await res.json()) as { content: string };
      setResult(payload.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando menú.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[#E8DDD2] bg-white/75 px-4 py-3">
          <div>
            <h1 className="text-2xl font-semibold">{humanCopy.mealPlannerTitle}</h1>
            <p className="text-sm text-[#6B5A50]">Creá menú semanal o mensual adaptado a tu cocina.</p>
          </div>
          <Link href="/app" className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/50">
            Volver al dashboard
          </Link>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4 rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
          <div className="grid gap-2">
            <p className="text-sm font-semibold text-[#6B5A50]">Modo</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode('inventory_to_menu')}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${mode === 'inventory_to_menu' ? 'border-[#6D4AFF]/45 bg-[#6D4AFF]/10 text-[#6D4AFF]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
              >
                Inventario → Menú
              </button>
              <button
                type="button"
                onClick={() => setMode('menu_to_shopping')}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${mode === 'menu_to_shopping' ? 'border-[#C56A1A]/45 bg-[#C56A1A]/10 text-[#A55412]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
              >
                Menú → Compras
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-semibold text-[#6B5A50]">Periodo</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPeriod('week')}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold ${period === 'week' ? 'border-[#567A3B]/45 bg-[#567A3B]/10 text-[#567A3B]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
                >
                  Semana
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('month')}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold ${period === 'month' ? 'border-[#567A3B]/45 bg-[#567A3B]/10 text-[#567A3B]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
                >
                  Mes
                </button>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-semibold text-[#6B5A50]">Cocina preferida</label>
              <select
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value)}
                className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none focus:border-[#6D4AFF]"
              >
                {CUISINES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-semibold text-[#6B5A50]">País (adaptación)</label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none focus:border-[#6D4AFF]"
            >
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <p className="rounded-xl border border-[#E8DDD2] bg-[#faf2e9] px-3 py-2 text-sm text-[#6B5A50]">
            {mode === 'inventory_to_menu'
              ? `Este modo usa SOLO inventario. ${loadingInventory ? 'Cargando inventario…' : `${inventory.length} ingrediente(s) detectado(s).`}`
              : 'Este modo arma menú y después te da lista de compras.'}
          </p>

          <div className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm text-[#6B5A50]">
            <p className="font-semibold text-[#241A14]">Perfil aplicado</p>
            <p className="mt-1">Preferencias: {culinaryProfile.preferred.length ? culinaryProfile.preferred.join(', ') : 'Sin preferencias'}</p>
            <p>Evitar: {culinaryProfile.avoid.length ? culinaryProfile.avoid.join(', ') : 'Sin restricciones'}</p>
            <p>Objetivos: {culinaryProfile.goals.length ? culinaryProfile.goals.join(', ') : 'Sin objetivos definidos'}</p>
          </div>

          <button
            type="submit"
            disabled={loading || (mode === 'inventory_to_menu' && !loadingInventory && inventory.length === 0)}
            className="h-12 rounded-2xl bg-[#C56A1A] px-5 font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60"
          >
            {loading ? 'Generando menú...' : 'Generar menú sugerido'}
          </button>
        </form>

        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        {result ? (
          <section className="mt-4 rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
            <h2 className="text-xl font-semibold">Menú generado</h2>
            <pre className="mt-3 whitespace-pre-wrap text-sm text-[#3d312a]">{result}</pre>
          </section>
        ) : null}
      </section>
    </main>
  );
}
