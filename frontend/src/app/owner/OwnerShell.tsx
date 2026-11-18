'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import {
  Activity,
  Building2,
  ChevronRight,
  Database,
  FileText,
  Flag,
  LayoutGrid,
  Library,
  Shield,
} from 'lucide-react';

type OwnerShellProps = {
  children: ReactNode;
};

type OwnerNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  pending?: boolean;
};

const navItems: OwnerNavItem[] = [
  { href: '/owner', label: 'Resumen', icon: <LayoutGrid size={16} /> },
  { href: '/owner/global-books', label: 'Biblioteca global', icon: <Library size={16} /> },
  { href: '/owner/global-pdfs', label: 'Documentos PDF', icon: <FileText size={16} /> },
  { href: '/owner/global-pdfs/upload', label: 'Cargar PDF', icon: <FileText size={16} /> },
  { href: '/owner/indexing', pending: true, label: 'Indexación', icon: <Database size={16} /> },
  { href: '/owner/premium-moderation', pending: true, label: 'Moderación Premium', icon: <Flag size={16} /> },
  { href: '/owner/tenants', pending: true, label: 'Hogares', icon: <Building2 size={16} /> },
  { href: '/owner/system-health', label: 'Estado del sistema', icon: <Activity size={16} /> },
];

export default function OwnerShell({ children }: OwnerShellProps) {
  const pathname = usePathname();
  const current = navItems.find((item) => pathname === item.href);
  const currentTitle = current?.label ?? 'Administración';

  return (
    <main className="texture-paper min-h-screen bg-bistro-page text-bistro-text-primary">
      <div className="mx-auto flex w-full max-w-[1560px] gap-4 p-3 md:p-6">
        <aside className="bistro-focus-dark hidden w-[280px] shrink-0 rounded-3xl border border-white/10 bg-bistro-inverse p-4 text-bistro-cream lg:block">
          <div className="mb-5">
            <p className="flex items-center gap-2 text-xl font-bold">
              <Shield size={18} aria-hidden="true" /> CocinaCore
            </p>
            <p className="mt-1 text-xs text-bistro-cream">Administración de plataforma</p>
          </div>
          <nav aria-label="Administración" className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? 'bg-bistro-action-primary text-white'
                      : 'text-bistro-cream hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.pending ? <span className="text-[10px] text-bistro-cream">Pendiente</span> : null}
                  <ChevronRight aria-hidden="true"
                    size={14}
                    className={`ml-auto transition ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-80'}`}
                  />
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="mb-4 rounded-3xl border border-bistro-border bg-white/85 px-4 py-4 premium-shadow md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-bistro-text-secondary">
                  Administración de plataforma
                </p>
                <h1 className="text-2xl font-semibold">{currentTitle}</h1>
              </div>
              <div className="flex gap-2">
                <Link
                  href="/app"
                  className="rounded-xl border border-bistro-border px-3 py-2 text-sm font-semibold text-bistro-text-secondary hover:border-bistro-action-primary/40"
                >
                  Volver a mi hogar
                </Link>
              </div>
            </div>
            <nav aria-label="Administración móvil" className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'border-bistro-action-primary/35 bg-bistro-action-primary/12 text-bistro-action-primary'
                        : 'border-bistro-border bg-white text-bistro-text-secondary hover:border-bistro-action-primary/30'
                    }`}
                  >
                    {item.label}{item.pending ? ' · Pendiente' : ''}
                  </Link>
                );
              })}
            </nav>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
