'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Flag,
  LayoutDashboard,
  Library,
  ShieldCheck,
  Upload,
} from 'lucide-react';

type OwnerNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  pending?: boolean;
};

const navItems: OwnerNavItem[] = [
  { href: '/owner', label: 'Resumen', icon: <LayoutDashboard size={18} /> },
  { href: '/owner/global-books', label: 'Biblioteca global', icon: <Library size={18} /> },
  { href: '/owner/global-pdfs', label: 'Documentos PDF', icon: <FileText size={18} /> },
  { href: '/owner/global-pdfs/upload', label: 'Cargar PDF', icon: <Upload size={18} /> },
  { href: '/owner/system-health', label: 'Estado del sistema', icon: <Activity size={18} /> },
  { href: '/owner/indexing', label: 'Indexación', icon: <Database size={18} />, pending: true },
  {
    href: '/owner/premium-moderation',
    label: 'Moderación Premium',
    icon: <Flag size={18} />,
    pending: true,
  },
  { href: '/owner/tenants', label: 'Hogares', icon: <Building2 size={18} />, pending: true },
];

export default function OwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = navItems.find((item) => item.href === pathname);
  const currentTitle = current?.label ?? 'Administración';

  return (
    <main className="min-h-screen bg-bistro-page text-bistro-text-primary">
      <div className="mx-auto flex w-full max-w-[1600px] gap-6 px-3 py-4 sm:px-6 lg:gap-8 lg:py-8">
        <aside className="sticky top-6 hidden h-[calc(100vh-3rem)] w-[252px] shrink-0 flex-col overflow-y-auto rounded-[28px] bg-bistro-inverse px-4 py-6 text-white shadow-lg lg:flex">
          <div className="flex items-center gap-3 px-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10 text-bistro-champagne">
              <ShieldCheck size={23} aria-hidden="true" />
            </span>
            <div>
              <p className="font-bistro-heading text-xl font-semibold leading-tight">CocinaCore</p>
              <p className="text-xs text-bistro-cream/75">Administración</p>
            </div>
          </div>
          <div className="my-6 h-px bg-white/15" />
          <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-bistro-cream/65">
            Herramientas
          </p>
          <nav aria-label="Administración" className="space-y-1">
            {navItems.map((item, index) => {
              const active = item.href === pathname;
              return (
                <div key={item.href}>
                  {index === 5 ? (
                    <p className="mt-5 px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-bistro-cream/65">
                      En preparación
                    </p>
                  ) : null}
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={
                      'group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ' +
                      (active
                        ? 'bg-bistro-action-primary text-white shadow-sm'
                        : 'text-bistro-cream hover:bg-white/10 hover:text-white')
                    }
                  >
                    <span className="shrink-0" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{item.label}</span>
                    {item.pending ? (
                      <span className="rounded-md border border-white/20 px-1.5 py-0.5 text-[10px] text-bistro-cream">
                        Pendiente
                      </span>
                    ) : active ? (
                      <ChevronRight size={15} aria-hidden="true" />
                    ) : null}
                  </Link>
                </div>
              );
            })}
          </nav>
          <Link
            href="/app"
            className="mt-auto flex min-h-11 items-center gap-2 rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold text-bistro-cream hover:bg-white/10"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Volver a mi hogar
          </Link>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="mb-5 overflow-hidden rounded-[26px] border border-bistro-border bg-white px-5 py-4 text-bistro-text-primary shadow-sm sm:px-7 sm:py-5 lg:mb-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-bistro-action-secondary">
                  CocinaCore / Administración de plataforma
                </p>
                <h1 className="mt-2 font-bistro-heading text-2xl font-semibold sm:text-3xl">
                  {currentTitle}
                </h1>
              </div>
              <Link
                href="/app"
                className="hidden min-h-11 shrink-0 items-center gap-2 rounded-xl border border-bistro-border px-4 text-sm font-medium text-bistro-text-secondary hover:bg-bistro-page sm:inline-flex lg:hidden"
              >
                <ArrowLeft size={16} /> Volver a mi hogar
              </Link>
            </div>

            <details className="group mt-4 rounded-2xl border border-bistro-border bg-bistro-page lg:hidden">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                <span>Explorar secciones</span>
                <ChevronDown
                  size={19}
                  aria-hidden="true"
                  className="transition-transform group-open:rotate-180"
                />
              </summary>
              <nav
                aria-label="Administración móvil"
                className="grid grid-cols-2 gap-2 border-t border-bistro-border p-3"
              >
                {navItems.map((item) => {
                  const active = item.href === pathname;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={
                        'flex min-h-12 min-w-0 items-center gap-2 rounded-xl px-3 py-3 text-xs font-semibold ' +
                        (active
                          ? 'bg-bistro-action-primary text-white'
                          : 'bg-white text-bistro-text-primary hover:bg-bistro-surface-warm')
                      }
                    >
                      <span className="shrink-0" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="min-w-0">
                        {item.label}
                        {item.pending ? ' · Pendiente' : ''}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </details>
            <Link
              href="/app"
              className="mt-2 inline-flex min-h-10 items-center gap-2 text-xs font-medium text-bistro-text-secondary sm:hidden"
            >
              <ArrowLeft size={14} aria-hidden="true" /> Volver a mi hogar
            </Link>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
