'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  detectInventoryCategory,
  isExpiringSoon,
  normalizeInventoryName,
} from '@/lib/inventory/normalize-inventory';
import { safeFetch } from '@/lib/api';
import {
  INVENTORY_CURRENCIES,
  calculateInventoryCost,
  isInventoryCurrency,
  readInventoryPrice,
  roundInventoryCost,
  validatePriceReference,
  type InventoryCurrency,
  type StoredInventoryPrice,
} from '@/lib/inventory/inventory-price';
import type { InventoryCurrencySettings } from '@/lib/db/repositories/inventoryCurrencyRepository';

import {
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  inventoryStockState,
  validateInventoryFields,
} from '@/lib/inventory/inventory-input';

type InventoryItem = StoredInventoryPrice & {
  id: string;
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  expiration_date: string | null;
  purchase_location: string | null;
  low_stock_threshold: number | string | null;
};

const CURRENCY_LABELS: Record<InventoryCurrency, string> = {
  ARS: 'Peso argentino',
  COP: 'Peso colombiano',
  VES: 'Bolívar venezolano',
  USD: 'Dólar estadounidense',
  EUR: 'Euro',
  MXN: 'Peso mexicano',
  CLP: 'Peso chileno',
  PEN: 'Sol peruano',
};
const fieldClass =
  'h-11 min-w-0 rounded-xl border border-bistro-border bg-white px-3 focus-visible:outline-2 focus-visible:outline-bistro-action-primary';
type PriceDraft = {
  amount: string;
  currency: string;
  referenceQuantity: string;
  referenceUnit: string;
};
const emptyPrice = (currency = ''): PriceDraft => ({
  amount: '',
  currency,
  referenceQuantity: '',
  referenceUnit: '',
});

function CurrencyOptions() {
  return (
    <>
      {INVENTORY_CURRENCIES.map((currency) => (
        <option key={currency} value={currency}>
          {currency} — {CURRENCY_LABELS[currency]}
        </option>
      ))}
    </>
  );
}

function PriceFields({
  value,
  onChange,
  disabled,
}: {
  value: PriceDraft;
  onChange: (value: PriceDraft) => void;
  disabled: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="grid gap-3 rounded-xl border border-bistro-border p-3 sm:grid-cols-2 md:grid-cols-4"
    >
      <legend className="px-1 text-sm font-semibold">Precio de referencia</legend>
      <label className="grid gap-1 text-sm font-semibold">
        Importe
        <input
          inputMode="decimal"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          placeholder="Ej. 4000"
          className={fieldClass}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Moneda del precio
        <select
          value={value.currency}
          onChange={(e) => onChange({ ...value, currency: e.target.value })}
          className={fieldClass}
        >
          <option value="">Seleccionar</option>
          <CurrencyOptions />
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Cantidad de referencia
        <input
          inputMode="decimal"
          value={value.referenceQuantity}
          onChange={(e) => onChange({ ...value, referenceQuantity: e.target.value })}
          placeholder="Ej. 1"
          className={fieldClass}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Unidad de referencia
        <select
          value={value.referenceUnit}
          onChange={(e) => onChange({ ...value, referenceUnit: e.target.value })}
          className={fieldClass}
        >
          <option value="">Seleccionar</option>
          {INVENTORY_UNITS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs font-normal text-bistro-text-secondary sm:col-span-2 md:col-span-4">
        Ejemplo: 4.000 COP por 1 kg. La cantidad en stock puede ser distinta de la presentación del
        precio.
      </p>
    </fieldset>
  );
}

function formatPrice(amount: string, currency: InventoryCurrency) {
  return new Intl.NumberFormat('es', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 4,
  }).format(Number(amount));
}

function priceDescription(item: InventoryItem): string {
  const state = readInventoryPrice(item);
  if (state.status === 'known')
    return `${formatPrice(state.price.amount, state.price.currency)} por ${state.price.referenceQuantity} ${state.price.referenceUnit}`;
  if (state.status === 'unconfirmed')
    return `${item.estimated_unit_price} — moneda y referencia sin confirmar`;
  if (state.status === 'invalid') return 'Precio por revisar';
  return 'Sin precio';
}

