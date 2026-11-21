'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { safeFetch } from '@/lib/api';
import { serializeTodayHandoff } from '@/lib/recipes/today-handoff';
import TodayRecommendations, { type TodayOptionIntent } from './today-recommendations';
import MealPlanCoverageCard from './meal-plan-coverage-card';
import WastePreventionCard from './waste-prevention-card';
import { DashboardDailySnapshot } from './dashboard-daily-snapshot';
import {
  DashboardFirstRunActions,
  DashboardQuickActions,
  DashboardSetupPanel,
} from './dashboard-home-setup';

type DashboardData = {
  userId: string | null;
  fullName: string;
  onboardingCompleted: boolean;
  tenantId: string | null;
  tenantType: 'home' | 'professional';
  trialEndsAt: string | null;
  inventory: Array<{ id: string; name: string; quantity: string | null }>;
  hasSavedRecipes: boolean;
  recentRecipes: Array<{
    id: string;
    title: string;
    createdAt: string;
    feedback: 'accepted' | 'discarded' | null;
  }>;
  pdfCount: number;
  latestPdfs: unknown[];
  tenantBooks: Array<{ id: string; title: string }>;
  culinaryProfile: {
    level: string | null;
    identity: string[];
    preferred: string[];
    avoid: string[];
    goals: string[];
  };
  activity: string[];
};

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInsights, setShowInsights] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await safeFetch<DashboardData>('/api/dashboard', {
          credentials: 'same-origin',
        });
        if (!result.ok) throw new Error(result.error);
        setData(result.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleChooseTodayOption = (option: TodayOptionIntent) => {
    router.push(serializeTodayHandoff(option));
  };

  return (
    <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
      <section className="mx-auto w-full max-w-5xl">
        <header className="rounded-3xl bg-bistro-inverse px-5 py-6 text-bistro-cream shadow-sm sm:px-8 sm:py-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-bistro-champagne">
            Tu cocina, hoy
          </p>
          <h1 className="mt-2 font-bistro-heading text-3xl font-semibold leading-tight text-white sm:text-4xl">
            Hola, {data?.fullName || 'bienvenido'}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-bistro-cream sm:text-base">
            Encontrá qué cocinar y retomá tu organización desde un solo lugar.
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link
              href="/recipes/search"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-bistro-champagne px-5 py-3 text-sm font-bold text-bistro-text-primary transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Encontrar una receta
            </Link>
            <Link
              href="/meal-planner"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/40 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Organizar mi semana
            </Link>
          </div>
        </header>

        {loading ? <p className="mt-4 text-sm text-bistro-text-secondary">Cargando...</p> : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
            {error}
          </p>
        ) : null}

        {data ? (
          <>
            {!data.onboardingCompleted && data.inventory.length === 0 && !data.hasSavedRecipes ? (
              <DashboardFirstRunActions />
            ) : null}
            <DashboardSetupPanel
              onboardingCompleted={data.onboardingCompleted}
              hasIngredients={data.inventory.length > 0}
              hasRecipes={data.hasSavedRecipes}
              hasGeneratedIdeas={data.recentRecipes.length > 0}
            />
          </>
        ) : null}

        {data && (data.onboardingCompleted || data.inventory.length > 0 || data.hasSavedRecipes) ? (
          <DashboardDailySnapshot />
        ) : null}

        {data?.onboardingCompleted && data.inventory.length > 0 ? (
          <div className="mt-8">
            <h2 className="text-xl font-semibold text-bistro-text-primary">Tu cocina en marcha</h2>
            <p className="mt-1 text-sm text-bistro-text-secondary">
              Ideas, planificación y aprovechamiento a partir de tus datos.
            </p>
            <TodayRecommendations onChoose={handleChooseTodayOption} />
            <div className="mt-6">
              <button
                type="button"
                aria-expanded={showInsights}
                aria-controls="household-insights"
                onClick={() => setShowInsights((previous) => !previous)}
                className="min-h-11 rounded-xl border border-bistro-action-secondary px-4 py-2 text-sm font-semibold text-bistro-action-secondary hover:bg-bistro-surface-warm"
              >
                {showInsights ? 'Ocultar análisis de mi cocina' : 'Ver análisis de mi cocina'}
              </button>
              {showInsights ? (
                <div id="household-insights">
                  <MealPlanCoverageCard />
                  <WastePreventionCard />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {data ? <DashboardQuickActions /> : null}

        {data &&
        (data.onboardingCompleted || data.inventory.length > 0 || data.recentRecipes.length > 0) ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-bistro-border bg-white/80 p-4">
              <h2 className="font-semibold text-bistro-text-primary">Inventario reciente</h2>
              <ul className="mt-2 grid gap-1 text-sm">
                {data.inventory.length > 0 ? (
                  data.inventory.map((item) => (
                    <li key={item.id} className="text-bistro-text-secondary">
                      {item.name} {item.quantity ? `— ${item.quantity}` : ''}
                    </li>
                  ))
                ) : (
                  <li className="text-bistro-text-secondary">Sin ingredientes todavía.</li>
                )}
              </ul>
              <Link
                href="/recipes/inventory"
                className="mt-3 inline-block text-sm font-semibold text-bistro-action-primary"
              >
                Ver inventario
              </Link>
            </div>

            <div className="rounded-2xl border border-bistro-border bg-white/80 p-4">
              <h2 className="font-semibold text-bistro-text-primary">
                Ideas generadas recientemente
              </h2>
              <ul className="mt-2 grid gap-1 text-sm">
                {data.recentRecipes.length > 0 ? (
                  data.recentRecipes.map((recipe) => (
                    <li key={recipe.id} className="text-bistro-text-secondary">
                      {recipe.title}
                    </li>
                  ))
                ) : (
                  <li className="text-bistro-text-secondary">Sin recetas generadas.</li>
                )}
              </ul>
              <Link
                href={data.recentRecipes.length > 0 ? '/recipes/history' : '/recipes/search'}
                className="mt-3 inline-block text-sm font-semibold text-bistro-action-primary"
              >
                {data.recentRecipes.length > 0 ? 'Ver historial e importar' : 'Buscar una receta'}
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
