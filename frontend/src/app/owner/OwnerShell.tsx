'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';
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
};

const navItems: OwnerNavItem[] = [
  { href: '/owner', label: 'Resumen', icon: <LayoutGrid size={16} /> },
  { href: '/owner/global-books', label: 'Global Books', icon: <Library size={16} /> },
  { href: '/owner/global-pdfs', label: 'Global PDFs', icon: <FileText size={16} /> },
  { href: '/owner/global-pdfs/upload', label: 'Upload Global PDF', icon: <FileText size={16} /> },
  { href: '/owner/indexing', label: 'Indexación', icon: <Database size={16} /> },
  { href: '/owner/premium-moderation', label: 'Moderación Premium', icon: <Flag size={16} /> },
  { href: '/owner/tenants', label: 'Tenants', icon: <Building2 size={16} /> },
  { href: '/owner/system-health', label: 'System Health', icon: <Activity size={16} /> },
];

export default function OwnerShell({ children }: OwnerShellProps) {
  const pathname = usePathname();
  const userLabel = 'Platform owner';

  const currentTitle = useMemo(() => {
    const current = navItems.find((item) => pathname === item.href);
    return current?.label ?? 'Consola Owner';
  }, [pathname]);

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] text-[#241A14]">
      <div className="mx-auto flex w-full max-w-[1560px] gap-4 p-3 md:p-6">
        <aside className="hidden w-[280px] shrink-0 rounded-3xl border border-white/10 bg-[#16110D] p-4 text-[#F4EBDD] lg:block">
          <div className="mb-5">
            <p className="flex items-center gap-2 text-xl font-bold">
              <Shield size={18} /> Owner Console
            </p>
            <p className="mt-1 text-xs text-[#D9CDBF]">{userLabel}</p>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    active ? 'bg-[#C56A1A] text-white' : 'text-[#EADCCB] hover:bg-white/10'
                  }`}
                >
                  {item.icon}
                  {item.label}
                  <ChevronRight
                    size={14}
                    className={`ml-auto transition ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-80'}`}
                  />
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="w-full">
          <header className="mb-4 rounded-3xl border border-[#E8DDD2] bg-white/85 px-4 py-4 premium-shadow md:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6B5A50]">
                  Platform Owner
                </p>
                <h1 className="text-2xl font-semibold">{currentTitle}</h1>
              </div>
              <div className="flex gap-2">
                <Link
                  href="/app"
                  className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                >
                  Ir a /app
                </Link>
              </div>
            </div>
            <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'border-[#C56A1A]/35 bg-[#C56A1A]/12 text-[#A55412]'
                        : 'border-[#E8DDD2] bg-white text-[#6B5A50] hover:border-[#C56A1A]/30'
                    }`}
                  >
                    {item.label}
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
