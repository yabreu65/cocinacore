'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { humanCopy } from '@/lib/copy';
import styles from './LandingPage.module.css';

const navItems = [
  { label: 'Funciones', href: '#funciones' },
  { label: 'Cómo funciona', href: '#como-funciona' },
  { label: 'Para tu hogar', href: '#para-tu-hogar' },
];

const featureCards = [
  {
    title: 'Recetas para tu día a día',
    description:
      'Encontrá ideas para cocinar según los ingredientes y las preferencias de tu hogar.',
    icon: '✦',
    color: 'text-bistro-action-secondary',
  },
  {
    title: 'Tu recetario en un lugar',
    description:
      'Consultá y organizá tus recetas favoritas para volver a ellas cuando las necesites.',
    icon: '▣',
    color: 'text-bistro-action-primary',
  },
  {
    title: 'Inventario de ingredientes',
    description: 'Registrá lo que tenés en casa para planificar mejor tus preparaciones.',
    icon: '◍',
    color: 'text-bistro-action-secondary',
  },
  {
    title: 'Planificación de menús',
    description: 'Organizá qué cocinar durante la semana sin empezar de cero cada día.',
    icon: '▦',
    color: 'text-bistro-action-primary',
  },
  {
    title: 'Lista de compras',
    description: 'Prepará tus compras con una lista ordenada de lo que necesitás.',
    icon: '✓',
    color: 'text-bistro-action-secondary',
  },
  {
    title: 'Menos desperdicios',
    description: 'Descubrí ideas para aprovechar mejor los alimentos disponibles.',
    icon: '♻',
    color: 'text-bistro-action-primary',
  },
];

const steps = [
  {
    title: 'Registrá tus ingredientes',
    description: 'Anotá lo que tenés disponible en tu cocina.',
  },
  {
    title: 'Descubrí qué cocinar',
    description: 'Buscá recetas e ideas acordes a tus gustos y lo que tenés.',
  },
  {
    title: 'Armá tu menú',
    description: 'Organizá las comidas de los próximos días.',
  },
  {
    title: 'Prepará tus compras',
    description: 'Llevá una lista de lo que necesitás conseguir.',
  },
];

function DotBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-bistro-border bg-bistro-surface/80 px-3 py-1 text-xs font-semibold text-bistro-text-secondary">
      <span className="h-1.5 w-1.5 rounded-full bg-bistro-action-secondary" />
      {children}
    </span>
  );
}

