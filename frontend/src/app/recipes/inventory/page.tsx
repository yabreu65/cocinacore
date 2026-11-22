'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Plus,
  Package,
  Search,
  ChevronDown,
  Settings2,
  CalendarDays,
  Wheat,
  Beef,
  Carrot,
  Apple,
  Milk,
  CookingPot,
  Leaf,
} from 'lucide-react';
import {
  EMPTY_INVENTORY_FILTERS,
  expiryState,
  filterInventory,
  summarizeInventory,
  type InventoryFilters,
} from '@/lib/inventory/inventory-overview';
import Link from 'next/link';
import { InventorySummary } from './InventorySummary';
import {
  detectInventoryCategory,
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
  type InventoryUnit,
} from '@/lib/inventory/inventory-input';
import { planInventoryStockChange } from '@/lib/inventory/inventory-adjustment';
import {
  conflictAfter409,
  conflictAfterReload,
  conflictAfterReview,
  conversionConfirmationKey,
  isExactConversionConfirmed,
  matchingDuplicateNames,
  maySubmitConflict,
  metadataPatch,
  rebaseMetadata,
  type ConflictPhase,
} from '@/lib/inventory/inventory-editor';

type InventoryItem = StoredInventoryPrice & {
  id: string;
  ingredient_name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  expiration_date: string | null;
  purchase_location: string | null;
  low_stock_threshold: number | string | null;
  notes?: string | null;
  revision: string;
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
type InventoryEditor = { id: string; kind: 'metadata' } | { id: string; kind: 'stock' } | null;
type MetadataDraft = {
  ingredientName: string;
  category: string;
  expirationDate: string;
  purchaseLocation: string;
  lowStockThreshold: string;
  notes: string;
};
const metadataDraft = (item: InventoryItem): MetadataDraft => ({
  ingredientName: item.ingredient_name,
  category: item.category ?? '',
  expirationDate: item.expiration_date?.replace(/T00:00:00(?:\.0+)?Z$/, '') ?? '',
  purchaseLocation: item.purchase_location ?? '',
  lowStockThreshold: item.low_stock_threshold == null ? '' : String(item.low_stock_threshold),
  notes: item.notes ?? '',
});
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
  const [filters, setFilters] = useState<InventoryFilters>(EMPTY_INVENTORY_FILTERS);
  const [formOpen, setFormOpen] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
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
  const [inventoryEditor, setInventoryEditor] = useState<InventoryEditor>(null);
  const [metadata, setMetadata] = useState<MetadataDraft | null>(null);
  const [metadataBaseline, setMetadataBaseline] = useState<MetadataDraft | null>(null);
  const [stockKind, setStockKind] = useState<'count' | 'convert' | 'correct'>('count');
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockUnit, setStockUnit] = useState<InventoryUnit | ''>('');
  const [stockThreshold, setStockThreshold] = useState('');
  const [stockReason, setStockReason] = useState('');
  const [conversionConfirmation, setConversionConfirmation] = useState('');
  const [editorRevision, setEditorRevision] = useState('');
  const [conflictPhase, setConflictPhase] = useState<ConflictPhase>('idle');
  const [duplicateChoice, setDuplicateChoice] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [purchaseLocation, setPurchaseLocation] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await safeFetch<{ items: InventoryItem[] }>('/api/inventory', {
        credentials: 'same-origin',
      });
      if (!result.ok) throw new Error(result.error);
      setRows(result.data.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'No se pudo cargar inventario.');
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

  useEffect(() => {
    if (!formOpen && returnFocus.current && !working && !loading && !loadError) {
      returnFocus.current = false;
      addRef.current?.focus();
    }
  }, [formOpen, working, loading, loadError]);

  useEffect(() => {
    if (formOpen) nameRef.current?.focus();
  }, [formOpen]);

  const openForm = () => {
    setFormOpen(true);
    setError(null);
    setNotice(null);
  };
  const closeForm = () => {
    setFormOpen(false);
    setError(null);
    returnFocus.current = true;
  };
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
    setEditorRevision(item.revision);
    setConflictPhase('idle');
    setEditingId(item.id);
    setInventoryEditor(null);
    setError(null);
    setNotice(null);
  };

  const startMetadataEdit = (item: InventoryItem) => {
    setMetadata(metadataDraft(item));
    setMetadataBaseline(metadataDraft(item));
    setEditorRevision(item.revision);
    setInventoryEditor({ id: item.id, kind: 'metadata' });
    setEditingId(null);
    setConflictPhase('idle');
    setError(null);
    setNotice(null);
  };

  const startStockEdit = (item: InventoryItem) => {
    const parsed = validateInventoryFields({ quantity: item.quantity, unit: item.unit });
    const known = parsed.ok && parsed.quantity !== null && parsed.unit !== null;
    setStockKind(known ? 'count' : 'correct');
    setStockQuantity('');
    setStockUnit(parsed.ok && parsed.quantity !== null && parsed.unit !== null ? parsed.unit : '');
    setStockReason('');
    setStockThreshold('');
    setConversionConfirmation('');
    setEditorRevision(item.revision);
    setInventoryEditor({ id: item.id, kind: 'stock' });
    setEditingId(null);
    setConflictPhase('idle');
    setError(null);
    setNotice(null);
  };

  const saveManagement = async (event: FormEvent, item: InventoryItem) => {
    event.preventDefault();
    if (
      working ||
      !inventoryEditor ||
      inventoryEditor.id !== item.id ||
      !maySubmitConflict(conflictPhase)
    )
      return;
    let body: Record<string, unknown>;
    if (inventoryEditor.kind === 'metadata' && metadata) {
      // metadataPatch includes every changed field, including ingredientName.
      // The final argument lists only fields that may be cleared to null.
      const changes = metadataBaseline
        ? metadataPatch(metadataBaseline, metadata, [
            'category',
            'expirationDate',
            'purchaseLocation',
            'lowStockThreshold',
            'notes',
          ])
        : {};
      if (Object.keys(changes).length === 0) {
        setInventoryEditor(null);
        return;
      }
      body = {
        action: 'metadata',
        id: item.id,
        revision: editorRevision,
        changes,
      };
    } else if (inventoryEditor.kind === 'stock') {
      const snapshot = {
        quantity: item.quantity,
        unit: item.unit,
        lowStockThreshold: item.low_stock_threshold,
      };
      const command =
        stockKind === 'convert'
          ? { kind: 'convert' as const, unit: stockUnit as InventoryUnit }
          : stockKind === 'correct'
            ? {
                kind: 'correct' as const,
                quantity: stockQuantity,
                unit: stockUnit as InventoryUnit,
                lowStockThreshold: stockThreshold || null,
                reason: stockReason,
              }
            : { kind: 'count' as const, quantity: stockQuantity, reason: stockReason };
      const plan = planInventoryStockChange(snapshot, command);
      if (!plan.ok) {
        setError(plan.error);
        return;
      }
      if (stockKind === 'convert') {
        const preview = `${item.quantity} ${item.unit} → ${plan.quantity} ${plan.unit}${plan.lowStockThreshold !== null ? ` · stock mínimo ${plan.lowStockThreshold} ${plan.unit}` : ''}`;
        if (!isExactConversionConfirmed(preview, conversionConfirmation)) {
          setError(
            'Confirma exactamente la vista previa actual de la conversión antes de guardar.'
          );
          return;
        }
      }
      body = { action: 'stock', id: item.id, revision: editorRevision, command };
    } else return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const result = await safeFetch<{ item: InventoryItem }>('/api/inventory/management', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        if (result.status === 409) {
          setConflictPhase(conflictAfter409());
          setConversionConfirmation('');
        }
        throw new Error(result.error);
      }
      setRows((current) => current.map((row) => (row.id === item.id ? result.data.item : row)));
      setInventoryEditor(null);
      setMetadata(null);
      setMetadataBaseline(null);
      setConflictPhase('idle');
      setNotice(
        inventoryEditor.kind === 'metadata' ? 'Detalles guardados.' : 'Existencias actualizadas.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar el ingrediente.');
    } finally {
      setWorking(false);
    }
  };

  const reloadAndReview = async (id: string) => {
    setWorking(true);
    setError(null);
    setConflictPhase(conflictAfter409());
    setConversionConfirmation('');
    try {
      const result = await safeFetch<{ items: InventoryItem[] }>('/api/inventory', {
        credentials: 'same-origin',
      });
      if (!result.ok) throw new Error(result.error);
      const latest = result.data.items.find((row) => row.id === id);
      if (!latest) throw new Error('El ingrediente ya no está disponible.');
      setRows(result.data.items);
      setEditorRevision(latest.revision);
      if (metadata && metadataBaseline) {
        const latestMetadata = metadataDraft(latest);
        setMetadata(rebaseMetadata(metadataBaseline, metadata, latestMetadata));
        setMetadataBaseline(latestMetadata);
      }
      setConflictPhase(conflictAfterReload(true));
      setError(
        'Revisa los datos actuales del ingrediente y confirma la revisión antes de volver a guardar.'
      );
    } catch (e) {
      setConflictPhase(conflictAfterReload(false));
      setError(e instanceof Error ? e.message : 'No se pudo recargar el ingrediente.');
    } finally {
      setWorking(false);
    }
  };

  const saveItemPrice = async (event: FormEvent, id: string) => {
    event.preventDefault();
    if (working || loading || loadError || editingId !== id || !maySubmitConflict(conflictPhase))
      return;
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
        body: JSON.stringify({ id, revision: editorRevision, priceReference: validated.price }),
      });
      if (!result.ok) {
        if (result.status === 409) setConflictPhase(conflictAfter409());
        throw new Error(result.error);
      }
      setRows((current) => current.map((item) => (item.id === id ? result.data.item : item)));
      setEditingId(null);
      setConflictPhase('idle');
      setNotice('Precio de referencia guardado.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo guardar el precio.');
    } finally {
      setWorking(false);
    }
  };

  const reloadPrice = async (id: string) => {
    setWorking(true);
    setError(null);
    try {
      const result = await safeFetch<{ items: InventoryItem[] }>('/api/inventory', {
        credentials: 'same-origin',
      });
      if (!result.ok) throw new Error(result.error);
      const latest = result.data.items.find((row) => row.id === id);
      if (!latest) throw new Error('El ingrediente ya no está disponible.');
      setRows(result.data.items);
      setEditorRevision(latest.revision);
      // Keep the unsaved draft; the row shows the current persisted price.
      setConflictPhase(conflictAfterReload(true));
      setNotice('Precio actual recargado. Compara los valores antes de guardar.');
    } catch (error) {
      setConflictPhase(conflictAfterReload(false));
      setError(error instanceof Error ? error.message : 'No se pudo recargar el precio.');
    } finally {
      setWorking(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || working || loading || loadError || editingId) return;
    const duplicates = matchingDuplicateNames(
      rows,
      value,
      normalizeInventoryName,
      (row) => row.ingredient_name
    );
    if (duplicates.length > 0 && !duplicateChoice) {
      setError(
        `Ya existe ${duplicates.map((row) => `“${row.ingredient_name}”`).join(', ')}. Confirma si quieres conservarlo como un lote separado.`
      );
      return;
    }
    const validated = validateInventoryFields({
      quantity,
      unit,
      lowStockThreshold,
    });
    if (!validated.ok) {
      setOptionalOpen(true);
      setError(validated.error);
      return;
    }
    const hasPrice = Boolean(
      price.amount.trim() || price.referenceQuantity.trim() || price.referenceUnit
    );
    const validatedPrice = hasPrice ? validatePriceReference(price) : null;
    if (validatedPrice && !validatedPrice.ok) {
      setOptionalOpen(true);
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
      setDuplicateChoice(false);
      setFormOpen(false);
      setOptionalOpen(false);
      setFilters(EMPTY_INVENTORY_FILTERS);
      setNotice('Ingrediente agregado correctamente.');
      returnFocus.current = true;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar ingrediente.');
    } finally {
      setWorking(false);
    }
  };

  const onDelete = async (id: string) => {
    if (
      working ||
      loading ||
      loadError ||
      formOpen ||
      editingId ||
      inventoryEditor ||
      !confirm('¿Eliminar este ingrediente?')
    )
      return;
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

  const today = new Date();
  const summary = summarizeInventory(rows, settings?.currency ?? null, today);
  const filteredRows = filterInventory(rows, filters, today);
  const activeEditorItem = inventoryEditor
    ? rows.find((row) => row.id === inventoryEditor.id)
    : undefined;
  const visibleRows =
    activeEditorItem && !filteredRows.some((row) => row.id === activeEditorItem.id)
      ? [...filteredRows, activeEditorItem]
      : filteredRows;
  const categories = [
    ...new Set([...INVENTORY_CATEGORIES, ...rows.map((row) => row.category || 'Sin categoría')]),
  ];
  const hasFilters = Boolean(
    filters.search || filters.category || filters.stock !== 'all' || filters.expiry !== 'all'
  );
  const dataReady = !loading && !loadError;
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-7">
          <div className="min-w-0">
            <Link
              href="/app"
              className="mb-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-bistro-cream hover:text-white"
            >
              <ArrowLeft size={16} aria-hidden="true" /> Inicio
            </Link>
            <p className="text-xs font-bold uppercase tracking-wider text-bistro-champagne">
              Mi cocina · Despensa
            </p>
            <h1 className="mt-1 font-bistro-heading text-3xl font-semibold leading-tight sm:text-4xl">
              Inventario de ingredientes
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
              Lo que tienes, lo que falta y cuánto vale tu despensa.
            </p>
          </div>
          <button
            ref={addRef}
            type="button"
            onClick={openForm}
            aria-expanded={formOpen}
            aria-controls="inventory-add-panel"
            disabled={
              working ||
              loading ||
              !!loadError ||
              formOpen ||
              editingId !== null ||
              inventoryEditor !== null
            }
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-bistro-champagne px-5 py-3 text-sm font-bold text-bistro-text-primary transition hover:bg-white disabled:opacity-60 sm:w-auto"
          >
            <Plus size={19} aria-hidden="true" /> Agregar ingrediente
          </button>
        </header>
        <InventorySummary summary={summary} loading={loading} dataReady={dataReady} />
        <section
          aria-labelledby="inventory-currency-heading"
          className="rounded-2xl border border-bistro-border bg-white p-4 shadow-sm"
        >
          <h2 id="inventory-currency-heading">
            <button
              type="button"
              aria-expanded={currencyOpen}
              aria-controls="inventory-currency-panel"
              onClick={() => setCurrencyOpen((value) => !value)}
              className="flex w-full items-center justify-between gap-2 text-left font-semibold text-bistro-action-secondary"
            >
              <span className="inline-flex items-center gap-2">
                <Settings2 size={18} aria-hidden="true" /> Moneda de la organización{' '}
                {settingsError
                  ? '· Error de consulta'
                  : settings?.currency
                    ? `· ${settings.currency}`
                    : ''}
              </span>
              <ChevronDown
                size={18}
                aria-hidden="true"
                className={currencyOpen ? 'rotate-180' : ''}
              />
            </button>
          </h2>
          <div id="inventory-currency-panel" hidden={!currencyOpen} className="mt-3">
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
          </div>
        </section>
        {notice && (
          <p role="status" className="mb-3 text-sm text-bistro-success">
            {notice}
          </p>
        )}

        <section
          id="inventory-add-panel"
          hidden={!formOpen}
          className="rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="mb-4">
            <h2 className="font-bistro-heading text-bistro-title-sm font-semibold">
              Nuevo ingrediente
            </h2>
            <p className="text-sm text-bistro-text-secondary">
              Solo el nombre es obligatorio. Completa cantidad y unidad si las conoces.
            </p>
          </div>
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-sm font-semibold">
              Ingrediente
              <input
                required
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setDuplicateChoice(false);
                }}
                placeholder="Ej. Harina"
                className={fieldClass}
              />
            </label>
            {name.trim() &&
              matchingDuplicateNames(
                rows,
                name,
                normalizeInventoryName,
                (row) => row.ingredient_name
              ).length > 0 && (
                <label className="flex items-start gap-2 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 p-3 text-sm font-normal sm:col-span-2 lg:col-span-4">
                  <input
                    type="checkbox"
                    checked={duplicateChoice}
                    onChange={(event) => setDuplicateChoice(event.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Coincide con{' '}
                    {matchingDuplicateNames(
                      rows,
                      name,
                      normalizeInventoryName,
                      (row) => row.ingredient_name
                    )
                      .map((row) => `“${row.ingredient_name}”`)
                      .join(', ')}
                    . Si son lotes distintos, confirma que quieres conservar este ingrediente por
                    separado. No se combinarán ni se fusionarán automáticamente.
                  </span>
                </label>
              )}
            <label className="grid gap-1 text-sm font-semibold">
              Cantidad disponible
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
              <select
                aria-label="Unidad"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
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
            <label className="grid gap-1 text-sm font-semibold">
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
            <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-bistro-border bg-bistro-page p-3">
              <button
                type="button"
                onClick={() => setOptionalOpen((v) => !v)}
                aria-expanded={optionalOpen}
                aria-controls="inventory-optional-fields"
                className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-bistro-action-secondary"
              >
                <span>
                  Detalles opcionales: precio, vencimiento y stock mínimo
                  {!optionalOpen &&
                  (price.amount ||
                    price.referenceQuantity ||
                    price.referenceUnit ||
                    expirationDate ||
                    purchaseLocation ||
                    lowStockThreshold)
                    ? ' · Con datos'
                    : ''}
                </span>
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  className={optionalOpen ? 'rotate-180' : ''}
                />
              </button>
              <div
                id="inventory-optional-fields"
                hidden={!optionalOpen}
                className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <label className="grid gap-1 text-sm font-semibold">
                  Fecha de vencimiento
                  <input
                    aria-label="Fecha de vencimiento"
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                    className={fieldClass}
                  />
                  <span className="text-xs font-normal text-bistro-text-secondary">
                    Se valida como fecha calendario local (AAAA-MM-DD), sin convertirla a una hora
                    ni cambiar el día por zona horaria.
                  </span>
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
                    inputMode="decimal"
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(e.target.value)}
                    placeholder={unit ? `Stock mínimo (${unit})` : 'Stock mínimo'}
                    className={fieldClass}
                  />
                </label>
                <div className="sm:col-span-2 lg:col-span-4">
                  <PriceFields value={price} onChange={setPrice} disabled={working} />
                  <p className="mt-1 text-xs text-bistro-text-secondary">
                    Opcional. Deja el importe y la referencia vacíos si aún no conoces el precio.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                disabled={working || loading || !!loadError}
                className="h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60"
              >
                {working ? 'Guardando...' : 'Guardar ingrediente'}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={working}
                className="min-h-11 rounded-xl border border-bistro-border px-4 font-semibold disabled:opacity-60"
              >
                Cerrar (conservar borrador)
              </button>
            </div>
          </form>
        </section>

        {error && editingId === null ? (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger"
          >
            {error}
          </p>
        ) : null}
        <section
          aria-labelledby="inventory-list-heading"
          className="rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="inventory-list-heading"
              className="font-bistro-heading text-bistro-title-sm font-semibold"
            >
              Mi despensa
            </h2>
            <p aria-live="polite" className="text-sm text-bistro-text-secondary">
              {dataReady ? `${visibleRows.length} de ${rows.length} ingredientes` : 'Inventario'}
            </p>
          </div>
          <fieldset
            disabled={editingId !== null || inventoryEditor !== null || working}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <legend className="sr-only">Filtros de inventario</legend>
            <label className="grid gap-1 text-sm font-semibold">
              Buscar ingrediente
              <span className="relative">
                <Search
                  size={17}
                  aria-hidden="true"
                  className="absolute left-3 top-3.5 text-bistro-text-secondary"
                />
                <input
                  type="search"
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((old) => ({ ...old, search: event.target.value }))
                  }
                  placeholder="Ej. Arroz, tomate..."
                  className={`${fieldClass} w-full pl-9`}
                />
              </span>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Categoría
              <select
                value={filters.category}
                onChange={(e) => setFilters((old) => ({ ...old, category: e.target.value }))}
                className={fieldClass}
              >
                <option value="">Todas</option>
                {categories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Existencias
              <select
                value={filters.stock}
                onChange={(e) =>
                  setFilters((old) => ({
                    ...old,
                    stock: e.target.value as InventoryFilters['stock'],
                  }))
                }
                className={fieldClass}
              >
                <option value="all">Todos los estados</option>
                {[
                  'agotado',
                  'bajo stock',
                  'suficiente',
                  'disponible',
                  'sin cantidad',
                  'revisar cantidad',
                ].map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Vencimiento
              <select
                value={filters.expiry}
                onChange={(e) =>
                  setFilters((old) => ({
                    ...old,
                    expiry: e.target.value as InventoryFilters['expiry'],
                  }))
                }
                className={fieldClass}
              >
                <option value="all">Todos</option>
                <option value="expired">Vencidos</option>
                <option value="soon">Próximos (5 días)</option>
                <option value="later">Vigentes</option>
                <option value="missing">Sin fecha</option>
                <option value="invalid">Por revisar</option>
              </select>
            </label>
          </fieldset>
          {hasFilters && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_INVENTORY_FILTERS)}
              disabled={editingId !== null || working}
              className="mt-2 min-h-11 text-sm font-semibold text-bistro-action-primary underline"
            >
              Limpiar filtros
            </button>
          )}
          {loading && (
            <p
              role="status"
              className="mt-4 rounded-xl bg-bistro-page p-4 text-sm text-bistro-text-secondary"
            >
              Cargando inventario...
            </p>
          )}
          {loadError && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-bistro-danger/30 p-4 text-sm text-bistro-danger"
            >
              <p>{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="mt-2 min-h-11 font-semibold underline"
              >
                Volver a intentar
              </button>
            </div>
          )}
          <ul aria-busy={loading} className="mt-4 grid gap-3 lg:grid-cols-2">
            {(dataReady ? visibleRows : []).map((item) => {
              const stock = inventoryStockState(item.quantity, item.unit, item.low_stock_threshold);
              const expiry = expiryState(item.expiration_date, today);
              const CategoryIcon =
                Object.entries({
                  Proteínas: Beef,
                  Verduras: Carrot,
                  Frutas: Apple,
                  Lácteos: Milk,
                  Granos: Wheat,
                  Especias: Leaf,
                  Despensa: CookingPot,
                }).find(([category]) => category === item.category)?.[1] ?? Package;
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
              const requiresStockCorrection =
                !parsed.ok || parsed.quantity === null || parsed.unit === null;
              const normalizedLabel =
                parsed.ok && parsed.quantity !== null ? `${parsed.quantity} ${parsed.unit}` : null;

              return (
                <li
                  key={item.id}
                  className="min-w-0 rounded-2xl border border-bistro-border bg-bistro-surface p-4 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 rounded-xl bg-bistro-surface-warm p-2 text-bistro-action-secondary">
                        <CategoryIcon size={22} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold">{item.ingredient_name}</h3>
                        <p className="text-xs text-bistro-text-secondary">
                          {item.category ?? 'Sin categoría'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">
                        {item.quantity ?? 'Sin cantidad'} {item.unit ?? ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => void onDelete(item.id)}
                        disabled={
                          working ||
                          loading ||
                          !!loadError ||
                          formOpen ||
                          editingId !== null ||
                          inventoryEditor !== null
                        }
                        className="min-h-11 px-2 text-xs text-bistro-danger underline disabled:opacity-60"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
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
                    {expiry === 'expired' || expiry === 'soon' || expiry === 'invalid' ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${expiry === 'expired' ? 'border-bistro-danger/30 bg-bistro-danger/10 text-bistro-danger' : 'border-bistro-warning/30 bg-bistro-warning/10 text-bistro-warning'}`}
                      >
                        <CalendarDays size={12} aria-hidden="true" className="mr-1 inline" />
                        {expiry === 'expired'
                          ? 'Vencido'
                          : expiry === 'soon'
                            ? 'Vence pronto'
                            : 'Fecha por revisar'}
                      </span>
                    ) : null}
                    {!item.unit ? (
                      <span className="rounded-full border border-bistro-action-secondary/30 bg-bistro-action-secondary/10 px-2 py-0.5 text-xs font-semibold text-bistro-action-secondary">
                        sin unidad
                      </span>
                    ) : null}
                    {!parsed.ok ? (
                      <span className="rounded-full border border-bistro-border/30 bg-bistro-surface-warm/10 px-2 py-0.5 text-xs font-semibold text-bistro-text-secondary">
                        revisar datos originales
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 grid gap-1 text-xs text-bistro-text-secondary md:grid-cols-2">
                    <span>Cantidad normalizada: {normalizedLabel ?? 'No disponible'}</span>
                    <span>
                      Vence:{' '}
                      {item.expiration_date
                        ? item.expiration_date.replace(/T00:00:00(?:\.0+)?Z$/, '')
                        : 'Sin fecha'}
                    </span>
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
                        disabled={working || !maySubmitConflict(conflictPhase)}
                      />
                      {error && (
                        <p role="alert" className="text-sm text-bistro-danger">
                          {error}
                        </p>
                      )}
                      {conflictPhase === 'review-required' && (
                        <div className="rounded-xl border border-bistro-border p-3 text-sm">
                          <p>Precio actual: {priceDescription(item)}</p>
                          <p>Tu borrador se conserva arriba. Revisa ambos valores.</p>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => setConflictPhase(conflictAfterReview(true))}
                            className="mt-2 font-semibold text-bistro-action-primary"
                          >
                            Revisé el precio actual
                          </button>
                        </div>
                      )}
                      {conflictPhase === 'reload-required' && (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => void reloadPrice(item.id)}
                          className="justify-self-start text-sm font-semibold text-bistro-action-primary"
                        >
                          Recargar precio actual
                        </button>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={working || !maySubmitConflict(conflictPhase)}
                          className="rounded-xl bg-bistro-action-primary px-4 py-2 font-semibold text-white disabled:opacity-60"
                        >
                          Guardar precio
                        </button>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => {
                            setEditingId(null);
                            setError(null);
                          }}
                          className="rounded-xl border border-bistro-border px-4 py-2 font-semibold"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        working ||
                        loading ||
                        !!loadError ||
                        formOpen ||
                        editingId !== null ||
                        inventoryEditor !== null
                      }
                      onClick={() => startPriceEdit(item)}
                      className="mt-2 min-h-11 text-sm font-semibold text-bistro-action-primary underline disabled:opacity-60"
                    >
                      {priceState.status === 'known'
                        ? 'Actualizar precio'
                        : priceState.status === 'missing'
                          ? 'Registrar precio'
                          : 'Confirmar precio'}
                    </button>
                  )}
                  {inventoryEditor?.id === item.id ? (
                    <form
                      onSubmit={(event) => void saveManagement(event, item)}
                      className="mt-3 grid gap-3"
                    >
                      {inventoryEditor.kind === 'metadata' && metadata ? (
                        <fieldset
                          disabled={working}
                          className="grid gap-3 rounded-xl border border-bistro-border p-3 sm:grid-cols-2"
                        >
                          <legend className="px-1 text-sm font-semibold">Editar detalles</legend>
                          <label className="grid gap-1 text-sm font-semibold">
                            Nombre del ingrediente
                            <input
                              value={metadata.ingredientName}
                              onChange={(event) =>
                                setMetadata({ ...metadata, ingredientName: event.target.value })
                              }
                              className={fieldClass}
                              required
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-semibold">
                            Categoría
                            <select
                              value={metadata.category}
                              onChange={(event) =>
                                setMetadata({ ...metadata, category: event.target.value })
                              }
                              className={fieldClass}
                            >
                              <option value="">Sin categoría</option>
                              {INVENTORY_CATEGORIES.map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-1 text-sm font-semibold">
                            Fecha de vencimiento
                            <input
                              type="date"
                              value={metadata.expirationDate}
                              onChange={(event) =>
                                setMetadata({ ...metadata, expirationDate: event.target.value })
                              }
                              className={fieldClass}
                            />
                            <span className="text-xs font-normal text-bistro-text-secondary">
                              Fecha calendario local (AAAA-MM-DD); no se convierte a hora ni cambia
                              de día por zona horaria.
                            </span>
                          </label>
                          <label className="grid gap-1 text-sm font-semibold">
                            Lugar de compra
                            <input
                              value={metadata.purchaseLocation}
                              onChange={(event) =>
                                setMetadata({ ...metadata, purchaseLocation: event.target.value })
                              }
                              className={fieldClass}
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-semibold">
                            {item.unit ? `Stock mínimo (${item.unit})` : 'Stock mínimo'}
                            <input
                              inputMode="decimal"
                              value={metadata.lowStockThreshold}
                              onChange={(event) =>
                                setMetadata({ ...metadata, lowStockThreshold: event.target.value })
                              }
                              className={fieldClass}
                            />
                          </label>
                          <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                            Notas
                            <textarea
                              rows={3}
                              value={metadata.notes}
                              onChange={(event) =>
                                setMetadata({ ...metadata, notes: event.target.value })
                              }
                              className="rounded-xl border border-bistro-border bg-white p-3"
                            />
                          </label>
                        </fieldset>
                      ) : (
                        <fieldset
                          disabled={working}
                          className="grid gap-3 rounded-xl border border-bistro-border p-3 sm:grid-cols-2"
                        >
                          <legend className="px-1 text-sm font-semibold">
                            Ajustar existencias
                          </legend>
                          <label className="grid gap-1 text-sm font-semibold">
                            Tipo de ajuste
                            <select
                              value={stockKind}
                              onChange={(event) => {
                                setStockKind(event.target.value as 'count' | 'convert' | 'correct');
                                setConversionConfirmation('');
                              }}
                              className={fieldClass}
                            >
                              <option value="count">Conteo físico</option>
                              <option value="convert">Convertir unidad</option>
                              {requiresStockCorrection ? (
                                <option value="correct">Corregir datos ambiguos</option>
                              ) : null}
                            </select>
                          </label>
                          {stockKind === 'convert' ? (
                            <label className="grid gap-1 text-sm font-semibold">
                              Nueva unidad
                              <select
                                value={stockUnit}
                                onChange={(event) => {
                                  setStockUnit(event.target.value as InventoryUnit | '');
                                  setConversionConfirmation('');
                                }}
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
                          ) : (
                            <>
                              <label className="grid gap-1 text-sm font-semibold">
                                {stockKind === 'correct'
                                  ? 'Cantidad física confirmada'
                                  : `Cantidad contada (${item.unit ?? 'unidad'})`}
                                <input
                                  inputMode="decimal"
                                  value={stockQuantity}
                                  onChange={(event) => setStockQuantity(event.target.value)}
                                  className={fieldClass}
                                  required
                                />
                              </label>
                              {stockKind === 'correct' && (
                                <label className="grid gap-1 text-sm font-semibold">
                                  Unidad confirmada
                                  <select
                                    value={stockUnit}
                                    onChange={(event) =>
                                      setStockUnit(event.target.value as InventoryUnit | '')
                                    }
                                    className={fieldClass}
                                    required
                                  >
                                    <option value="">Seleccionar</option>
                                    {INVENTORY_UNITS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </>
                          )}
                          {stockKind === 'correct' && (
                            <label className="grid gap-1 text-sm font-semibold">
                              Stock mínimo confirmado (opcional)
                              <input
                                inputMode="decimal"
                                value={stockThreshold}
                                onChange={(event) => setStockThreshold(event.target.value)}
                                className={fieldClass}
                              />
                            </label>
                          )}
                          {stockKind !== 'convert' && (
                            <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                              Motivo
                              <input
                                value={stockReason}
                                onChange={(event) => setStockReason(event.target.value)}
                                maxLength={300}
                                className={fieldClass}
                                required
                              />
                            </label>
                          )}
                          {stockKind === 'correct' && (
                            <div className="sm:col-span-2 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 p-3 text-sm">
                              <p className="font-semibold">Snapshot original sin interpretar</p>
                              <pre className="mt-1 whitespace-pre-wrap break-all">
                                {JSON.stringify(
                                  {
                                    quantity: item.quantity,
                                    unit: item.unit,
                                    lowStockThreshold: item.low_stock_threshold,
                                  },
                                  null,
                                  2
                                )}
                              </pre>
                              <p>
                                Confirma una cantidad, unidad y motivo nuevos; no se infiere un
                                ajuste desde estos datos.
                              </p>
                            </div>
                          )}
                          {stockKind === 'convert' &&
                            (() => {
                              const plan = stockUnit
                                ? planInventoryStockChange(
                                    {
                                      quantity: item.quantity,
                                      unit: item.unit,
                                      lowStockThreshold: item.low_stock_threshold,
                                    },
                                    { kind: 'convert', unit: stockUnit }
                                  )
                                : null;
                              const preview = plan?.ok
                                ? `${item.quantity} ${item.unit} → ${plan.quantity} ${plan.unit}${plan.lowStockThreshold !== null ? ` · stock mínimo ${plan.lowStockThreshold} ${plan.unit}` : ''}`
                                : '';
                              const key = preview ? conversionConfirmationKey(preview) : '';
                              return (
                                <div
                                  className="sm:col-span-2 rounded-xl bg-bistro-page p-3 text-sm"
                                  aria-live="polite"
                                >
                                  {plan?.ok ? (
                                    <>
                                      <p>Vista previa exacta: {preview}</p>
                                      <label className="mt-2 flex items-start gap-2">
                                        <input
                                          type="checkbox"
                                          checked={conversionConfirmation === key}
                                          onChange={(event) =>
                                            setConversionConfirmation(
                                              event.target.checked ? key : ''
                                            )
                                          }
                                          className="mt-1"
                                        />
                                        <span>
                                          Confirmo exactamente esta conversión compatible sin cambio
                                          de cantidad física: {preview}
                                        </span>
                                      </label>
                                    </>
                                  ) : (
                                    <p>
                                      {plan?.error ??
                                        'Selecciona una unidad compatible. Solo se convierten g↔kg y ml↔l; no se permiten redondeos.'}
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                        </fieldset>
                      )}
                      {conflictPhase === 'review-required' && (
                        <div className="rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 p-3 text-sm">
                          <p className="font-semibold">
                            Revisá los datos actuales frente a tu borrador
                          </p>
                          {inventoryEditor.kind === 'metadata' && metadata && metadataBaseline && (
                            <dl className="mt-2 grid gap-1">
                              {Object.keys(metadata).map((key) => {
                                const field = key as keyof MetadataDraft;
                                return (
                                  <div key={key}>
                                    <dt className="inline font-semibold">{key}: </dt>
                                    <dd className="inline">
                                      Actual: {String(metadataBaseline[field] || '—')} · Borrador:{' '}
                                      {String(metadata[field] || '—')}
                                    </dd>
                                  </div>
                                );
                              })}
                            </dl>
                          )}
                          {inventoryEditor.kind === 'stock' && (
                            <p className="mt-2">
                              Stock actual: {item.quantity ?? '—'}{' '}
                              {item.unit ?? '(unidad desconocida)'} · Tu borrador:{' '}
                              {stockKind === 'convert'
                                ? `${item.quantity ?? '—'} ${item.unit ?? '(unidad desconocida)'} → ${stockUnit || '(sin unidad)'}`
                                : `${stockQuantity || '(sin cantidad)'} ${stockKind === 'correct' ? stockUnit || '(sin unidad)' : (item.unit ?? '(unidad desconocida)')}`}
                            </p>
                          )}
                          <p className="mt-2">
                            La recarga exitosa actualizó los valores no editados; solo se
                            conservaron los campos que habías cambiado.
                          </p>
                        </div>
                      )}
                      {(conflictPhase === 'review-required' || conflictPhase === 'ready') && (
                        <label className="flex items-start gap-2 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 p-3 text-sm">
                          <input
                            type="checkbox"
                            checked={conflictPhase === 'ready'}
                            onChange={(event) =>
                              setConflictPhase(conflictAfterReview(event.target.checked))
                            }
                            className="mt-1"
                          />
                          <span>
                            Revisé los datos recargados y confirmo que quiero volver a enviar mi
                            borrador pendiente.
                          </span>
                        </label>
                      )}
                      {error && (
                        <p role="alert" className="text-sm text-bistro-danger">
                          {error}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={
                            working ||
                            !maySubmitConflict(conflictPhase) ||
                            (inventoryEditor.kind === 'stock' &&
                              stockKind === 'convert' &&
                              !conversionConfirmation)
                          }
                          className="min-h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60"
                        >
                          Guardar cambios
                        </button>
                        {conflictPhase !== 'idle' && (
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => void reloadAndReview(item.id)}
                            className="min-h-11 rounded-xl border border-bistro-border px-4 font-semibold"
                          >
                            Recargar y revisar
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => {
                            setInventoryEditor(null);
                            setMetadata(null);
                            setMetadataBaseline(null);
                            setConflictPhase('idle');
                            setConversionConfirmation('');
                            setError(null);
                          }}
                          className="min-h-11 rounded-xl border border-bistro-border px-4 font-semibold"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={
                          working ||
                          loading ||
                          !!loadError ||
                          formOpen ||
                          editingId !== null ||
                          inventoryEditor !== null
                        }
                        onClick={() => startMetadataEdit(item)}
                        className="min-h-11 text-sm font-semibold text-bistro-action-primary underline disabled:opacity-60"
                      >
                        Editar detalles
                      </button>
                      <button
                        type="button"
                        disabled={
                          working ||
                          loading ||
                          !!loadError ||
                          formOpen ||
                          editingId !== null ||
                          inventoryEditor !== null
                        }
                        onClick={() => startStockEdit(item)}
                        className="min-h-11 text-sm font-semibold text-bistro-action-primary underline disabled:opacity-60"
                      >
                        Ajustar existencias
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
            {dataReady && visibleRows.length === 0 && (
              <li className="rounded-xl border border-dashed border-bistro-border bg-bistro-page p-6 text-center lg:col-span-2">
                <Package
                  className="mx-auto mb-2 text-bistro-action-secondary"
                  size={32}
                  aria-hidden="true"
                />
                <p className="font-semibold">
                  {rows.length
                    ? 'No encontramos ingredientes con esos filtros'
                    : 'Tu despensa está lista para comenzar'}
                </p>
                <p className="mt-1 text-sm text-bistro-text-secondary">
                  {rows.length
                    ? 'Prueba otra búsqueda o limpia los filtros.'
                    : 'Agrega el primer ingrediente para organizar tus compras y recetas.'}
                </p>
                <button
                  type="button"
                  onClick={rows.length ? () => setFilters(EMPTY_INVENTORY_FILTERS) : openForm}
                  disabled={working || editingId !== null || (!rows.length && formOpen)}
                  className="mt-3 min-h-11 rounded-xl border border-bistro-border bg-bistro-surface px-4 font-semibold text-bistro-action-primary disabled:opacity-60"
                >
                  {rows.length ? 'Limpiar filtros' : 'Agregar primer ingrediente'}
                </button>
              </li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
