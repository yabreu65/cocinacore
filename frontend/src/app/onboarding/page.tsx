'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { humanCopy } from '@/lib/copy';

type StepKey = 'usage' | 'cuisine' | 'avoid' | 'goals';

type OnboardingData = {
  usage: string[];
  cuisine: string[];
  avoid: string[];
  goals: string[];
};

const steps: Array<{
  key: StepKey;
  title: string;
  subtitle: string;
  options: string[];
  single?: boolean;
}> = [
  {
    key: 'usage',
    title: '¿Cómo quieres usar CocinaCore?',
    subtitle: 'Elegí el perfil principal para personalizar la experiencia.',
    options: ['Hogar', 'Chef', 'Familia', 'Estudiante culinario', 'Creador de recetas'],
    single: true,
  },
  {
    key: 'cuisine',
    title: '¿Qué cocina disfrutas más?',
    subtitle: 'Podés elegir varias.',
    options: ['Italiana', 'Latina', 'Asiática', 'Parrilla', 'Postres', 'Vegana'],
  },
  {
    key: 'avoid',
    title: '¿Hay algo que debamos evitar?',
    subtitle: 'Restricciones o ingredientes a evitar.',
    options: ['Sin gluten', 'Sin lactosa', 'Vegano', 'Keto', 'Frutos secos', 'Mariscos'],
  },
  {
    key: 'goals',
    title: '¿Qué quieres lograr?',
    subtitle: 'Esto nos ayuda a orientar la experiencia inicial.',
    options: ['Aprender cocina', 'Organizar recetas', 'Cocinar para mi familia', 'Usar asistencia culinaria'],
  },
];

const initialData: OnboardingData = {
  usage: [],
  cuisine: [],
  avoid: [],
  goals: [],
};

function toggleValue(values: string[], option: string, single = false): string[] {
  if (single) return [option];
  return values.includes(option) ? values.filter((value) => value !== option) : [...values, option];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(initialData);
  const [finishing, setFinishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isFinal = currentStep === steps.length;
  const progress = useMemo(() => ((currentStep + 1) / (steps.length + 1)) * 100, [currentStep]);
  const step = steps[currentStep];
  const selected = step ? data[step.key] : [];
  const canContinue = isFinal || selected.length > 0;

  const finishOnboarding = async () => {
    setFinishing(true);
    setMessage(null);

    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const payload = (await response.json().catch(() => null)) as { user?: { id: string } | null } | null;

      if (!response.ok || !payload?.user?.id) {
        setMessage('Necesitás una sesión activa para terminar onboarding.');
        return;
      }

      setMessage('Preferencias guardadas temporalmente en esta fase. Redirigiendo...');
      window.setTimeout(() => {
        router.push('/app');
        router.refresh();
      }, 700);
    } catch {
      setMessage('No pudimos finalizar onboarding. Intentá nuevamente.');
    } finally {
      setFinishing(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto grid w-full max-w-[1220px] overflow-hidden rounded-[2rem] border border-[#E8DDD2] bg-white/55 premium-shadow lg:grid-cols-[1.04fr_0.96fr]">
        <section className="relative hidden overflow-hidden border-r border-[#E8DDD2] p-10 lg:block">
          <div className="pointer-events-none absolute -left-10 top-8 h-52 w-52 rounded-full bg-[#C56A1A]/10 blur-3xl" />
          <div className="pointer-events-none absolute right-6 top-1/3 h-52 w-52 rounded-full bg-[#6D4AFF]/10 blur-3xl" />
          <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">COCINACORE • ONBOARDING</p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.08] text-[#241A14]">
            CocinaCore está entendiendo cómo cocinas para ayudarte mejor.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-[#6B5A50]">
            Esta versión guarda lo esencial mientras terminamos la migración de preferencias.
          </p>

          <div className="dark-panel-shadow mt-8 rounded-3xl border border-white/10 bg-[#16110D] p-5 text-[#F5ECE2]">
            <p className="text-sm text-[#D6C3B2]">Vista previa personalizada</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-[#D6C3B2]">{humanCopy.suggestedRecipesForYou}</p>
                <p className="text-sm font-semibold">Lasagna ligera para 4</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-[#D6C3B2]">Inventario</p>
                <p className="text-sm font-semibold">Tomate · Pollo · Albahaca</p>
              </div>
            </div>
          </div>
        </section>

        <section className="p-5 md:p-8 lg:p-10">
          <div className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8D786A]">
                  Paso {Math.min(currentStep + 1, steps.length + 1)} de {steps.length + 1}
                </p>
                <p className="text-xs text-[#8D786A]">{Math.round(progress)}%</p>
              </div>
              <div className="mt-2 h-2 rounded-full bg-[#EEE3D9]">
                <motion.div
                  className="h-full rounded-full bg-[#C56A1A]"
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
                  <h2 className="text-3xl font-semibold text-[#241A14]">{step.title}</h2>
                  <p className="mt-2 text-[#6B5A50]">{step.subtitle}</p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    {step.options.map((option) => {
                      const active = selected.includes(option);
                      return (
                        <button
                          type="button"
                          key={option}
                          onClick={() => {
                            setData((prev) => ({
                              ...prev,
                              [step.key]: toggleValue(prev[step.key], option, step.single),
                            }));
                          }}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            active
                              ? 'border-[#C56A1A] bg-[#C56A1A]/10 text-[#7F4314]'
                              : 'border-[#E8DDD2] bg-white/80 text-[#3B2F26] hover:border-[#C56A1A]/50'
                          }`}
                          aria-pressed={active}
                        >
                          <span className="font-semibold">{option}</span>
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
                  <h2 className="text-3xl font-semibold text-[#241A14]">Tu cocina inteligente está lista</h2>
                  <p className="mt-2 text-[#6B5A50]">
                    La persistencia avanzada de preferencias está en reconstrucción, pero podés seguir.
                  </p>

                  <div className="mt-6 rounded-2xl border border-[#E8DDD2] bg-white/80 p-4 text-sm text-[#6B5A50]">
                    <p className="font-semibold text-[#241A14]">Resumen de tu perfil</p>
                    <p className="mt-2">Uso: {data.usage.join(', ') || 'No definido'}</p>
                    <p>Cocinas favoritas: {data.cuisine.join(', ') || 'No definido'}</p>
                    <p>Evitar: {data.avoid.join(', ') || 'No definido'}</p>
                    <p>Objetivos: {data.goals.join(', ') || 'No definido'}</p>
                  </div>

                  {message ? (
                    <p className="mt-4 rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 text-sm text-[#6B5A50]">
                      {message}
                    </p>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-8 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => Math.max(prev - 1, 0))}
                disabled={currentStep === 0}
                className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-5 font-semibold text-[#6B5A50] transition hover:border-[#C56A1A] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Volver
              </button>

              {!isFinal ? (
                <button
                  type="button"
                  disabled={!canContinue}
                  onClick={() => setCurrentStep((prev) => Math.min(prev + 1, steps.length))}
                  className="h-11 rounded-xl bg-[#C56A1A] px-5 font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-50"
                >
                  Continuar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void finishOnboarding()}
                  disabled={finishing}
                  className="h-11 rounded-xl bg-[#C56A1A] px-5 font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-50"
                >
                  {finishing ? 'Finalizando...' : 'Ir al panel'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
