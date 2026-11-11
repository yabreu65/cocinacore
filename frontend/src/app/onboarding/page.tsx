'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { safeFetch } from '@/lib/api';
import { humanCopy } from '@/lib/copy';
import { canAdvanceOnboardingStep } from './onboarding-step';
import {
  EMPTY_CULINARY_SELECTIONS,
  termsForDimension,
  type CulinaryProfileApiData,
  type CulinaryProfileTerm,
  type CulinarySelections,
} from '@/lib/profile/culinary-profile-contract';

type StepKey = 'level' | 'cuisine' | 'dietary' | 'goal';

type Step = {
  key: StepKey;
  title: string;
  subtitle: string;
  options: Array<{ id: string; label: string }>;
  max: number;
  single?: boolean;
};

const LEVEL_OPTIONS = [
  { id: 'Principiante', label: 'Principiante' },
  { id: 'Intermedio', label: 'Intermedio' },
  { id: 'Chef', label: 'Chef' },
];

function toggleValue(values: string[], option: string, max: number, single = false): string[] {
  if (single) return [option];
  if (values.includes(option)) return values.filter((value) => value !== option);
  if (values.length >= max) return values;
  return [...values, option];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [profileData, setProfileData] = useState<CulinaryProfileApiData | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [level, setLevel] = useState('');
  const [selections, setSelections] = useState<CulinarySelections>(EMPTY_CULINARY_SELECTIONS);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await safeFetch<CulinaryProfileApiData>('/api/profile', {
          credentials: 'same-origin',
        });
        if (!result.ok) throw new Error(result.error);

        setProfileData(result.data);
        setLevel(result.data.profile?.level ?? '');
        setSelections(result.data.selections);
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : 'No pudimos cargar tu perfil culinario.'
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const steps = useMemo<Step[]>(() => {
    if (!profileData) return [];

    return [
      {
        key: 'level',
        title: '¿Cómo te sientes cocinando?',
        subtitle: 'Esto ajusta la complejidad y el nivel de detalle de las recetas.',
        options: LEVEL_OPTIONS,
        max: 1,
        single: true,
      },
      {
        key: 'cuisine',
        title: '¿Qué cocinas disfrutas más?',
        subtitle: 'Elegí hasta seis. Las priorizaremos cuando encajen con tu inventario.',
        options: termsForDimension(profileData, 'cuisine').map((term) => ({
          id: term.id,
          label: term.label,
        })),
        max: 6,
      },
      {
        key: 'dietary',
        title: '¿Qué debemos evitar o respetar?',
        subtitle: 'Estas restricciones quedan guardadas y forman parte de tu contexto culinario.',
        options: termsForDimension(profileData, 'dietary').map((term) => ({
          id: term.id,
          label: term.label,
        })),
        max: 12,
      },
      {
        key: 'goal',
        title: '¿Qué quieres optimizar?',
        subtitle: 'Tus objetivos ayudan a CocinaCore a decidir qué propuestas tienen más sentido.',
        options: termsForDimension(profileData, 'goal').map((term) => ({
          id: term.id,
          label: term.label,
        })),
        max: 6,
      },
    ];
  }, [profileData]);

  const isFinal = currentStep === steps.length && steps.length > 0;
  const step = steps[currentStep];

  const selectedForStep = useMemo(() => {
    if (!step) return [];
    if (step.key === 'level') return level ? [level] : [];
    if (step.key === 'cuisine') return selections.favoriteCuisineTermIds;
    if (step.key === 'dietary') return selections.dietaryAvoidTermIds;
    return selections.goalTermIds;
  }, [level, selections, step]);

  const canContinue = isFinal || canAdvanceOnboardingStep(step, selectedForStep.length);
  const progress =
    steps.length > 0 ? ((Math.min(currentStep, steps.length) + 1) / (steps.length + 1)) * 100 : 0;

  const selectOption = (optionId: string) => {
    if (!step) return;

    if (step.key === 'level') {
      setLevel(optionId);
      return;
    }

    const key =
      step.key === 'cuisine'
        ? 'favoriteCuisineTermIds'
        : step.key === 'dietary'
          ? 'dietaryAvoidTermIds'
          : 'goalTermIds';

    setSelections((current) => ({
      ...current,
      [key]: toggleValue(current[key], optionId, step.max, step.single),
    }));
  };

  const termLabel = (termId: string): string => {
    return (
      profileData?.taxonomy.terms.find((term: CulinaryProfileTerm) => term.id === termId)?.label ??
      termId
    );
  };

  const finishOnboarding = async () => {
    setFinishing(true);
    setMessage(null);

    try {
      const result = await safeFetch<{
        profile: CulinaryProfileApiData['profile'];
        selections: CulinarySelections;
      }>('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          level: level || null,
          selections,
          onboardingCompleted: true,
        }),
      });

      if (!result.ok) throw new Error(result.error);

      setMessage('Perfil culinario guardado. CocinaCore ya puede usarlo para ayudarte.');
      window.setTimeout(() => {
        router.replace('/app');
        router.refresh();
      }, 600);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No pudimos finalizar onboarding.');
    } finally {
      setFinishing(false);
    }
  };

  if (loading) {
    return (
      <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary">
        <div className="mx-auto max-w-3xl rounded-3xl border border-bistro-border bg-white/70 p-6">
          Cargando tu perfil culinario...
        </div>
      </main>
    );
  }

  if (loadError || !profileData) {
    return (
      <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary">
        <div className="mx-auto max-w-3xl rounded-3xl border border-bistro-danger/30 bg-bistro-danger/10 p-6 text-bistro-danger">
          {loadError ?? 'No pudimos cargar tu perfil culinario.'}
        </div>
      </main>
    );
  }

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto grid w-full max-w-[1220px] overflow-hidden rounded-[2rem] border border-bistro-border bg-white/55 premium-shadow lg:grid-cols-[1.04fr_0.96fr]">
        <section className="relative hidden overflow-hidden border-r border-bistro-border p-10 lg:block">
          <div className="pointer-events-none absolute -left-10 top-8 h-52 w-52 rounded-full bg-bistro-action-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute right-6 top-1/3 h-52 w-52 rounded-full bg-bistro-action-secondary/10 blur-3xl" />
          <p className="text-xs font-bold tracking-[0.15em] text-bistro-action-primary">
            COCINACORE • ONBOARDING
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.08] text-bistro-text-primary">
            CocinaCore aprende cómo cocinas para decidir mejor contigo.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-bistro-text-secondary">
            Lo que elijas se guarda en tu perfil real y se reutiliza en recetas y planificación.
          </p>

          <div className="dark-panel-shadow mt-8 rounded-3xl border border-white/10 bg-bistro-inverse p-5 text-bistro-cream">
            <p className="text-sm text-bistro-champagne">Vista previa personalizada</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-bistro-champagne">{humanCopy.suggestedRecipesForYou}</p>
                <p className="text-sm font-semibold">Ideas según inventario + perfil</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-bistro-champagne">Contexto persistido</p>
                <p className="text-sm font-semibold">Gustos · restricciones · objetivos</p>
              </div>
            </div>
          </div>
        </section>

        <section className="p-5 md:p-8 lg:p-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link
              href="/app"
              className="font-semibold text-bistro-text-secondary underline underline-offset-4 hover:text-bistro-action-primary"
            >
              Volver a Inicio
            </Link>
            <Link
              href="/recipes/search"
              className="font-semibold text-bistro-action-primary underline underline-offset-4"
            >
              Prefiero cocinar ahora
            </Link>
          </div>
          <div className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-bistro-text-secondary">
                  Paso {Math.min(currentStep + 1, steps.length + 1)} de {steps.length + 1}
                </p>
                <p className="text-xs text-bistro-text-secondary">{Math.round(progress)}%</p>
              </div>
              <div className="mt-2 h-2 rounded-full bg-bistro-surface-warm">
                <motion.div
                  className="h-full rounded-full bg-bistro-action-primary"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.25 }}
                />
              </div>
            </div>

            <AnimatePresence mode="wait">
              {!isFinal && step ? (
                <motion.div
                  key={step.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="text-3xl font-semibold text-bistro-text-primary">{step.title}</h2>
                  <p className="mt-2 text-bistro-text-secondary">{step.subtitle}</p>

                  {step.options.length === 0 ? (
                    <p
                      role="status"
                      className="mt-6 rounded-xl border border-bistro-border bg-white/80 p-4 text-bistro-text-secondary"
                    >
                      No hay opciones disponibles para este paso. Puedes continuar sin seleccionar
                      ninguna.
                    </p>
                  ) : null}
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {step.options.map((option) => {
                      const active = selectedForStep.includes(option.id);
                      const disabled =
                        !step.single && !active && selectedForStep.length >= step.max;
                      return (
                        <button
                          type="button"
                          key={option.id}
                          disabled={disabled}
                          onClick={() => selectOption(option.id)}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            active
                              ? 'border-bistro-action-primary bg-bistro-action-primary/10 text-bistro-action-primary'
                              : 'border-bistro-border bg-white/80 text-bistro-text-primary hover:border-bistro-action-primary/50 disabled:opacity-40'
                          }`}
                          aria-pressed={active}
                        >
                          <span className="font-semibold">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="final"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2 }}
                >
                  <h2 className="text-3xl font-semibold text-bistro-text-primary">
                    Tu perfil culinario está listo
                  </h2>
                  <p className="mt-2 text-bistro-text-secondary">
                    Lo guardaremos como contexto persistente para recetas y planificación.
                  </p>

                  <div className="mt-6 rounded-2xl border border-bistro-border bg-white/80 p-4 text-sm text-bistro-text-secondary">
                    <p className="font-semibold text-bistro-text-primary">Resumen</p>
                    <p className="mt-2">Nivel: {level || 'No definido'}</p>
                    <p>
                      Cocinas:{' '}
                      {selections.favoriteCuisineTermIds.map(termLabel).join(', ') || 'No definido'}
                    </p>
                    <p>
                      Restricciones:{' '}
                      {selections.dietaryAvoidTermIds.map(termLabel).join(', ') || 'No definido'}
                    </p>
                    <p>
                      Objetivos: {selections.goalTermIds.map(termLabel).join(', ') || 'No definido'}
                    </p>
                  </div>

                  {message ? (
                    <p className="mt-4 rounded-xl border border-bistro-border bg-white/80 px-3 py-2 text-sm text-bistro-text-secondary">
                      {message}
                    </p>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setCurrentStep((current) => Math.max(current - 1, 0))}
                disabled={currentStep === 0 || finishing}
                className="h-11 rounded-xl border border-bistro-border bg-white px-5 font-semibold text-bistro-text-secondary transition hover:border-bistro-action-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Volver
              </button>

              {!isFinal ? (
                <button
                  type="button"
                  disabled={!canContinue}
                  onClick={() => setCurrentStep((current) => Math.min(current + 1, steps.length))}
                  className="h-11 rounded-xl bg-bistro-action-primary px-5 font-semibold text-white transition hover:bg-bistro-action-primary disabled:opacity-50"
                >
                  Continuar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void finishOnboarding()}
                  disabled={finishing}
                  className="h-11 rounded-xl bg-bistro-action-primary px-5 font-semibold text-white transition hover:bg-bistro-action-primary disabled:opacity-50"
                >
                  {finishing ? 'Guardando...' : 'Guardar e ir al panel'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
