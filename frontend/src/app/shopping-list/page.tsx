'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import { ShoppingTransferControls, type ShoppingItem } from './ShoppingTransferControls';

function provenanceLabel(source: string): string {
  if (source === 'manual') return 'Agregado manualmente';
  if (source.startsWith('meal-plan:')) return 'Desde el planificador';
  return 'Origen desconocido';
}

export default function ShoppingListPage() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [ingredientName, setIngredientName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyItemIds, setBusyItemIds] = useState<Set<string>>(new Set());
  const componentActiveRef = useRef(false);
  const createInProgressRef = useRef(false);
  const busyItemIdsRef = useRef(new Set<string>());

  useEffect(() => {
    let active = true;
    componentActiveRef.current = true;

    const loadItems = async () => {
      try {
        const result = await safeFetch<{ items: ShoppingItem[] }>('/api/shopping-list', {
          credentials: 'same-origin',
        });
        if (!result.ok) throw new Error(result.error || 'No se pudo cargar la lista de compras.');
        if (active) setItems(result.data.items);
      } catch (error) {
        if (active) {
          setLoadError(
            error instanceof Error ? error.message : 'No se pudo cargar la lista de compras.'
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadItems();
    return () => {
      active = false;
      componentActiveRef.current = false;
    };
  }, []);

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = ingredientName.trim();
    if (!name || createInProgressRef.current) return;

    createInProgressRef.current = true;
    setIsCreating(true);
    setMutationError(null);
    try {
      const result = await safeFetch<{ item: ShoppingItem }>('/api/shopping-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ingredientName: name,
          quantity: quantity.trim() || null,
          source: 'manual',
        }),
      });
      if (!result.ok) throw new Error(result.error || 'No se pudo guardar el artículo.');
      if (!componentActiveRef.current) return;
      setItems((current) => [...current, result.data.item]);
      setIngredientName('');
      setQuantity('');
    } catch (error) {
      if (componentActiveRef.current) {
        setMutationError(
          error instanceof Error ? error.message : 'No se pudo guardar el artículo.'
        );
      }
    } finally {
      createInProgressRef.current = false;
      if (componentActiveRef.current) setIsCreating(false);
    }
  };

  const onToggleStatus = async (item: ShoppingItem) => {
    if (busyItemIdsRef.current.has(item.id)) return;
    busyItemIdsRef.current.add(item.id);
    setBusyItemIds(new Set(busyItemIdsRef.current));
    setMutationError(null);
    const status = item.status === 'pending' ? 'purchased' : 'pending';
    try {
      const result = await safeFetch<{ item: ShoppingItem }>(
        `/api/shopping-list/${encodeURIComponent(item.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ status }),
        }
      );
      if (!result.ok) throw new Error(result.error || 'No se pudo cambiar el estado.');
      if (!componentActiveRef.current) return;
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? result.data.item : candidate))
      );
    } catch (error) {
      if (componentActiveRef.current) {
        setMutationError(error instanceof Error ? error.message : 'No se pudo cambiar el estado.');
      }
    } finally {
      busyItemIdsRef.current.delete(item.id);
      if (componentActiveRef.current) setBusyItemIds(new Set(busyItemIdsRef.current));
    }
  };

  const onTransfer = async (item: ShoppingItem) => {
    if (busyItemIdsRef.current.has(item.id)) return;
    if (!window.confirm(`¿Querés agregar ${item.ingredient_name} al inventario?`)) return;

    busyItemIdsRef.current.add(item.id);
    setBusyItemIds(new Set(busyItemIdsRef.current));
    setMutationError(null);
    try {
      const result = await safeFetch<{ item: ShoppingItem }>(
        `/api/shopping-list/${encodeURIComponent(item.id)}/inventory`,
        { method: 'POST', credentials: 'same-origin' }
      );
      if (!result.ok)
        throw new Error(result.error || 'No se pudo agregar el artículo al inventario.');
      if (!componentActiveRef.current) return;
      setItems((current) =>
        current.map((candidate) => (candidate.id === item.id ? result.data.item : candidate))
      );
    } catch (error) {
      if (componentActiveRef.current) {
        setMutationError(
          error instanceof Error ? error.message : 'No se pudo agregar el artículo al inventario.'
        );
      }
    } finally {
      busyItemIdsRef.current.delete(item.id);
      if (componentActiveRef.current) setBusyItemIds(new Set(busyItemIdsRef.current));
    }
  };

  const onDelete = async (item: ShoppingItem) => {
    if (busyItemIdsRef.current.has(item.id)) return;
    if (!window.confirm(`¿Querés eliminar ${item.ingredient_name} de tu lista?`)) return;

    busyItemIdsRef.current.add(item.id);
    setBusyItemIds(new Set(busyItemIdsRef.current));
    setMutationError(null);
    try {
      const result = await safeFetch<{ ok: true }>(
        `/api/shopping-list/${encodeURIComponent(item.id)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
        }
      );
      if (!result.ok) throw new Error(result.error || 'No se pudo eliminar el artículo.');
      if (!componentActiveRef.current) return;
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (error) {
      if (componentActiveRef.current) {
        setMutationError(
          error instanceof Error ? error.message : 'No se pudo eliminar el artículo.'
        );
      }
    } finally {
      busyItemIdsRef.current.delete(item.id);
      if (componentActiveRef.current) setBusyItemIds(new Set(busyItemIdsRef.current));
    }
  };

  const pendingItems = items.filter((item) => item.status === 'pending');
  const purchasedItems = items.filter((item) => item.status === 'purchased');

  const renderItems = (sectionItems: ShoppingItem[]) =>
    sectionItems.map((item) => {
      const busy = busyItemIds.has(item.id);
      const nextStatusLabel =
        item.status === 'pending' ? 'Marcar como comprado' : 'Marcar como pendiente';
      return (
        <article
          key={item.id}
          className="grid gap-3 rounded-xl border border-bistro-border bg-white p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] sm:items-center"
        >
          <div className="min-w-0">
            <h3 className="break-words font-semibold text-bistro-text-primary">
              {item.ingredient_name}
            </h3>
            {item.quantity ? (
              <p className="mt-1 text-sm text-bistro-text-secondary">Cantidad: {item.quantity}</p>
            ) : null}
            <p className="mt-1 text-sm text-bistro-text-secondary">
              Estado: {item.status === 'pending' ? 'Pendiente' : 'Comprado'}
            </p>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              {provenanceLabel(item.source)}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2 sm:max-w-96 sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onToggleStatus(item)}
              className="min-h-11 min-w-0 max-w-full rounded-xl border border-bistro-border px-3 text-left text-sm font-semibold text-bistro-action-primary whitespace-normal break-words hover:bg-bistro-page disabled:cursor-wait disabled:opacity-60"
            >
              {nextStatusLabel}
            </button>
            <ShoppingTransferControls
              item={item}
              busy={busy}
              onTransfer={() => void onTransfer(item)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete(item)}
              className="min-h-11 min-w-0 max-w-full rounded-xl border border-bistro-danger/30 px-3 text-left text-sm font-semibold text-bistro-danger whitespace-normal break-words hover:bg-bistro-danger/10 disabled:cursor-wait disabled:opacity-60"
            >
              Eliminar {item.ingredient_name}
            </button>
          </div>
        </article>
      );
    });

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow sm:p-6">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Lista de compras</h1>
            <p className="mt-1 text-bistro-text-secondary">
              Organizá lo que necesitás para tus próximas comidas.
            </p>
          </div>
          <Link
            href="/app"
            className="min-h-11 rounded-xl px-3 py-2 text-sm font-semibold text-bistro-action-primary hover:bg-bistro-page"
          >
            Volver
          </Link>
        </header>

        {isLoading ? (
          <p role="status" className="mb-4 text-sm text-bistro-text-secondary">
            Cargando lista de compras...
          </p>
        ) : null}
        {loadError ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger"
          >
            {loadError}
          </p>
        ) : null}
        {mutationError ? (
          <p
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger"
          >
            {mutationError}
          </p>
        ) : null}

        {!isLoading && !loadError && items.length === 0 ? (
          <div className="mb-6 rounded-2xl border border-bistro-border bg-bistro-page p-4 text-sm text-bistro-text-secondary">
            <p className="font-semibold text-bistro-text-primary">Tu lista está vacía.</p>
            <p className="mt-1">Agregá productos aquí o desde un menú que hayas planificado.</p>
            <Link
              href="/meal-planner"
              className="mt-3 inline-flex min-h-11 items-center font-semibold text-bistro-action-primary underline underline-offset-4"
            >
              Planificar mis comidas
            </Link>
          </div>
        ) : null}

        <form
          onSubmit={(event) => void onCreate(event)}
          className="mb-7 grid gap-3 rounded-2xl border border-bistro-border bg-white p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
            Ingrediente
            <input
              required
              value={ingredientName}
              onChange={(event) => setIngredientName(event.target.value)}
              className="h-11 min-w-0 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none focus:border-bistro-action-primary"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
            Cantidad (opcional)
            <input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-11 min-w-0 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none focus:border-bistro-action-primary"
            />
          </label>
          <button
            type="submit"
            disabled={isCreating}
            className="h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white hover:bg-bistro-action-primary-hover disabled:cursor-wait disabled:opacity-60"
          >
            {isCreating ? 'Agregando...' : 'Agregar'}
          </button>
        </form>

        <p className="mb-5 text-sm text-bistro-text-secondary">
          Cuando compres un producto, marcalo como comprado y después elegí «Agregar al inventario»
          para registrar lo que ya tenés en casa.{' '}
          <Link
            href="/recipes/inventory"
            className="font-semibold text-bistro-action-primary underline underline-offset-4"
          >
            Ver mi inventario
          </Link>
        </p>

        <div className="grid gap-6">
          <section aria-labelledby="pending-heading" className="grid gap-3">
            <h2 id="pending-heading" className="text-xl font-semibold">
              Pendientes ({pendingItems.length})
            </h2>
            {pendingItems.length > 0 ? (
              <div className="grid gap-3">{renderItems(pendingItems)}</div>
            ) : (
              <p className="rounded-xl border border-bistro-border bg-white/70 p-4 text-sm text-bistro-text-secondary">
                No tenés compras pendientes.
              </p>
            )}
          </section>

          <section aria-labelledby="purchased-heading" className="grid gap-3">
            <h2 id="purchased-heading" className="text-xl font-semibold">
              Comprados ({purchasedItems.length})
            </h2>
            {purchasedItems.length > 0 ? (
              <div className="grid gap-3">{renderItems(purchasedItems)}</div>
            ) : (
              <p className="rounded-xl border border-bistro-border bg-white/70 p-4 text-sm text-bistro-text-secondary">
                No hay compras marcadas como realizadas.
              </p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
