'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CreditCard,
  LayoutGrid,
  Library,
  Menu,
  Package,
  ShoppingCart,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { activeHouseholdRoute, householdNavigation, isHouseholdRoute } from './household-nav';

const icons = {
  home: LayoutGrid,
  book: BookOpen,
  sparkles: Sparkles,
  package: Package,
  calendar: CalendarDays,
  cart: ShoppingCart,
  library: Library,
  user: User,
  card: CreditCard,
} as const;

function HouseholdNavigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = activeHouseholdRoute(pathname);
  return (
    <nav aria-label="Navegación de CocinaCore" className="grid gap-1 text-bistro-cream">
      {householdNavigation.map((item) => {
        const Icon = icons[item.icon];
        const selected = active === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={selected ? 'page' : undefined}
            onClick={onNavigate}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bistro-champagne ${
              selected
                ? 'bg-bistro-champagne text-bistro-text-primary'
                : 'text-bistro-cream hover:bg-white/10 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContents({
  pathname,
  onNavigate,
  onLogout,
  mobile = false,
}: {
  pathname: string;
  onNavigate?: () => void;
  onLogout: () => void;
  mobile?: boolean;
}) {
  return (
    <>
      {!mobile ? (
        <Link
          href="/app"
          className="mb-6 font-bistro-heading text-xl font-bold text-bistro-champagne"
        >
          CocinaCore
        </Link>
      ) : null}
      <HouseholdNavigation pathname={pathname} onNavigate={onNavigate} />
      <button
        type="button"
        onClick={onLogout}
        className="mb-5 mt-auto min-h-11 rounded-xl px-3 py-2 text-left text-sm font-semibold text-bistro-cream hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bistro-champagne"
      >
        Cerrar sesión
      </button>
    </>
  );
}

/** Shared visual shell; route authorization stays on the server's existing auth middleware. */
export default function HouseholdShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const trigger = triggerRef.current;
    dialogRef.current
      ?.querySelector<HTMLButtonElement>('[aria-label="Cerrar menú de navegación"]')
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), a[href]'
        ) ?? []
      );
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [menuOpen]);

  if (!isHouseholdRoute(pathname)) return <>{children}</>;

  const logout = async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      router.replace('/login');
      router.refresh();
    } catch {
      // Do not claim the session ended if the server could not revoke it.
    }
  };

  return (
    <div className="min-h-screen bg-bistro-page md:flex">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-bistro-border bg-bistro-surface px-4 py-3 md:hidden">
        <Link
          href="/app"
          className="font-bistro-heading text-xl font-bold text-bistro-action-primary"
        >
          CocinaCore
        </Link>
        <button
          type="button"
          ref={triggerRef}
          aria-label="Abrir menú de navegación"
          aria-controls="mobile-household-menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="grid h-11 w-11 place-items-center rounded-xl border border-bistro-border bg-bistro-page text-bistro-action-primary"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      {menuOpen ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
          className="fixed inset-0 z-50 md:hidden"
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 bg-black/45"
            onClick={() => setMenuOpen(false)}
          />
          <aside
            id="mobile-household-menu"
            className="bistro-focus-dark absolute inset-y-0 left-0 flex w-[min(85vw,19rem)] flex-col overflow-y-auto border-r border-white/15 bg-[var(--sidebar-background)] p-5 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between gap-2">
              <span className="font-bistro-heading text-xl font-bold text-bistro-champagne">
                CocinaCore
              </span>
              <button
                type="button"
                aria-label="Cerrar menú de navegación"
                onClick={() => setMenuOpen(false)}
                className="grid h-11 w-11 place-items-center rounded-xl text-bistro-cream hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bistro-champagne"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <SidebarContents
              pathname={pathname}
              mobile
              onNavigate={() => setMenuOpen(false)}
              onLogout={() => void logout()}
            />
          </aside>
        </div>
      ) : null}

      <aside className="bistro-focus-dark sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/15 bg-[var(--sidebar-background)] p-4 md:flex">
        <SidebarContents pathname={pathname} onLogout={() => void logout()} />
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