export default function RecipeInventoryPage() {
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [price, setPrice] = useState<PriceDraft>(() => emptyPrice());
  const [settings, setSettings] = useState<InventoryCurrencySettings | null>(null);
  const [currencySelection, setCurrencySelection] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState<PriceDraft>(() => emptyPrice());
  const [notice, setNotice] = useState<string | null>(null);
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
    let active = true;
    async function loadSettings() {
      try {
        const result = await safeFetch<InventoryCurrencySettings>('/api/inventory/currency', {
          credentials: 'same-origin',
        });
        if (!result.ok) throw new Error(result.error);
        if (!active) return;
        setSettings(result.data);
        setCurrencySelection(result.data.currency ?? '');
        setPrice((current) =>
          current.amount || current.currency || current.referenceQuantity || current.referenceUnit
            ? current
            : emptyPrice(result.data.currency ?? '')
        );
      } catch (error) {
        if (active)
          setSettingsError(error instanceof Error ? error.message : 'No se pudo cargar la moneda.');
      } finally {
        if (active) setSettingsLoading(false);
      }
    }
    void loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const saveCurrency = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings?.canManageCurrency || !isInventoryCurrency(currencySelection) || settingsSaving)
      return;
    setSettingsSaving(true);
    setSettingsError(null);
    setNotice(null);
    try {
      const result = await safeFetch<InventoryCurrencySettings>('/api/inventory/currency', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: currencySelection }),
      });
      if (!result.ok) throw new Error(result.error);
      setSettings(result.data);
      setCurrencySelection(result.data.currency ?? '');
      // Only empty drafts follow the preference. Never relabel a draft with an amount.
      setPrice((current) =>
        current.amount || current.referenceQuantity || current.referenceUnit
          ? current
          : emptyPrice(result.data.currency ?? '')
      );
      setNotice('Moneda guardada. Los precios registrados conservan su moneda original.');
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'No se pudo guardar la moneda.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const startPriceEdit = (item: InventoryItem) => {
    const state = readInventoryPrice(item);
    setEditingPrice(
      state.status === 'known'
        ? { ...state.price }
        : {
            ...emptyPrice(),
            amount: item.estimated_unit_price == null ? '' : String(item.estimated_unit_price),
          }
    );
    setEditingId(item.id);
    setError(null);
    setNotice(null);
  };

  const saveItemPrice = async (event: FormEvent, id: string) => {
    event.preventDefault();
    if (working || loading || editingId !== id) return;
    const validated = validatePriceReference(editingPrice);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await safeFetch<{ item: InventoryItem }>('/api/inventory', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, priceReference: validated.price }),
      });
      if (!result.ok) throw new Error(result.error);
      setRows((current) => current.map((item) => (item.id === id ? result.data.item : item)));
      setEditingId(null);
      setNotice('Precio de referencia guardado.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar el precio.');
    } finally {
      setWorking(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || working || loading) return;
    const validated = validateInventoryFields({
      quantity,
      unit,
      lowStockThreshold,
    });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    const hasPrice = Boolean(
      price.amount.trim() || price.referenceQuantity.trim() || price.referenceUnit
    );
    const validatedPrice = hasPrice ? validatePriceReference(price) : null;
    if (validatedPrice && !validatedPrice.ok) {
      setError(validatedPrice.error);
      return;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await safeFetch<{ item: InventoryItem }>('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ingredientName: value,
          quantity: validated.quantity ?? '',
          unit: validated.unit ?? '',
          category: category.trim() || detectInventoryCategory(value),
          expirationDate,
          ...(validatedPrice?.ok ? { priceReference: validatedPrice.price } : {}),
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
      setPrice(emptyPrice(settings?.currency ?? ''));
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

        <section
          aria-labelledby="inventory-currency-heading"
          className="mb-4 rounded-xl border border-bistro-border bg-bistro-page p-3"
        >
          <h2 id="inventory-currency-heading" className="font-semibold">
            Moneda de la organización
          </h2>
          <p className="text-sm text-bistro-text-secondary">
            {settingsLoading
              ? 'Cargando configuración...'
              : !settings
                ? 'No se pudo consultar la moneda de trabajo.'
                : settings.currency
                  ? `Moneda de trabajo: ${settings.currency} — ${CURRENCY_LABELS[settings.currency]}`
                  : 'Moneda de trabajo sin configurar.'}
          </p>
          {settings?.canManageCurrency ? (
            <form onSubmit={saveCurrency} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="grid flex-1 gap-1 text-sm font-semibold">
                Elegir moneda
                <select
                  value={currencySelection}
                  onChange={(e) => setCurrencySelection(e.target.value)}
                  disabled={settingsSaving}
                  className={fieldClass}
                >
                  <option value="">Seleccionar</option>
                  <CurrencyOptions />
                </select>
              </label>
              <button
                type="submit"
                disabled={
                  settingsSaving ||
                  !isInventoryCurrency(currencySelection) ||
                  currencySelection === settings.currency
                }
                className="h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60"
              >
                {settingsSaving ? 'Guardando...' : 'Guardar moneda'}
              </button>
            </form>
          ) : (
            settings && (
              <p className="mt-1 text-xs text-bistro-text-secondary">
                Solo propietarios y administradores pueden cambiarla.
              </p>
            )
          )}
          <p className="mt-2 text-xs text-bistro-text-secondary">
            Cambiar esta preferencia no convierte ni modifica los precios ya registrados.
          </p>
          {settingsError && (
            <p role="alert" className="mt-2 text-sm text-bistro-danger">
              {settingsError}
            </p>
          )}
        </section>
        {notice && (
          <p role="status" className="mb-3 text-sm text-bistro-success">
            {notice}
          </p>
        )}

        <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold">
            Ingrediente
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Harina"
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Cantidad
            <input
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Ej. 500"
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Unidad
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={fieldClass}>
              <option value="">Seleccionar</option>
              {INVENTORY_UNITS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold md:col-span-2">
            Categoría
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={fieldClass}
            >
              <option value="">
                Automática{name.trim() ? ` (${detectInventoryCategory(name)})` : ''}
              </option>
              {INVENTORY_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Fecha de vencimiento
            <input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Lugar de compra
            <input
              value={purchaseLocation}
              onChange={(e) => setPurchaseLocation(e.target.value)}
              placeholder="Lugar de compra"
              className={fieldClass}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            {unit ? `Stock mínimo (${unit})` : 'Stock mínimo'}
            <input
              type="number"
              min="0"
              step="0.0001"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
              placeholder={unit ? `Stock mínimo (${unit})` : 'Stock mínimo'}
              className={fieldClass}
            />
          </label>
          <div className="md:col-span-4">
            <PriceFields value={price} onChange={setPrice} disabled={working} />
            <p className="mt-1 text-xs text-bistro-text-secondary">
              Opcional. Deja el importe y la referencia vacíos si aún no conoces el precio.
            </p>
          </div>
          <button
            type="submit"
            disabled={working || loading}
            className="h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60"
          >
            {working ? 'Guardando...' : 'Agregar'}
          </button>
        </form>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger"
          >
            {error}
          </p>
        ) : null}
        {loading ? <p className="mt-3 text-sm text-bistro-text-secondary">Cargando...</p> : null}

        <ul className="mt-4 grid gap-2">
          {rows.map((item) => {
            const stock = inventoryStockState(item.quantity, item.unit, item.low_stock_threshold);
            const priceState = readInventoryPrice(item);
            const stockCost =
              priceState.status === 'known'
                ? calculateInventoryCost({
                    quantity: item.quantity,
                    unit: item.unit,
                    price: priceState.price,
                  })
                : null;
            const parsed = validateInventoryFields({ quantity: item.quantity, unit: item.unit });
            const normalizedLabel =
              parsed.ok && parsed.quantity !== null ? `${parsed.quantity} ${parsed.unit}` : null;

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
                      stock === 'agotado' ||
                      stock === 'bajo stock' ||
                      stock === 'revisar cantidad' ||
                      stock === 'sin cantidad'
                        ? 'border-bistro-warning/30 bg-bistro-warning/10 text-bistro-warning'
                        : 'border-bistro-success/30 bg-bistro-success/10 text-bistro-success'
                    }`}
                  >
                    {stock}
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
                  {!parsed.ok ? (
                    <span className="rounded-full border border-bistro-border/30 bg-bistro-surface-warm/10 px-2 py-0.5 text-[10px] font-semibold text-bistro-text-secondary">
                      revisar datos originales
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 grid gap-1 text-xs text-bistro-text-secondary md:grid-cols-2">
                  <span>Cantidad normalizada: {normalizedLabel ?? 'No disponible'}</span>
                  <span>Categoría: {item.category ?? 'Sin categoría'}</span>
                  <span>Vence: {item.expiration_date ?? '—'}</span>
                  <span>Precio: {priceDescription(item)}</span>
                  <span>
                    Valor estimado del stock:{' '}
                    {stockCost?.status === 'known'
                      ? `${stockCost.cost.currency} ${roundInventoryCost(stockCost.cost)}`
                      : 'No disponible'}
                  </span>
                  <span>Lugar: {item.purchase_location ?? '—'}</span>
                </div>
                {editingId === item.id ? (
                  <form
                    onSubmit={(event) => void saveItemPrice(event, item.id)}
                    className="mt-3 grid gap-2"
                  >
                    <PriceFields
                      value={editingPrice}
                      onChange={setEditingPrice}
                      disabled={working}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={working}
                        className="rounded-xl bg-bistro-action-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
                      >
                        Guardar precio
                      </button>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => setEditingId(null)}
                        className="rounded-xl border border-bistro-border px-4 py-2 font-semibold"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={working || loading || editingId !== null}
                    onClick={() => startPriceEdit(item)}
                    className="mt-2 text-sm font-semibold text-bistro-action-primary underline disabled:opacity-60"
                  >
                    {priceState.status === 'known'
                      ? 'Actualizar precio'
                      : priceState.status === 'missing'
                        ? 'Registrar precio'
                        : 'Confirmar precio'}
                  </button>
                )}
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
