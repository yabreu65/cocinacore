'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { humanCopy } from '@/lib/copy';

const navItems = ['Funciones', 'Biblioteca', 'Inventario', 'Premium Board', 'Recursos'];

const featureCards = [
  {
    title: 'Recetas personalizadas',
    description: 'Creá recetas únicas con lo que tenés en casa y según tus preferencias.',
    icon: '✦',
    color: 'text-[#6D4AFF]',
  },
  {
    title: 'Biblioteca PDF inteligente',
    description: 'Subí tus libros y recetarios para consultarlos con contexto.',
    icon: '▣',
    color: 'text-[#C56A1A]',
  },
  {
    title: 'Inventario inteligente',
    description: 'Organizá ingredientes y recibí sugerencias que evitan desperdicios.',
    icon: '◍',
    color: 'text-[#567A3B]',
  },
  {
    title: 'Tips de cocina paso a paso',
    description: 'Aprendé técnicas con guía clara para resultados consistentes.',
    icon: '✧',
    color: 'text-[#C56A1A]',
  },
  {
    title: 'Cocina en familia',
    description: 'Invitá miembros y mantené un recetario compartido y privado.',
    icon: '◌',
    color: 'text-[#6D4AFF]',
  },
  {
    title: 'Premium Board',
    description: 'Descubrí recetas destacadas y valoradas por toda la comunidad.',
    icon: '♕',
    color: 'text-[#C56A1A]',
  },
];

const steps = [
  { title: 'Cargá recetas o PDFs', description: 'Importá tus libros y recetarios familiares.' },
  { title: 'Agregá ingredientes', description: 'Mantené inventario actualizado en segundos.' },
  {
    title: 'Pedí recetas sugeridas',
    description: 'Recibí propuestas con contexto real de cocina.',
  },
  { title: 'Guardá y compartí', description: 'Construí legado culinario para tu familia.' },
];

function DotBadge({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#E8DDD2] bg-white/75 px-3 py-1 text-xs font-semibold text-[#6B5A50]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#C56A1A]" />
      {children}
    </span>
  );
}

