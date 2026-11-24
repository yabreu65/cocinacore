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
  LibraryBig,
  Menu,
  Package,
  ShoppingCart,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { activeHouseholdRoute, householdNavigation, isHouseholdRoute } from './household-nav';

const mobileTabs = [
  { href: '/app', label: 'Inicio', icon: LayoutGrid },
  { href: '/recipes', label: 'Recetas', icon: BookOpen },
  { href: '/meal-planner', label: 'Planificar', icon: CalendarDays },
  { href: '/shopping-list', label: 'Compras', icon: ShoppingCart },
] as const;

function isMobileTabActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  if (href === '/recipes')
    return (
      pathname === '/app/cooking-intent' ||
      pathname === '/recipes' ||
      (pathname.startsWith('/recipes/') && !pathname.startsWith('/recipes/inventory'))
    );
  return pathname === href;
}

const icons = {
  home: LayoutGrid,
  book: BookOpen,
  library: LibraryBig,
  sparkles: Sparkles,
  package: Package,
  calendar: CalendarDays,
  cart: ShoppingCart,
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
  const moreSelected =
    isHouseholdRoute(pathname) &&
    !mobileTabs.some((item) => isMobileTabActive(pathname, item.href));
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
        <span className="text-xs font-semibold text-bistro-text-secondary">Tu cocina</span>
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

      <div className="min-w-0 flex-1 pb-24 md:pb-0">{children}</div>

      <nav
        aria-label="Navegación rápida"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-bistro-border bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(22,17,13,0.08)] backdrop-blur-md md:hidden"
      >
        <div className="grid grid-cols-5 gap-0.5 px-1 pt-1">
          {mobileTabs.map(({ href, label, icon: Icon }) => {
            const active = isMobileTabActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-bistro-action-primary ${
                  active
                    ? 'bg-bistro-surface-warm text-bistro-action-primary'
                    : 'text-bistro-text-secondary hover:bg-bistro-page'
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            ref={triggerRef}
            aria-label="Abrir menú de navegación"
            aria-controls="mobile-household-menu"
            aria-expanded={menuOpen}
            aria-current={moreSelected ? 'page' : undefined}
            onClick={() => setMenuOpen(true)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-bistro-action-primary ${
              moreSelected
                ? 'bg-bistro-surface-warm text-bistro-action-primary'
                : 'text-bistro-text-secondary hover:bg-bistro-page'
            }`}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
            <span>Más</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
