'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle2, ChevronDown, ChevronUp, Clipboard, Eye, ShoppingBasket, Sparkles, XCircle } from 'lucide-react';
import type { GenerationMode, IngredientSplit, RecipeCitation, RecipeSections, StructuredRecipeIngredient } from './types';

type Props = {
  open: boolean;
  recipe: string;
  recipeMode: GenerationMode;
  peopleCount: number;
  level: string;
  region: string;
  style: string;
  parsedRecipe: RecipeSections | null;
  citations: RecipeCitation[];
  structuredIngredients: StructuredRecipeIngredient[];
  selectedInventory: string[];
  savingRecipe: boolean;
  onClose: () => void;
  onSave: () => void;
};

type SectionKey = 'ingredients' | 'preparation' | 'tips' | 'origin';

function splitIngredientLine(line: string): IngredientSplit {
  const normalized = line.replace(/^[-•]\s*/, '').trim();
  const match = normalized.match(/^(\d+[\/\d.,]*\s*(?:g|kg|ml|l|taza(?:s)?|cucharada(?:s)?|cucharadita(?:s)?|unidad(?:es)?|huevo(?:s)?|diente(?:s)?|ramita(?:s)?)?)\s+(.*)$/i);
  if (!match) return { quantity: '—', name: normalized };
  return { quantity: match[1].trim(), name: match[2].trim() };
}

