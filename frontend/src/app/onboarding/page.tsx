'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { humanCopy } from '@/lib/copy';

type StepKey = 'usage' | 'cuisine' | 'avoid' | 'goals';

type OnboardingData = {
  usage: string[];
  cuisine: string[];
  avoid: string[];
  goals: string[];
};

type PreferenceType = 'identity' | 'prefer' | 'avoid' | 'goal';

const STORAGE_KEY = 'cocinacore_onboarding_v1';

const step1 = ['Hogar', 'Chef', 'Familia', 'Estudiante culinario', 'Creador de recetas'];
const step2 = [
  'Italiana',
  'Latina',
  'Asiática',
  'Parrilla',
  'Postres',
  'Vegana',
  'Mediterránea',
  'Mexicana',
];
const step3 = ['Sin gluten', 'Sin lactosa', 'Vegano', 'Keto', 'Frutos secos', 'Mariscos'];
const step4 = [
  'Aprender cocina',
  'Organizar recetas',
  'Cocinar para mi familia',
  'Usar asistencia culinaria',
  'Guardar recetas familiares',
];

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
    subtitle: 'Elegí el perfil que mejor te representa para personalizar la experiencia.',
    options: step1,
    single: true,
  },
  {
    key: 'cuisine',
    title: '¿Qué tipo de cocina disfrutas más?',
    subtitle: 'Podés elegir varias. Esto mejora las recetas sugeridas para vos.',
    options: step2,
  },
  {
    key: 'avoid',
    title: '¿Hay algo que debamos evitar?',
    subtitle: 'Marcá restricciones o ingredientes a evitar en tus recomendaciones.',
    options: step3,
  },
  {
    key: 'goals',
    title: '¿Qué quieres lograr con CocinaCore?',
    subtitle: 'Definimos tus objetivos para guiarte mejor desde el dashboard.',
    options: step4,
  },
];

const initialData: OnboardingData = {
  usage: [],
  cuisine: [],
  avoid: [],
  goals: [],
};

const usageToTermLabel: Record<string, string> = {
  Hogar: 'Familiar',
  Chef: 'Chef',
  Familia: 'Familiar',
  'Estudiante culinario': 'Intermedio',
  'Creador de recetas': 'Gourmet',
};

const avoidToTermLabel: Record<string, string> = {
  'Sin gluten': 'Sin gluten',
  'Sin lactosa': 'Sin lactosa',
  Vegano: 'Vegana',
  Keto: 'Keto',
  'Frutos secos': 'Frutos secos',
  Mariscos: 'Mariscos',
};

const goalToTermLabel: Record<string, string> = {
  'Aprender cocina': 'Principiante',
  'Organizar recetas': 'Casera',
  'Cocinar para mi familia': 'Familiar',
  'Usar asistencia culinaria': 'Gourmet',
  'Guardar recetas familiares': 'Familiar',
};

