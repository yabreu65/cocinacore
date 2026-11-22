'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import { ShoppingTransferControls, type ShoppingItem } from './ShoppingTransferControls';
import { consolidateShoppingItems, type ConsolidatedShoppingProduct } from './consolidate-shopping';

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
  const [actualPurchaseQuantities, setActualPurchaseQuantities] = useState<Record<string, string>>(
    {}
  );
  const [purchaseBusy, setPurchaseBusy] = useState<string | null>(null);
  const purchaseBusyRef = useRef(false);
  const [purchaseMessage, setPurchaseMessage] = useState<string | null>(null);

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

  const onConfirmPurchase = async (product: ConsolidatedShoppingProduct) => {
    if (
      purchaseBusyRef.current ||
      product.status !== 'pending' ||
      !product.purchaseQuantity ||
      product.needsReview ||
      product.rows.some((row) => busyItemIdsRef.current.has(row.id))
    )
      return;
    const actualQuantity = (
      actualPurchaseQuantities[product.key] ?? product.purchaseQuantity
    ).trim();
    if (!actualQuantity) return;
    if (
      !window.confirm(
        `¿Confirmás que compraste ${actualQuantity} de ${product.name}? Se registrará esa cantidad en el inventario.`
      )
    )
      return;

    purchaseBusyRef.current = true;
    setPurchaseBusy(product.key);
    setMutationError(null);
    setPurchaseMessage(null);
    try {
      const result = await safeFetch<{
        items: ShoppingItem[];
        inventoryItem: { id: string; quantity: string; unit: string };
      }>('/api/shopping-list/purchase-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          groupKey: product.key,
          actualQuantity,
          rows: product.rows.map((row) => ({
            id: row.id,
            ingredientName: row.ingredient_name,
            quantity: row.quantity,
          })),
        }),
      });
      if (!result.ok) throw new Error(result.error || 'No se pudo registrar la compra.');
      if (!componentActiveRef.current) return;
      const updated = new Map(result.data.items.map((row) => [row.id, row]));
      setItems((current) => current.map((row) => updated.get(row.id) ?? row));
      setPurchaseMessage(
        `${product.name}: ${result.data.inventoryItem.quantity} ${result.data.inventoryItem.unit} registrados en el inventario.`
      );
    } catch (error) {
      if (componentActiveRef.current)
        setMutationError(
          error instanceof Error ? error.message : 'No se pudo confirmar la compra.'
        );
    } finally {
      purchaseBusyRef.current = false;
      if (componentActiveRef.current) setPurchaseBusy(null);
    }
  };

  const pendingItems = items.filter((item) => item.status === 'pending');
  const purchasedItems = items.filter((item) => item.status === 'purchased');
  const pendingProducts = consolidateShoppingItems(pendingItems);
  const purchasedProducts = consolidateShoppingItems(purchasedItems);

  const renderPurchaseForm = (product: ConsolidatedShoppingProduct) => {
    if (product.status !== 'pending' || product.purchaseQuantity === null) return null;
    const busy = purchaseBusy !== null || product.rows.some((row) => busyItemIds.has(row.id));
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onConfirmPurchase(product);
        }}
        className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-bistro-border bg-bistro-page p-3"
      >
        <label className="grid min-w-40 flex-1 gap-1 text-sm font-semibold text-bistro-text-secondary">
          Cantidad realmente comprada
          <input
            aria-label={`Cantidad realmente comprada de ${product.name}`}
            required
            maxLength={64}
            value={actualPurchaseQuantities[product.key] ?? product.purchaseQuantity}
            disabled={busy}
            onChange={(event) =>
              setActualPurchaseQuantities((current) => ({
                ...current,
                [product.key]: event.target.value,
              }))
            }
            className="min-h-11 rounded-lg border border-bistro-border bg-white px-3 text-bistro-text-primary"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-lg bg-bistro-action-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {purchaseBusy === product.key ? 'Registrando...' : 'Confirmar compra e inventario'}
        </button>
      </form>
    );
  };

  const renderItems = (sectionItems: ShoppingItem[], product?: ConsolidatedShoppingProduct) =>
    sectionItems.map((item) => {
      const busy = busyItemIds.has(item.id);
      const alreadyTransferred = Boolean(item.transfer_inventory_item_id || item.transferred_at);
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
            {product?.actualPurchased && item.status === 'purchased' ? (
              <p className="mt-1 text-sm font-semibold text-bistro-success">
                Comprado e ingresado al inventario: {product.actualPurchased}
              </p>
            ) : null}
            {product?.purchase && item.status === 'pending' ? (
              <p className="mt-1 text-sm font-semibold text-bistro-text-primary">
                Comprar: {product.purchase}
              </p>
            ) : null}
            {product?.needsReview && item.status === 'pending' ? (
              <p className="mt-1 text-sm text-bistro-danger">
                Revisar cantidad o presentación antes de comprar.
              </p>
            ) : null}
            <p className="mt-1 text-sm text-bistro-text-secondary">
              Estado: {item.status === 'pending' ? 'Pendiente' : 'Comprado'}
            </p>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              {provenanceLabel(item.source)}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2 sm:max-w-96 sm:justify-end">
            {!alreadyTransferred ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onToggleStatus(item)}
                className="min-h-11 min-w-0 max-w-full rounded-xl border border-bistro-border px-3 text-left text-sm font-semibold text-bistro-action-primary whitespace-normal break-words hover:bg-bistro-page disabled:cursor-wait disabled:opacity-60"
              >
                {nextStatusLabel}
              </button>
            ) : null}
            <ShoppingTransferControls
              item={item}
              busy={busy}
              onTransfer={() => void onTransfer(item)}
            />
            {!alreadyTransferred ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDelete(item)}
                className="min-h-11 min-w-0 max-w-full rounded-xl border border-bistro-danger/30 px-3 text-left text-sm font-semibold text-bistro-danger whitespace-normal break-words hover:bg-bistro-danger/10 disabled:cursor-wait disabled:opacity-60"
              >
                Eliminar {item.ingredient_name}
              </button>
            ) : null}
          </div>
        </article>
      );
    });

  const renderProducts = (products: ConsolidatedShoppingProduct[]) =>
    products.map((product) =>
      product.rows.length === 1 ? (
        <div key={product.key}>
          {renderItems(product.rows, product)}
          {renderPurchaseForm(product)}
        </div>
      ) : (
        <section
          key={product.key}
          aria-label={`${product.name} consolidado`}
          className="rounded-xl border border-bistro-border bg-white p-4"
        >
          <h3 className="font-semibold text-bistro-text-primary">{product.name}</h3>
          <p className="mt-1 text-sm text-bistro-text-secondary">Necesario: {product.required}</p>
          {product.actualPurchased ? (
            <p className="mt-1 text-sm font-semibold text-bistro-success">
              Comprado e ingresado al inventario: {product.actualPurchased}
            </p>
          ) : null}
          {product.purchase && product.status === 'pending' ? (
            <p className="mt-1 text-sm font-semibold text-bistro-text-primary">
              Comprar: {product.purchase}
            </p>
          ) : null}
          {product.needsReview && product.status === 'pending' ? (
            <p className="mt-1 text-sm text-bistro-danger">
              Revisar cantidades antes de elegir una presentación.
            </p>
          ) : null}
          {renderPurchaseForm(product)}
          <details className="mt-3 rounded-lg border border-bistro-border p-3">
            <summary className="cursor-pointer text-sm font-semibold text-bistro-action-primary">
              Gestionar {product.rows.length} registros de origen
            </summary>
            <p className="my-2 text-xs text-bistro-text-secondary">
              La sugerencia de compra no cambia las cantidades originales ni el inventario. Las
              acciones de compra e inventario siguen disponibles por registro.
            </p>
            <div className="grid gap-2">{renderItems(product.rows)}</div>
          </details>
        </section>
      )
    );

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-5xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-bistro-champagne">
              Todo listo para comprar
            </p>
            <h1 className="mt-2 font-bistro-heading text-3xl font-semibold sm:text-4xl">
              Lista de compras
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
              Marcá lo que compraste y pasalo al inventario cuando lo tengas en casa.
            </p>
          </div>
          <Link
            href="/app"
            className="min-h-11 rounded-xl border border-white/40 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
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
        {purchaseMessage ? (
          <p
            role="status"
            className="mb-4 rounded-xl border border-bistro-border p-3 text-sm font-semibold text-bistro-success"
          >
            {purchaseMessage}
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
          className="mb-5 grid gap-3 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-5"
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

        <details className="group mb-5 rounded-xl border border-bistro-border bg-white px-3 py-2 text-sm text-bistro-text-secondary">
          <summary className="min-h-10 cursor-pointer py-2 font-semibold text-bistro-action-primary">
            Cómo funcionan las cantidades y el inventario
          </summary>
          <div className="mt-2 border-t border-bistro-border pt-3">
            <p className="mb-3 text-sm text-bistro-text-secondary">
              Los ingredientes equivalentes se muestran juntos. «Necesario» conserva lo que
              requieren las recetas; «Comprar» sugiere envases completos cuando hay una presentación
              conocida. No se modifica la cantidad guardada ni se añade inventario automáticamente.
            </p>
            <p className="mb-5 text-sm text-bistro-text-secondary">
              Cuando compres un producto, marcalo como comprado y después elegí «Agregar al
              inventario» para registrar lo que ya tenés en casa.{' '}
              <Link
                href="/recipes/inventory"
                className="font-semibold text-bistro-action-primary underline underline-offset-4"
              >
                Ver mi inventario
              </Link>
            </p>
          </div>
        </details>

        <div className="grid gap-6">
          <section aria-labelledby="pending-heading" className="grid gap-3">
            <h2 id="pending-heading" className="text-xl font-semibold">
              Pendientes ({pendingProducts.length})
            </h2>
            {pendingItems.length > 0 ? (
              <div className="grid gap-3">{renderProducts(pendingProducts)}</div>
            ) : (
              <p className="rounded-xl border border-bistro-border bg-white/70 p-4 text-sm text-bistro-text-secondary">
                No tenés compras pendientes.
              </p>
            )}
          </section>

          <section aria-labelledby="purchased-heading" className="grid gap-3">
            <h2 id="purchased-heading" className="text-xl font-semibold">
              Comprados ({purchasedProducts.length})
            </h2>
            {purchasedItems.length > 0 ? (
              <div className="grid gap-3">{renderProducts(purchasedProducts)}</div>
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