function safeSimilarity(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function RecipeView(props: Props) {
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    ingredients: true,
    preparation: true,
    tips: true,
    origin: true,
  });

  const ingredientRows = useMemo(
    () => (props.parsedRecipe?.ingredients ?? []).map((item) => splitIngredientLine(item)),
    [props.parsedRecipe?.ingredients],
  );
  const displayIngredients = useMemo(() => {
    if (props.structuredIngredients.length > 0) return props.structuredIngredients;
    return ingredientRows.map((row) => ({
      name: row.name,
      normalized_name: normalize(row.name),
      quantity: row.quantity === '—' ? null : Number(row.quantity),
      unit: row.quantity === '—' ? null : null,
      optional_quantity_text: row.quantity === '—' ? row.name : null,
      category: null,
      estimated_cost_optional: null,
      structured: false,
    }));
  }, [ingredientRows, props.structuredIngredients]);

  const inventorySignals = useMemo(() => props.selectedInventory.map((item) => normalize(item)), [props.selectedInventory]);

  const ingredientStatus = useMemo(() => {
    const available: StructuredRecipeIngredient[] = [];
    const missing: StructuredRecipeIngredient[] = [];

    displayIngredients.forEach((row) => {
      const ingredientName = normalize(row.name);
      const isAvailable = inventorySignals.some((signal) => signal.length > 2 && ingredientName.includes(signal));
      if (isAvailable) available.push(row);
      else missing.push(row);
    });

    const reused = available.slice(0, 3);
    const critical = missing.slice(0, 2);

    return { available, missing, reused, critical };
  }, [displayIngredients, inventorySignals]);

  const insights = useMemo(() => {
    const base: string[] = [];
    if (ingredientStatus.available.length > 0) {
      base.push('Esta receta reutiliza ingredientes que ya tenés en tu cocina.');
    }
    if (ingredientStatus.missing.length > 0) {
      base.push('Hay ingredientes faltantes para planificar una compra rápida y eficiente.');
    }
    base.push('Compatible con tu planificación semanal y optimización Home OS.');
    base.push('Sugerencia: priorizá ingredientes frescos para mejor sabor y menor desperdicio.');
    return base;
  }, [ingredientStatus.available.length, ingredientStatus.missing.length]);

  if (!props.open || !props.recipe) return null;

  const title = props.parsedRecipe?.title ?? 'Receta CocinaCore';
  const subtitle =
    props.recipeMode === 'rag'
      ? 'Generado por CocinaCore AI y adaptado a tu biblioteca culinaria.'
      : 'Generado por CocinaCore AI y optimizado según tu inventario y preferencias.';

  const toggle = (key: SectionKey) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const copyRecipe = async () => {
    await navigator.clipboard.writeText(props.recipe);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 md:p-6">
      <section className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-3xl border border-[#E8DDD2] bg-[#FAF6F1] p-4 shadow-2xl md:p-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link href="/app" className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5A50]">← Volver</Link>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyRecipe} className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5A50]"><Clipboard size={12} className="mr-1 inline" />Copiar</button>
            <button type="button" onClick={props.onSave} disabled={props.savingRecipe} className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5A50] disabled:opacity-60">
              {props.savingRecipe ? 'Guardando...' : 'Guardar'}
            </button>
            <button type="button" onClick={props.onClose} className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5A50]"><XCircle size={12} className="mr-1 inline" />Cerrar</button>
          </div>
        </header>

        <article className="relative overflow-hidden rounded-2xl border border-[#E8DDD2] bg-white/85 p-4">
          <div className="pointer-events-none absolute -right-14 -top-10 h-40 w-40 rounded-full bg-[#C56A1A]/10 blur-3xl" />
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <span className="inline-flex rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-2.5 py-1 text-xs font-semibold text-[#6D4AFF]">Generado por CocinaCore AI</span>
              <h2 className="text-2xl font-semibold text-[#241A14] md:text-3xl">{title}</h2>
              <p className="text-sm text-[#6B5A50]">{subtitle}</p>
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-[#6B5A50] sm:grid-cols-4">
                <span className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">👥 {props.peopleCount || 4} porciones</span>
                <span className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">⏱️ 35 min</span>
                <span className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">🔥 {props.level || 'Intermedio'}</span>
                <span className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">🌍 {props.region || 'Fusión'}</span>
              </div>
            </div>
            <div className="mx-auto w-full max-w-[150px] overflow-hidden rounded-2xl bg-[#FAF6F1] md:max-w-[190px]">
              <Image src="/plato-logo.png" alt="Plato CocinaCore" width={800} height={600} className="h-auto w-full object-cover" />
            </div>
          </div>
        </article>

        <section className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white p-3">
            <p className="text-xs text-[#6B5A50]">Ingredientes disponibles</p>
            <p className="mt-1 text-lg font-semibold text-[#567A3B]">{ingredientStatus.available.length}</p>
          </article>
          <article className="rounded-2xl border border-[#E8DDD2] bg-white p-3">
            <p className="text-xs text-[#6B5A50]">Faltantes</p>
            <p className="mt-1 text-lg font-semibold text-[#B84D4D]">{ingredientStatus.missing.length}</p>
          </article>
          <article className="rounded-2xl border border-[#E8DDD2] bg-white p-3">
            <p className="text-xs text-[#6B5A50]">Reutilizados</p>
            <p className="mt-1 text-lg font-semibold text-[#241A14]">{ingredientStatus.reused.length}</p>
          </article>
          <article className="rounded-2xl border border-[#E8DDD2] bg-white p-3">
            <p className="text-xs text-[#6B5A50]">Críticos</p>
            <p className="mt-1 text-lg font-semibold text-[#A55412]">{ingredientStatus.critical.length}</p>
          </article>
        </section>

        <section className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white p-4">
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <a href="#rv-ingredients" className="rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-1.5 text-[#6B5A50]">Ingredientes</a>
            <a href="#rv-prep" className="rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-1.5 text-[#6B5A50]">Preparación</a>
            <a href="#rv-tips" className="rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-1.5 text-[#6B5A50]">Tips</a>
            <a href="#rv-origin" className="rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-1.5 text-[#6B5A50]">Origen</a>
          </div>
        </section>

        <section id="rv-ingredients" className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white p-4">
          <button type="button" onClick={() => toggle('ingredients')} className="flex w-full items-center justify-between">
            <h3 className="text-lg font-semibold">Ingredientes</h3>
            {expanded.ingredients ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expanded.ingredients ? (
            <ul className="mt-3 space-y-2">
              {displayIngredients.map((row, index) => {
                const isAvailable = inventorySignals.some((signal) => signal.length > 2 && normalize(row.name).includes(signal));
                return (
                  <li key={`${row.name}-${index}`} className="flex items-center gap-3 rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-2 text-sm">
                    {isAvailable ? <CheckCircle2 size={16} className="text-[#567A3B]" /> : <XCircle size={16} className="text-[#B84D4D]" />}
                    <span className="min-w-24 font-semibold text-[#6B5A50]">
                      {row.structured ? `${row.quantity ?? '—'} ${row.unit ?? ''}`.trim() : 'No estructurada'}
                    </span>
                    <span className="text-[#241A14]">{row.name}</span>
                    {!row.structured ? (
                      <span className="rounded-full border border-[#E8DDD2] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#A55412]">
                        ⚠️ Ambigua
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section id="rv-prep" className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white p-4">
          <button type="button" onClick={() => toggle('preparation')} className="flex w-full items-center justify-between">
            <h3 className="text-lg font-semibold">Preparación</h3>
            {expanded.preparation ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expanded.preparation ? (
            <ol className="mt-3 space-y-2">
              {(props.parsedRecipe?.preparation ?? []).map((step, index) => (
                <li key={`${step}-${index}`} className="flex gap-3 rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-3 text-sm">
                  <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[#C56A1A] text-xs font-bold text-white">{index + 1}</span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>

        <section id="rv-tips" className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white p-4">
          <button type="button" onClick={() => toggle('tips')} className="flex w-full items-center justify-between">
            <h3 className="text-lg font-semibold">Tips del chef</h3>
            {expanded.tips ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expanded.tips ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(props.parsedRecipe?.tips ?? []).map((tip, index) => (
                <div key={`${tip}-${index}`} className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] p-3 text-sm">
                  <p className="text-xs font-semibold text-[#6B5A50]">Tip #{index + 1}</p>
                  <p className="mt-1 text-[#241A14]">{tip}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section id="rv-origin" className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white p-4">
          <button type="button" onClick={() => toggle('origin')} className="flex w-full items-center justify-between">
            <h3 className="text-lg font-semibold">Origen y notas</h3>
            {expanded.origin ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expanded.origin ? (
            <>
              <p className="mt-3 text-sm text-[#6B5A50]">
                {props.recipeMode === 'rag'
                  ? 'Receta generada por CocinaCore AI usando tu biblioteca culinaria, ingredientes y preferencias.'
                  : 'Receta generada por CocinaCore AI usando tus ingredientes, preferencias culinarias y restricciones.'}
              </p>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {insights.map((insight) => (
                  <article key={insight} className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] p-3 text-sm text-[#241A14]">
                    <p className="text-xs font-semibold text-[#6D4AFF]"><Sparkles size={12} className="mr-1 inline" />Insight IA</p>
                    <p className="mt-1">{insight}</p>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </section>

        {props.recipeMode === 'rag' && props.citations.length > 0 ? (
          <section className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white p-4">
            <h3 className="text-sm font-semibold text-[#6B5A50]">Citas válidas de biblioteca</h3>
            <ul className="mt-2 space-y-1 text-xs text-[#6B5A50]">
              {props.citations.map((row) => (
                <li key={row.id} className="rounded-lg border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">
                  <Eye size={12} className="mr-1 inline" />
                  {row.metadata?.book_title ?? 'Documento'} · pág {row.metadata?.page_number ?? '-'} · sim {safeSimilarity(row.similarity).toFixed(3)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white p-4">
          <h3 className="text-base font-semibold text-[#241A14]">Estado de ingredientes</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <article className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] p-3 text-sm">
              <p className="text-xs font-semibold text-[#567A3B]"><ShoppingBasket size={12} className="mr-1 inline" />Disponibles</p>
              <ul className="mt-1 space-y-1 text-[#241A14]">
                {ingredientStatus.available.slice(0, 4).map((item) => (
                  <li key={`ok-${item.name}`}>• {item.name}</li>
                ))}
              </ul>
            </article>
            <article className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] p-3 text-sm">
              <p className="text-xs font-semibold text-[#B84D4D]"><XCircle size={12} className="mr-1 inline" />Falta comprar</p>
              <ul className="mt-1 space-y-1 text-[#241A14]">
                {ingredientStatus.missing.slice(0, 4).map((item) => (
                  <li key={`missing-${item.name}`}>• {item.name}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      </section>
    </div>
  );
}
