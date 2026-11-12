'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarDays, ShoppingCart } from 'lucide-react';
import { safeFetch } from '@/lib/api';

type ShoppingItem = { id: string; status: 'pending' | 'purchased' };
type ShoppingApiResponse = { items: ShoppingItem[] };
type MealPlanResponse = { plan: unknown | null };

export function countPendingShoppingItems(items: ShoppingItem[]): number {
  return items.filter((item) => item.status === 'pending').length;
}

export function DashboardDailySnapshot() {
  const [pendingShopping, setPendingShopping] = useState<number | null>(null);
  const [planStatus, setPlanStatus] = useState<'loading' | 'saved' | 'missing' | 'unavailable'>(
    'loading'
  );
  const [shoppingStatus, setShoppingStatus] = useState<'loading' | 'available' | 'unavailable'>(
    'loading'
  );

  useEffect(() => {
    let active = true;
    // Both APIs already exist. These independent reads must never prevent Inicio
    // from loading if shopping or planning is unavailable.
    const load = async () => {
      const [shopping, plan] = await Promise.allSettled([
        safeFetch<ShoppingApiResponse>('/api/shopping-list?status=pending', {
          credentials: 'same-origin',
        }),
        safeFetch<MealPlanResponse>('/api/meal-plan', { credentials: 'same-origin' }),
      ]);
      if (!active) return;
      if (
        shopping.status === 'fulfilled' &&
        shopping.value.ok &&
        Array.isArray(shopping.value.data.items)
      ) {
        setPendingShopping(countPendingShoppingItems(shopping.value.data.items));
        setShoppingStatus('available');
      } else {
        setShoppingStatus('unavailable');
      }
      if (plan.status === 'fulfilled' && plan.value.ok) {
        setPlanStatus(plan.value.data.plan ? 'saved' : 'missing');
      } else {
        setPlanStatus('unavailable');
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const shoppingLabel =
    shoppingStatus === 'loading'
      ? 'Consultando compras…'
      : shoppingStatus === 'unavailable'
        ? 'No se pudieron consultar tus compras.'
        : pendingShopping === 0
          ? 'No tenés compras pendientes.'
          : `${pendingShopping} producto${pendingShopping === 1 ? '' : 's'} por comprar.`;

  const mealLabel =
    planStatus === 'loading'
      ? 'Consultando tu menú…'
      : planStatus === 'saved'
        ? 'Tenés un menú guardado.'
        : planStatus === 'missing'
          ? 'Todavía no guardaste un menú.'
          : 'No se pudo consultar tu menú.';

  return (
    <section className="mt-7" aria-labelledby="daily-snapshot-heading">
      <h2 id="daily-snapshot-heading" className="text-xl font-semibold text-bistro-text-primary">
        Para continuar donde lo dejaste
      </h2>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Un vistazo a tus compras y tu menú, con datos de CocinaCore.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link
          href="/shopping-list"
          className="flex min-h-24 items-start gap-3 rounded-2xl border border-bistro-border bg-bistro-surface p-4 hover:border-bistro-action-primary/40 hover:bg-bistro-surface-warm"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bistro-surface-warm text-bistro-action-secondary">
            <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-bistro-text-primary">
              Lista de compras
            </span>
            <span className="mt-1 block text-sm text-bistro-text-secondary" aria-live="polite">
              {shoppingLabel}
            </span>
          </span>
        </Link>
        <Link
          href="/meal-planner"
          className="flex min-h-24 items-start gap-3 rounded-2xl border border-bistro-border bg-bistro-surface p-4 hover:border-bistro-action-primary/40 hover:bg-bistro-surface-warm"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bistro-surface-warm text-bistro-action-secondary">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-bistro-text-primary">Mi menú</span>
            <span className="mt-1 block text-sm text-bistro-text-secondary" aria-live="polite">
              {mealLabel}
            </span>
          </span>
        </Link>
      </div>
    </section>
  );
}
