import Link from 'next/link';
import { BookOpen, CalendarDays, ShoppingBasket } from 'lucide-react';

const benefits = [
  {
    icon: BookOpen,
    title: 'Recetas en un solo lugar',
    detail: 'Conservá y encontrá tus preparaciones.',
  },
  { icon: CalendarDays, title: 'Tu menú más claro', detail: 'Organizá las comidas de la semana.' },
  {
    icon: ShoppingBasket,
    title: 'Compras e ingredientes',
    detail: 'Consultá tu lista y lo que hay en casa.',
  },
];

/** Presentational only. No account state, authentication logic, or sample user data. */
export function AuthBenefitsPanel({ mode }: { mode: 'login' | 'signup' }) {
  const signup = mode === 'signup';

  return (
    <aside className="relative hidden min-w-0 flex-col justify-between overflow-hidden bg-bistro-inverse p-8 text-white lg:flex lg:p-10 xl:p-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-20 h-80 w-80 rounded-full bg-bistro-champagne/10 blur-3xl"
      />
      <Link
        href="/"
        className="relative inline-flex w-fit items-center gap-3 rounded-xl text-sm font-bold tracking-[0.08em] text-bistro-champagne hover:text-white"
      >
        <span
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/25 text-xl"
          aria-hidden="true"
        >
          ✳
        </span>
        COCINACORE BISTRÓ
      </Link>
      <div className="relative my-10">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-bistro-champagne">
          TU COCINA, A TU MANERA
        </p>
        <h2 className="mt-4 font-bistro-heading text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
          {signup ? 'Una cocina más organizada empieza acá.' : 'Tu cocina te estaba esperando.'}
        </h2>
        <p className="mt-4 max-w-md text-base leading-relaxed text-bistro-cream">
          {signup
            ? 'Guardá recetas, organizá ingredientes y prepará tus próximas comidas en un mismo lugar.'
            : 'Retomá tus recetas, el menú de la semana y lo que necesitás comprar.'}
        </p>
        <ul className="mt-8 grid gap-3">
          {benefits.map(({ icon: Icon, title, detail }) => (
            <li
              key={title}
              className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/5 p-3.5"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bistro-champagne/15 text-bistro-champagne">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-sm text-bistro-cream">{detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-sm text-bistro-cream">
        Cociná con más ideas y menos complicaciones.
      </p>
    </aside>
  );
}