function toggleValue(values: string[], option: string, single = false) {
  if (single) return [option];
  return values.includes(option) ? values.filter((v) => v !== option) : [...values, option];
}

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(initialData);
  const router = useRouter();
  const [isLoaded, setIsLoaded] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { currentStep: number; data: OnboardingData };
        if (parsed?.data) {
          setData(parsed.data);
          setCurrentStep(Math.min(Math.max(parsed.currentStep ?? 0, 0), 4));
        }
      }
    } catch {
      // ignore invalid storage
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentStep, data }));
  }, [currentStep, data, isLoaded]);

  const isFinal = currentStep === 4;
  const progress = useMemo(() => ((currentStep + 1) / 5) * 100, [currentStep]);

  const step = steps[currentStep];
  const selected = !isFinal ? data[step.key] : [];

  const canContinue = isFinal || selected.length > 0;

  const finishOnboarding = async () => {
    setFinishing(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userId) {
        const { data: profile } = await supabase
          .from('users')
          .select('tenant_id')
          .eq('id', userId)
          .maybeSingle();

        const tenantId = profile?.tenant_id ?? null;

        if (tenantId) {
          const preferenceMap: Array<{ label: string; type: PreferenceType }> = [
            ...data.usage.map((value) => ({
              label: usageToTermLabel[value],
              type: 'identity' as const,
            })),
            ...data.cuisine.map((value) => ({ label: value, type: 'prefer' as const })),
            ...data.avoid.map((value) => ({
              label: avoidToTermLabel[value],
              type: 'avoid' as const,
            })),
            ...data.goals.map((value) => ({
              label: goalToTermLabel[value],
              type: 'goal' as const,
            })),
          ].filter((item) => Boolean(item.label));

          const uniqueLabels = Array.from(new Set(preferenceMap.map((item) => item.label)));

          await supabase
            .from('user_culinary_profiles')
            .upsert({ user_id: userId, tenant_id: tenantId }, { onConflict: 'user_id' });

          if (uniqueLabels.length > 0) {
            const { data: termRows } = await supabase
              .from('culinary_terms')
              .select('id,label')
              .in('label', uniqueLabels);

            const labelToTermId = new Map((termRows ?? []).map((row) => [row.label, row.id]));

            await supabase.from('user_culinary_profile_terms').delete().eq('user_id', userId);

            const payload = preferenceMap
              .map((item) => ({
                user_id: userId,
                term_id: labelToTermId.get(item.label),
                preference_type: item.type,
                weight: 1,
              }))
              .filter(
                (
                  row
                ): row is {
                  user_id: string;
                  term_id: string;
                  preference_type: PreferenceType;
                  weight: number;
                } => typeof row.term_id === 'string' && row.term_id.length > 0
              );

            if (payload.length > 0) {
              await supabase.from('user_culinary_profile_terms').insert(payload);
            }
          }
        }

        await supabase.from('users').update({ onboarding_completed: true }).eq('id', userId);
      }
      localStorage.removeItem(STORAGE_KEY);
      router.push('/app');
      router.refresh();
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
          <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">
            COCINACORE • ONBOARDING
          </p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.08] text-[#241A14]">
            CocinaCore está entendiendo cómo cocinas para ayudarte mejor.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-[#6B5A50]">
            Tu configuración crea una biblioteca culinaria inteligente, cálida y personalizada para
            tu familia.
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
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-[#D6C3B2]">PDF culinario</p>
                <p className="text-sm font-semibold">Recetas familiares.pdf</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-[#D6C3B2]">Tip del chef</p>
                <p className="text-sm font-semibold">Mise en place antes de empezar</p>
              </div>
            </div>
          </div>
        </section>

        <section className="p-5 md:p-8 lg:p-10">
          <div className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#8D786A]">
                  Paso {Math.min(currentStep + 1, 5)} de 5
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
              {!isFinal ? (
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
                  <h2 className="text-3xl font-semibold text-[#241A14]">
                    Tu cocina inteligente está lista
                  </h2>
                  <p className="mt-2 text-[#6B5A50]">
                    CocinaCore ya puede ayudarte con recetas, organización culinaria y aprendizaje
                    personalizado.
                  </p>

                  <div className="mt-6 rounded-2xl border border-[#E8DDD2] bg-white/80 p-4 text-sm text-[#6B5A50]">
                    <p className="font-semibold text-[#241A14]">Resumen de tu perfil</p>
                    <p className="mt-2">Uso: {data.usage.join(', ') || 'No definido'}</p>
                    <p>Cocinas favoritas: {data.cuisine.join(', ') || 'No definido'}</p>
                    <p>Evitar: {data.avoid.join(', ') || 'No definido'}</p>
                    <p>Objetivos: {data.goals.join(', ') || 'No definido'}</p>
                  </div>
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
                Atrás
              </button>

              {!isFinal ? (
                <button
                  type="button"
                  onClick={() => setCurrentStep((prev) => Math.min(prev + 1, 4))}
                  disabled={!canContinue}
                  className="h-11 rounded-xl bg-[#C56A1A] px-5 font-semibold text-white transition hover:bg-[#A55412] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Siguiente
                </button>
              ) : (
                <button
                  type="button"
                  onClick={finishOnboarding}
                  disabled={finishing}
                  className="inline-flex h-11 items-center rounded-xl bg-[#C56A1A] px-5 font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60"
                >
                  {finishing ? 'Finalizando...' : 'Entrar al dashboard'}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