function DashboardMockup() {
  return (
    <div className="dark-panel-shadow relative overflow-hidden rounded-[1.7rem] border border-white/15 bg-bistro-action-secondary p-4 text-[var(--color-brand-cream)] md:p-5">
      <div className={styles.mockupGlow} />
      <div className="relative grid gap-3 md:grid-cols-[180px_1fr]">
        <aside className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <p className="mb-3 text-sm font-semibold text-[var(--color-brand-champagne)]">
            CocinaCore · Vista ilustrativa
          </p>
          <ul className="space-y-2 text-xs text-[var(--color-brand-cream)]">
            {[
              'Inicio',
              humanCopy.assistantRecipesNav,
              'Inventario',
              'Planificador',
              'Lista de compras',
              'Recetario',
              'Perfil',
            ].map((item, index) => (
              <li
                key={item}
                className={`rounded-lg px-2 py-1.5 ${index === 0 ? 'bg-white/10 text-white' : ''}`}
              >
                {item}
              </li>
            ))}
          </ul>
        </aside>
        <section className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[var(--color-brand-champagne)]">
                {humanCopy.suggestedRecipesForYou}
              </p>
              <p className="mt-1 font-semibold">Pasta cremosa con champiñones</p>
              <p className="mt-2 text-xs text-[var(--color-brand-champagne)]">30 min · Fácil</p>
              <p className="mt-3 rounded-full border border-[var(--color-brand-champagne)] px-3 py-2 text-center text-xs font-semibold text-[var(--color-brand-cream)]">
                Ejemplo de receta
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[var(--color-brand-champagne)]">Inventario</p>
              <ul className="mt-1 space-y-2 text-xs">
                <li className="flex justify-between">
                  <span>Tomate</span>
                  <span>6</span>
                </li>
                <li className="flex justify-between">
                  <span>Pollo</span>
                  <span>1.2 kg</span>
                </li>
                <li className="flex justify-between">
                  <span>Ajo</span>
                  <span>2 cabezas</span>
                </li>
                <li className="flex justify-between">
                  <span>Cebolla</span>
                  <span>3</span>
                </li>
              </ul>
            </article>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[var(--color-brand-champagne)]">Menú de la semana</p>
              <p className="mt-1 text-sm">Lunes: pasta con verduras</p>
              <div className="mt-2 h-1.5 rounded-full bg-white/10">
                <div className="h-full w-2/3 rounded-full bg-[var(--color-brand-champagne)]" />
              </div>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[var(--color-brand-champagne)]">Idea para aprovechar</p>
              <p className="mt-1 text-sm text-[var(--color-brand-cream)]">
                Esas verduras que te quedan pueden convertirse en una sopa o un salteado.
              </p>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <header className="glass-soft sticky top-0 z-50 border-b border-bistro-border">
        <div className="mx-auto flex h-20 w-full max-w-[1200px] items-center justify-between gap-2 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-bistro-action-primary/50 text-bistro-action-primary sm:h-10 sm:w-10">
              ⚭
            </div>
            <div>
              <p className="font-bistro-heading text-lg font-semibold tracking-tight sm:text-xl">
                Cocina<span className="text-bistro-action-primary">Core</span>
              </p>
              <p className="hidden text-xs text-bistro-text-secondary sm:block">
                Tu cocina, organizada con inteligencia
              </p>
            </div>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-bistro-text-primary lg:flex">
            {navItems.map((item) => (
              <a key={item.href} href={item.href} className={styles.navLink}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className={[styles.navLink, 'hidden text-sm font-semibold md:block'].join(' ')}
            >
              Iniciar sesión
            </Link>
            <Link
              href="/signup"
              className={[
                styles.primaryLink,
                'rounded-full bg-bistro-action-primary px-3 py-2.5 text-sm font-bold text-bistro-action-primary-text transition-colors hover:bg-bistro-action-primary-hover sm:px-5',
              ].join(' ')}
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 py-10 md:px-6 md:py-14">
        <section className="grid items-center gap-10 lg:grid-cols-[1.02fr_1fr]">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <p className="text-xs font-bold tracking-[0.18em] text-bistro-action-secondary">
              RECETAS • INGREDIENTES • MENÚS • COMPRAS
            </p>
            <h1 className="mt-4 font-bistro-heading text-[clamp(2.65rem,5vw,4.35rem)] font-semibold leading-[1.08] tracking-[-0.035em]">
              Tu cocina, <span className="text-bistro-action-primary">más organizada</span> cada
              día.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-bistro-text-secondary">
              Organizá tus recetas e ingredientes, planificá las comidas y prepará tus listas de
              compras. Con ayuda inteligente para encontrar ideas con lo que tenés en casa.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className={[
                  styles.primaryLink,
                  'rounded-2xl bg-bistro-action-primary px-6 py-3 font-semibold text-bistro-action-primary-text transition-colors hover:bg-bistro-action-primary-hover',
                ].join(' ')}
              >
                Empezar gratis
              </Link>
              <a
                href="#como-funciona"
                className={[
                  styles.secondaryLink,
                  'rounded-2xl border border-bistro-action-primary/35 bg-bistro-surface/80 px-6 py-3 font-semibold transition-colors hover:bg-bistro-surface-warm',
                ].join(' ')}
              >
                Cómo funciona
              </a>
            </div>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <DotBadge>14 días gratis</DotBadge>
              <DotBadge>Sin tarjeta</DotBadge>
              <DotBadge>Para quienes cocinan en casa</DotBadge>
              <DotBadge>Menús y compras en un lugar</DotBadge>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            <DashboardMockup />
          </motion.div>
        </section>

        <section className="mt-12 border-y border-bistro-border py-6 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-bistro-action-secondary">
            PENSADO PARA TU COCINA DE TODOS LOS DÍAS
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm font-medium text-bistro-text-secondary md:grid-cols-4">
            {[
              'Más organización',
              'Menos improvisación',
              'Ingredientes mejor aprovechados',
              'Recetas siempre a mano',
            ].map((item) => (
              <div key={item}>{item}</div>
            ))}
          </div>
        </section>

        <section id="funciones" className="mt-11 scroll-mt-28">
          <div className="mb-7 text-center">
            <h2 className="font-bistro-heading text-3xl font-semibold tracking-tight md:text-4xl">
              Todo lo que necesitás para{' '}
              <span className="text-bistro-action-primary">organizar tu cocina</span>
            </h2>
            <p className="mt-3 text-bistro-text-secondary">
              Herramientas prácticas para cocinar en casa, planificar y aprovechar tus ingredientes.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featureCards.map((feature) => (
              <article
                key={feature.title}
                className="premium-shadow rounded-3xl border border-bistro-border bg-bistro-surface/90 p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--color-brand-champagne)]"
              >
                <span
                  className={`inline-grid h-10 w-10 place-items-center rounded-2xl bg-bistro-surface-warm text-xl ${feature.color}`}
                >
                  {feature.icon}
                </span>
                <h3 className="mt-3 font-bistro-heading text-2xl font-semibold leading-tight">
                  {feature.title}
                </h3>
                <p className="mt-2 text-bistro-text-secondary">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="como-funciona" className="mt-14 scroll-mt-28 text-center">
          <h2 className="font-bistro-heading text-3xl font-semibold tracking-tight md:text-4xl">
            Así funciona <span className="text-bistro-action-primary">CocinaCore</span>
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-4">
            {steps.map((step, index) => (
              <article
                key={step.title}
                className="rounded-2xl border border-bistro-border bg-bistro-surface/80 p-5"
              >
                <span className="inline-grid h-8 w-8 place-items-center rounded-full bg-[var(--color-brand-champagne)] font-bold text-bistro-text-primary">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-bistro-heading text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-bistro-text-secondary">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          id="para-tu-hogar"
          className="dark-panel-shadow mt-14 scroll-mt-28 overflow-hidden rounded-3xl border border-white/15 bg-bistro-action-secondary text-[var(--color-brand-cream)]"
        >
          <div className="grid items-stretch gap-0 lg:grid-cols-[1fr_1.15fr]">
            <div className="p-8 md:p-10">
              <h2 className="font-bistro-heading text-3xl leading-tight md:text-4xl">
                Tus recetas de siempre,{' '}
                <span className="text-[var(--color-brand-champagne)]">a mano para cada día.</span>
              </h2>
              <p className="mt-4 max-w-lg text-[var(--color-brand-cream)]">
                Conservá tus preparaciones favoritas, llevá el control de tus ingredientes y
                organizá las comidas de tu hogar desde un mismo lugar.
              </p>
            </div>
            <div className={styles.familyIllustration}>
              <div className={styles.familyGlow} />
              <svg viewBox="0 0 600 300" className="absolute inset-0 h-full w-full opacity-90">
                <rect x="0" y="0" width="600" height="300" fill="transparent" />
                <ellipse cx="300" cy="250" rx="220" ry="34" fill="rgba(0,0,0,0.32)" />
                <circle cx="230" cy="124" r="36" fill="#d9b697" />
                <circle cx="356" cy="116" r="42" fill="#c99f7e" />
                <circle cx="454" cy="132" r="34" fill="#d7b391" />
                <rect x="190" y="164" width="90" height="84" rx="24" fill="#856045" />
                <rect x="304" y="160" width="112" height="92" rx="24" fill="#7a563d" />
                <rect x="425" y="172" width="72" height="76" rx="20" fill="#8d684d" />
                <rect
                  x="232"
                  y="207"
                  width="224"
                  height="18"
                  rx="9"
                  fill="var(--color-brand-champagne)"
                  opacity="0.8"
                />
              </svg>
            </div>
          </div>
        </section>

        <section className="dark-panel-shadow mt-7 rounded-3xl border border-white/15 bg-bistro-action-secondary p-8 text-[var(--color-brand-cream)] md:p-10">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="font-bistro-heading text-3xl leading-tight md:text-4xl">
                Organizá mejor tu cocina desde hoy
              </h2>
              <p className="mt-2 text-[var(--color-brand-cream)]">
                Empezá con tus recetas, tus ingredientes y tus próximas comidas. A tu ritmo.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className={[
                  styles.primaryLink,
                  'rounded-2xl bg-bistro-action-primary px-6 py-3 font-semibold text-bistro-action-primary-text transition-colors hover:bg-bistro-action-primary-hover',
                ].join(' ')}
              >
                Empezar con mi cocina
              </Link>
              <a
                href="#funciones"
                className={[
                  styles.secondaryLinkOnDark,
                  'rounded-2xl border border-[var(--color-brand-champagne)] px-6 py-3 font-semibold transition-colors hover:bg-white/10',
                ].join(' ')}
              >
                Explorar funciones
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
