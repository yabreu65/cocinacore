import Link from 'next/link';
import { BookOpen, Check, ChevronRight, Package } from 'lucide-react';

type SetupStep = {
  label: string;
  description: string;
  href: string;
  completed: boolean;
};

export interface HouseholdSetupState {
  onboardingCompleted: boolean;
  hasIngredients: boolean;
  hasRecipes: boolean;
  hasGeneratedIdeas?: boolean;
}

export function DashboardSetupPanel({
  onboardingCompleted,
  hasIngredients,
  hasRecipes,
  hasGeneratedIdeas = false,
}: HouseholdSetupState) {
  const steps: SetupStep[] = [
    {
      label: 'Completa tu perfil culinario',
      description: 'Contanos qué te gusta cocinar y qué alimentos debés evitar.',
      href: '/onboarding',
      completed: onboardingCompleted,
    },
    {
      label: 'Agrega tus primeros ingredientes',
      description: 'Registrá lo que tenés para organizar mejor tus comidas.',
      href: '/recipes/inventory',
      completed: hasIngredients,
    },
    {
      label: 'Guardá tu primera receta',
      description: hasGeneratedIdeas
        ? 'Ya generaste una idea. Abrí el historial para importarla a Mi recetario.'
        : 'Encontrá una idea con el asistente e importala a Mi recetario.',
      href: hasGeneratedIdeas ? '/recipes/history' : '/recipes/search',
      completed: hasRecipes,
    },
  ];
  const completedCount = steps.filter((step) => step.completed).length;
  if (completedCount === steps.length) return null;

  const nextStep = steps.find((step) => !step.completed);
  return (
    <section
      aria-labelledby="home-setup-title"
      className="mt-6 rounded-3xl border border-bistro-border bg-bistro-surface p-5 shadow-sm sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-bistro-action-secondary">
            Primeros pasos
          </p>
          <h2
            id="home-setup-title"
            className="mt-2 text-2xl font-semibold text-bistro-text-primary"
          >
            Prepara tu espacio de cocina
          </h2>
          <p className="mt-2 max-w-xl text-sm text-bistro-text-secondary">
            Organizá tu cocina a tu ritmo. Estos pasos te ayudarán a aprovechar las herramientas
            disponibles.
          </p>
        </div>
        <span className="rounded-full bg-bistro-surface-warm px-3 py-1 text-xs font-bold text-bistro-action-secondary">
          {completedCount} de {steps.length} pasos
        </span>
      </div>

      <div
        className="mt-5 h-2 overflow-hidden rounded-full bg-bistro-surface-warm"
        role="progressbar"
        aria-label="Progreso de configuración de tu cocina"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={completedCount}
      >
        <div
          className="h-full rounded-full bg-bistro-action-secondary transition-[width]"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-5 grid gap-3">
        {steps.map((step) => (
          <li key={step.href}>
            <Link
              href={step.href}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-bistro-border bg-bistro-page px-4 py-3 transition-colors hover:border-bistro-action-primary/50 hover:bg-bistro-surface-warm"
            >
              <span
                aria-hidden="true"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-bold ${
                  step.completed
                    ? 'border-bistro-action-secondary bg-bistro-action-secondary text-white'
                    : 'border-bistro-border bg-white text-bistro-action-primary'
                }`}
              >
                {step.completed ? <Check className="h-4 w-4" /> : steps.indexOf(step) + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-bistro-text-primary">
                  {step.label}
                </span>
                <span className="mt-0.5 block text-xs text-bistro-text-secondary">
                  {step.description}
                </span>
              </span>
              <span className="shrink-0 text-bistro-action-primary">
                <ChevronRight className="h-5 w-5" />
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {nextStep ? (
        <Link
          href={nextStep.href}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-bistro-action-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-bistro-action-primary-hover"
        >
          Continuar con mi cocina
          <ChevronRight className="ml-2 h-4 w-4" />
        </Link>
      ) : null}
    </section>
  );
}

const quickActions = [
  {
    label: 'Mis ingredientes',
    description: 'Registrá y consultá tu inventario.',
    href: '/recipes/inventory',
    icon: Package,
  },
  {
    label: 'Mis recetas',
    description: 'Consultá las preparaciones que guardaste.',
    href: '/recipes',
    icon: BookOpen,
  },
] as const;

export function DashboardQuickActions() {
  return (
    <section aria-labelledby="home-actions-title" className="mt-6">
      <h2 id="home-actions-title" className="text-xl font-semibold text-bistro-text-primary">
        Tu recetario e ingredientes
      </h2>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Todo lo que guardaste, siempre a mano.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {quickActions.map(({ label, description, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex min-h-28 flex-col rounded-2xl border border-bistro-border bg-white p-4 transition-colors hover:border-bistro-action-primary/50 hover:bg-bistro-surface-warm"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-bistro-surface-warm text-bistro-action-secondary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="mt-3 text-sm font-semibold text-bistro-text-primary">{label}</span>
            <span className="mt-1 hidden text-xs text-bistro-text-secondary sm:block">
              {description}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Choice, not a mandatory onboarding gate: one can cook first and organize later. */
export function DashboardFirstRunActions() {
  return (
    <section
      aria-label="Elige cómo comenzar"
      className="mt-5 rounded-2xl border border-bistro-border bg-bistro-surface px-5 py-4 sm:px-6"
    >
      <h2 className="text-xl font-semibold text-bistro-text-primary">
        ¿Qué te gustaría hacer hoy?
      </h2>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Podés empezar a cocinar sin completar la configuración. Tu cocina, a tu ritmo.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/recipes/search"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bistro-action-primary px-5 py-3 text-sm font-semibold text-white hover:bg-bistro-action-primary-hover"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          Quiero cocinar ahora
        </Link>
        <Link
          href="/onboarding"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-bistro-action-secondary px-5 py-3 text-sm font-semibold text-bistro-action-secondary hover:bg-bistro-surface-warm"
        >
          <Package className="h-4 w-4" aria-hidden="true" />
          Quiero organizar mi cocina
        </Link>
      </div>
    </section>
  );
}
