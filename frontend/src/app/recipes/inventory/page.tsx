'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  detectInventoryCategory,
  getStockBadge,
  isExpiringSoon,
  normalizeInventoryName,
} from '@/lib/inventory/normalize-inventory';
import { safeFetch } from '@/lib/api';
import { formatQuantity, parseQuantity } from '@/lib/inventory/quantity-normalization';

type InventoryItem = {
  id: string;
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  expiration_date: string | null;
  estimated_unit_price: number | null;
  purchase_location: string | null;
  low_stock_threshold: number | null;
};

export default function RecipeInventoryPage() {
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [estimatedUnitPrice, setEstimatedUnitPrice] = useState('');
  const [purchaseLocation, setPurchaseLocation] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await safeFetch<{ items: InventoryItem[] }>('/api/inventory', {
        credentials: 'same-origin',
      });
      if (!result.ok) throw new Error(result.error);
      setRows(result.data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar inventario.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    setWorking(true);
    setError(null);
    try {
      const result = await safeFetch<{ item: InventoryItem }>('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ingredientName: value,
          quantity,
          unit,
          category: category.trim() || detectInventoryCategory(value),
          expirationDate,
          estimatedUnitPrice,
          purchaseLocation,
          lowStockThreshold,
          normalizedName: normalizeInventoryName(value),
        }),
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo guardar ingrediente.');
      }

      setName('');
      setQuantity('');
      setUnit('');
      setCategory('');
      setExpirationDate('');
      setEstimatedUnitPrice('');
      setPurchaseLocation('');
      setLowStockThreshold('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar ingrediente.');
    } finally {
      setWorking(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('¿Eliminar este ingrediente?')) return;
    setWorking(true);
    try {
      const result = await safeFetch<{ ok: true }>(`/api/inventory?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!result.ok) throw new Error(result.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar ingrediente.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Inventario de ingredientes</h1>
            <p className="text-bistro-text-secondary">
              Gestioná tu inventario para mejorar recetas y menús.
            </p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-bistro-action-primary">
            Volver
          </Link>
        </div>

        <form onSubmit={onSubmit} className="grid gap-2 md:grid-cols-[1fr_160px_140px_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ingrediente"
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
          />
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Cantidad"
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unidad"
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
          />
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Categoría"
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none md:col-span-2"
          />
          <input
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
          />
          <input
            type="number"
            step="0.01"
            value={estimatedUnitPrice}
            onChange={(e) => setEstimatedUnitPrice(e.target.value)}
            placeholder="Precio estimado"
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
          />
          <input
            value={purchaseLocation}
            onChange={(e) => setPurchaseLocation(e.target.value)}
            placeholder="Lugar de compra"
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
          />
          <input
            type="number"
            step="0.01"
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
            placeholder="Stock mínimo"
            className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
          />
          <button
            type="submit"
            disabled={working}
            className="h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60"
          >
            {working ? 'Guardando...' : 'Agregar'}
          </button>
        </form>

        {error ? (
          <p className="mt-3 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
            {error}
          </p>
        ) : null}
        {loading ? <p className="mt-3 text-sm text-bistro-text-secondary">Cargando...</p> : null}

        <ul className="mt-4 grid gap-2">
          {rows.map((item) => {
            const parsed = parseQuantity(
              [item.quantity ?? '', item.unit ?? ''].filter(Boolean).join(' ').trim()
            );
            const normalizedLabel =
              parsed.structured && parsed.value !== null
                ? formatQuantity(parsed.value, parsed.unit)
                : null;

            return (
              <li
                key={item.id}
                className="rounded-xl border border-bistro-border bg-white/70 px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{item.ingredient_name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-bistro-text-secondary">
                      {item.quantity ?? 'Sin cantidad'} {item.unit ?? ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => void onDelete(item.id)}
                      disabled={working}
                      className="text-xs text-bistro-danger underline disabled:opacity-60"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      getStockBadge(item.quantity, item.low_stock_threshold ?? null) ===
                      'bajo stock'
                        ? 'border-bistro-warning/30 bg-bistro-warning/10 text-bistro-warning'
                        : 'border-bistro-success/30 bg-bistro-success/10 text-bistro-success'
                    }`}
                  >
                    {getStockBadge(item.quantity, item.low_stock_threshold ?? null) === 'bajo stock'
                      ? 'bajo stock'
                      : 'suficiente'}
                  </span>
                  {isExpiringSoon(item.expiration_date ?? null) ? (
                    <span className="rounded-full border border-bistro-danger/30 bg-bistro-danger/10 px-2 py-0.5 text-[10px] font-semibold text-bistro-danger">
                      vence pronto
                    </span>
                  ) : null}
                  {!item.unit ? (
                    <span className="rounded-full border border-bistro-action-secondary/30 bg-bistro-action-secondary/10 px-2 py-0.5 text-[10px] font-semibold text-bistro-action-secondary">
                      sin unidad
                    </span>
                  ) : null}
                  {!parsed.structured ? (
                    <span className="rounded-full border border-bistro-border/30 bg-bistro-surface-warm/10 px-2 py-0.5 text-[10px] font-semibold text-bistro-text-secondary">
                      cantidad no estructurada
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 grid gap-1 text-xs text-bistro-text-secondary md:grid-cols-2">
                  <span>Cantidad normalizada: {normalizedLabel ?? 'No disponible'}</span>
                  <span>Categoría: {item.category ?? 'Sin categoría'}</span>
                  <span>Vence: {item.expiration_date ?? '—'}</span>
                  <span>Precio estimado: {item.estimated_unit_price ?? '—'}</span>
                  <span>Lugar: {item.purchase_location ?? '—'}</span>
                </div>
              </li>
            );
          })}
          {!loading && rows.length === 0 ? (
            <li className="text-sm text-bistro-text-secondary">
              Aún no tienes ingredientes cargados.
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