function DashboardMockup() {
  return (
    <div className="dark-panel-shadow relative overflow-hidden rounded-[1.7rem] border border-white/10 bg-[#16110D] p-4 text-[#F5ECE2] md:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(197,106,26,0.15),transparent_38%),radial-gradient(circle_at_100%_100%,rgba(109,74,255,0.15),transparent_36%)]" />
      <div className="relative grid gap-3 md:grid-cols-[180px_1fr]">
        <aside className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <p className="mb-3 text-sm font-semibold text-[#F8D8BC]">CocinaCore</p>
          <ul className="space-y-2 text-xs text-[#D6C2B0]">
            {[
              'Inicio',
              humanCopy.assistantRecipesNav,
              'Inventario',
              'Biblioteca PDF',
              'Tip del chef',
              'Historial',
              'Premium Board',
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
              <p className="text-xs text-[#BAA796]">{humanCopy.suggestedRecipesForYou}</p>
              <p className="mt-1 font-semibold">Pasta cremosa con champiñones</p>
              <p className="mt-2 text-xs text-[#AA9686]">30 min · Fácil</p>
              <button className="mt-3 w-full rounded-full border border-[#C56A1A]/60 px-3 py-2 text-xs font-semibold text-[#F8DCC1]">
                Ver receta completa
              </button>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[#BAA796]">Inventario</p>
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
              <p className="text-xs text-[#BAA796]">PDF consultado recientemente</p>
              <p className="mt-1 text-sm">Recetario de la Abuela.pdf</p>
              <div className="mt-2 h-1.5 rounded-full bg-white/10">
                <div className="h-full w-2/3 rounded-full bg-[#6D4AFF]" />
              </div>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-[#BAA796]">Tip del chef</p>
              <p className="mt-1 text-sm text-[#E9DACE]">
                La salsa siempre queda mejor después de 10 minutos de reposo.
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
    <div className="texture-paper min-h-screen bg-[#FAF6F1] text-[#241A14]">
      <header className="glass-soft sticky top-0 z-50 border-b border-[#E8DDD2]">
        <div className="mx-auto flex h-20 w-full max-w-[1200px] items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full border border-[#C56A1A]/60 text-[#C56A1A]">
              ⚭
            </div>
            <div>
              <p className="text-xl font-extrabold">
                Cocina<span className="text-[#C56A1A]">Core</span>
              </p>
              <p className="text-xs text-[#6B5A50]">Tu cocina, organizada con inteligencia</p>
            </div>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-[#3A2D24] lg:flex">
            {navItems.map((item) => (
              <a key={item} href="#" className="transition-colors hover:text-[#C56A1A]">
                {item}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-semibold text-[#3A2D24] md:block">
              Iniciar sesión
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-[#C56A1A] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#A55412]"
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
            <p className="text-xs font-bold tracking-[0.18em] text-[#C56A1A]">
              RECETAS SUGERIDAS • BIBLIOTECA • INVENTARIO • TIPS
            </p>
            <h1
              className="mt-4 text-4xl font-semibold leading-[1.05] md:text-6xl"
              style={{ fontFamily: 'var(--font-playfair)' }}
            >
              Tu cocina, recetas y secretos familiares organizados con{' '}
              <span className="text-[#C56A1A]">asistencia inteligente</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#6B5A50]">
              Crea recetas con ayuda, consulta libros PDF, administra ingredientes y construye una
              biblioteca culinaria viva para tu familia.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="rounded-2xl bg-[#C56A1A] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#A55412]"
              >
                Empezar gratis
              </Link>
              <button className="rounded-2xl border border-[#C56A1A]/45 bg-white/80 px-6 py-3 font-semibold text-[#8A4812]">
                ▶ Ver demo
              </button>
            </div>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <DotBadge>14 días gratis</DotBadge>
              <DotBadge>Sin tarjeta</DotBadge>
              <DotBadge>Privado y seguro</DotBadge>
              <DotBadge>Ideal para familias</DotBadge>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
          >
            <DashboardMockup />
          </motion.div>
        </section>

        <section className="mt-12 border-y border-[#E8DDD2] py-6 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-[#816D5E]">
            CONFIADO POR AMANTES DE LA COCINA
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm font-medium text-[#6B5A50] md:grid-cols-6">
            {['Chefs', 'Familias', 'Emprendedores', 'Escuelas', 'Creadores', 'Food Labs'].map(
              (item) => (
                <div key={item}>{item}</div>
              )
            )}
          </div>
        </section>

        <section className="mt-11">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featureCards.map((feature) => (
              <article
                key={feature.title}
                className="premium-shadow rounded-3xl border border-[#E8DDD2] bg-white/75 p-6 transition-transform duration-200 hover:-translate-y-1"
              >
                <span className={`text-xl ${feature.color}`}>{feature.icon}</span>
                <h3 className="mt-3 text-2xl font-semibold leading-tight">{feature.title}</h3>
                <p className="mt-2 text-[#6B5A50]">{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14 text-center">
          <h2 className="text-4xl font-semibold" style={{ fontFamily: 'var(--font-playfair)' }}>
            Así funciona <span className="text-[#C56A1A]">CocinaCore</span>
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-4">
            {steps.map((step, index) => (
              <article
                key={step.title}
                className="rounded-2xl border border-[#E8DDD2] bg-white/65 p-5"
              >
                <span className="inline-grid h-8 w-8 place-items-center rounded-full bg-[#EEC89E] font-bold text-[#7E4314]">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-[#6B5A50]">{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="dark-panel-shadow mt-14 overflow-hidden rounded-3xl border border-white/10 bg-[#16110D] text-[#F5ECE2]">
          <div className="grid items-stretch gap-0 lg:grid-cols-[1fr_1.15fr]">
            <div className="p-8 md:p-10">
              <h2 className="text-4xl leading-tight" style={{ fontFamily: 'var(--font-playfair)' }}>
                Más que una app de recetas: una forma de dejar tu cocina{' '}
                <span className="text-[#E39A5A]">viva para tus hijos.</span>
              </h2>
              <p className="mt-4 max-w-lg text-[#D8C5B2]">
                Guardá ingredientes, pasos, historias y secretos que normalmente solo se aprenden
                cocinando al lado de alguien.
              </p>
            </div>
            <div className="relative min-h-[280px] bg-[radial-gradient(circle_at_20%_20%,rgba(197,106,26,0.4),transparent_45%),linear-gradient(145deg,#2a1f18,#17110d)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_75%,rgba(86,122,59,0.35),transparent_35%)]" />
              <svg viewBox="0 0 600 300" className="absolute inset-0 h-full w-full opacity-90">
                <rect x="0" y="0" width="600" height="300" fill="transparent" />
                <ellipse cx="300" cy="250" rx="220" ry="34" fill="rgba(0,0,0,0.32)" />
                <circle cx="230" cy="124" r="36" fill="#d9b697" />
                <circle cx="356" cy="116" r="42" fill="#c99f7e" />
                <circle cx="454" cy="132" r="34" fill="#d7b391" />
                <rect x="190" y="164" width="90" height="84" rx="24" fill="#856045" />
                <rect x="304" y="160" width="112" height="92" rx="24" fill="#7a563d" />
                <rect x="425" y="172" width="72" height="76" rx="20" fill="#8d684d" />
                <rect x="232" y="207" width="224" height="18" rx="9" fill="#c56a1a" opacity="0.8" />
              </svg>
            </div>
          </div>
        </section>

        <section className="dark-panel-shadow mt-7 rounded-3xl border border-white/10 bg-[#16110D] p-8 text-[#F4EBE1] md:p-10">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <h2 className="text-4xl leading-tight" style={{ fontFamily: 'var(--font-playfair)' }}>
                Empieza tu recetario familiar inteligente hoy
              </h2>
              <p className="mt-2 text-[#D7C2AF]">
                Unite a familias que ya transforman su cocina con ayuda útil y privada.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="rounded-2xl bg-[#C56A1A] px-6 py-3 font-semibold text-white hover:bg-[#A55412]"
              >
                Crear cuenta gratis
              </Link>
              <button className="rounded-2xl border border-[#E39A5A]/50 px-6 py-3 font-semibold text-[#F7DDC3]">
                Ver planes
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
