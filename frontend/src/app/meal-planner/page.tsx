'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Download,
  Eye,
  History,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Share2,
  ShoppingCart,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import {
  buildInventorySuggestion,
  type RawSuggestedItem,
  type SuggestedInventoryItem,
} from './inventorySuggestion';
import {
  extractRecipeRequirements,
  groupRequirementsByIngredient,
  type InventoryComparableItem,
  type RecipeRequirement,
} from '@/lib/inventory/recipe-requirements';
import {
  buildMealPlanInventoryProjection,
  buildQuantifiedShoppingList,
  buildSmartShoppingList,
} from '@/lib/inventory/meal-plan-projection';
import {
  canCompareUnits,
  convertQuantity,
  normalizeUnit,
  parseQuantity,
  type NormalizedUnit,
} from '@/lib/inventory/quantity-normalization';
import { InventoryDepletionPreview } from '@/components/home-os/InventoryDepletionPreview';
import { SmartShoppingSection } from '@/components/home-os/SmartShoppingSection';
import { SupermarketModeCard } from '@/components/home-os/SupermarketModeCard';
import { DailyKitchenCard } from '@/components/home-os/DailyKitchenCard';
import { InventoryPlaybackCard } from '@/components/home-os/InventoryPlaybackCard';
import { HomeIntelligenceDashboard } from '@/components/home-os/HomeIntelligenceDashboard';
import { SmartPredictionCard } from '@/components/home-os/SmartPredictionCard';
import { MenuHealthCard } from '@/components/home-os/MenuHealthCard';
import { RecipeReplacementModal } from '@/components/home-os/RecipeReplacementModal';
import { AdvancedTimelineSection } from '@/components/home-os/AdvancedTimelineSection';
import { buildMealPlanSimulation } from '@/lib/inventory/meal-plan-simulation';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import { EditableMealTimeline } from '@/components/home-os/EditableMealTimeline';
import { IngredientConstraintCard } from '@/components/home-os/IngredientConstraintCard';
import { ReorderSuggestionCard } from '@/components/home-os/ReorderSuggestionCard';
import { SimulationControls } from '@/components/home-os/SimulationControls';
import { SmartOptimizationPanel } from '@/components/home-os/SmartOptimizationPanel';
import type { OptimizationMode } from '@/lib/meal-planner/simulation-state';
import {
  calculateMealPlanScore,
  compareMealPlans,
  explainOptimization,
  type MealPlanComparison,
  type MealPlanOptimizationScore,
} from '@/lib/inventory/meal-plan-optimizer';
import { OptimizationScoreCard } from '@/components/home-os/OptimizationScoreCard';
import { BeforeAfterComparisonCard } from '@/components/home-os/BeforeAfterComparisonCard';
import { AIOptimizationInsights } from '@/components/home-os/AIOptimizationInsights';
import type { Database } from '@/lib/database.types';
import {
  extractStructuredIngredients,
  type StructuredRecipeIngredient,
} from '@/lib/recipes/structured-ingredients';
import {
  applyOptimizationState,
  buildMealKey,
  moveMealAcrossDayState,
  moveMealAcrossSlotState,
} from '@/lib/meal-planner/simulation-state';

const CUISINES = [
  'Venezolana',
  'Colombiana',
  'Latinoamericana',
  'Asiática',
  'Italiana',
  'Mediterránea',
  'Mexicana',
];
const CUISINE_FLAGS: Record<string, string> = {
  Venezolana: '🇻🇪',
  Colombiana: '🇨🇴',
  Latinoamericana: '🌎',
  Asiática: '🌏',
  Italiana: '🇮🇹',
  Mediterránea: '🌊',
  Mexicana: '🇲🇽',
};
const GOALS = ['Familiar', 'Meal prep', 'Fitness', 'Cena rápida', 'Aprender cocina'];
const RESTRICTIONS = [
  'Sin gluten',
  'Sin lactosa',
  'Keto',
  'Frutos secos',
  'Mariscos',
  'Vegetariano',
];

const PERIOD_OPTIONS = [
  { key: 'week', label: 'Semana' },
  { key: 'fortnight', label: 'Quincena' },
  { key: 'month', label: 'Mes' },
] as const;

const MODE_OPTIONS = [
  { key: 'inventory_to_menu', label: 'Inventario → Menú' },
  { key: 'menu_to_shopping', label: 'Menú → Compras' },
  { key: 'balanced_ai', label: 'Balanceado IA' },
] as const;

const DAY_NAMES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;
const MEALS = ['Desayuno', 'Almuerzo', 'Cena'] as const;

type PlannerMode = (typeof MODE_OPTIONS)[number]['key'];
type PlannerPeriod = (typeof PERIOD_OPTIONS)[number]['key'];
type MealType = (typeof MEALS)[number];
type FusionIntensity = 'sutil' | 'media' | 'alta';

const GOAL_TO_INTENSITY: Record<string, FusionIntensity> = {
  Familiar: 'sutil',
  'Cena rápida': 'sutil',
  'Meal prep': 'media',
  Fitness: 'media',
  'Aprender cocina': 'alta',
};

type PlannerMealCard = {
  name: string;
  time: string;
  difficulty: 'Fácil' | 'Media' | 'Alta';
  badge: string;
  fusionTag: string;
  missing: number;
  aiScore: number;
  structured_ingredients?: StructuredRecipeIngredient[];
  recipe_content?: string | null;
  rag_context?: string[];
};

type PlannerDay = {
  day: (typeof DAY_NAMES)[number];
  meals: Record<MealType, PlannerMealCard>;
};

type MealDetailState = {
  open: boolean;
  day: string;
  mealType: MealType;
  card: PlannerMealCard | null;
  content: string;
  loading: boolean;
  error: string | null;
};

type ErrorPayload = { error?: string };
type MatchChunkRow = { content: string; similarity: number | string | null };
type MealDetailTab = 'summary' | 'ingredients' | 'preparation';
type SelectedMealState = { day: string; mealType: MealType } | null;
type RecipeAlternative = {
  id: string;
  title: string;
  description: string;
  reasons: string[];
  time: string;
  difficulty: 'Fácil' | 'Media' | 'Alta';
};
type OptimizationSnapshotRow =
  Database['public']['Tables']['user_meal_plan_optimization_snapshots']['Row'];
type OptimizationSnapshotView = {
  id: string;
  createdAt: string;
  mode: OptimizationMode;
  baselineScore: MealPlanOptimizationScore;
  optimizedScore: MealPlanOptimizationScore;
  comparison: MealPlanComparison;
  notes: string[];
  baselineCalendar: PlannerDay[];
  optimizedCalendar: PlannerDay[];
};
type InventoryMovementRow = Database['public']['Tables']['inventory_movements']['Row'];
type ConsumptionStatus = 'sufficient' | 'insufficient' | 'review';
type ConsumptionPreviewItem = {
  ingredientName: string;
  normalizedName: string;
  requiredQuantity: number | null;
  requiredUnit: string | null;
  availableQuantity: number | null;
  availableUnit: string | null;
  afterQuantity: number | null;
  afterUnit: string | null;
  status: ConsumptionStatus;
  reason?: string;
  inventoryItemId?: string;
};

const HISTORY_PAGE_SIZE = 5;
const ENABLE_HOME_INTELLIGENCE_DASHBOARD =
  process.env.NEXT_PUBLIC_ENABLE_HOME_INTELLIGENCE_DASHBOARD === 'true';
type InventoryItemExtended = InventoryComparableItem & {
  id?: string;
  normalized_name?: string | null;
  category?: string | null;
  estimated_unit_price?: number | null;
};
type ShoppingInventoryRow = {
  id: string;
  ingredient_name: string;
  normalized_name?: string | null;
  quantity: string | null;
  unit?: string | null;
  category?: string | null;
  estimated_unit_price?: number | null;
};
type InventorySchemaMode = 'normalized' | 'legacy';

async function readErrorPayload(response: Response, fallback: string): Promise<ErrorPayload> {
  const payload: unknown = await response.json().catch(() => ({ error: fallback }));
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const maybeError = (payload as { error?: unknown }).error;
    return { error: typeof maybeError === 'string' ? maybeError : fallback };
  }
  return { error: fallback };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const message = typeof candidate.message === 'string' ? candidate.message : null;
    const details = typeof candidate.details === 'string' ? candidate.details : null;
    const hint = typeof candidate.hint === 'string' ? candidate.hint : null;
    const code = typeof candidate.code === 'string' ? candidate.code : null;
    return (
      [message, details, hint, code ? `Código: ${code}` : null].filter(Boolean).join(' · ') ||
      fallback
    );
  }
  return fallback;
}

function isMissingDbColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === '42703' ||
    (typeof candidate.message === 'string' && candidate.message.includes('does not exist'))
  );
}

function toInventoryRows(rows: ShoppingInventoryRow[]): InventoryItemExtended[] {
  return rows.map((row) => ({
    id: row.id,
    ingredient_name: row.ingredient_name,
    normalized_name: row.normalized_name ?? null,
    quantity: row.quantity ?? null,
    unit: row.unit ?? null,
    category: row.category ?? null,
    estimated_unit_price: row.estimated_unit_price ?? null,
  }));
}

function buildFusionLabel(baseCuisine: string, fusionCuisines: string[]): string {
  if (fusionCuisines.length === 0) return baseCuisine;
  return `${baseCuisine} + ${fusionCuisines.join(' + ')}`;
}

function sanitizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createDefaultCard(
  day: string,
  meal: MealType,
  fusionLabel: string,
  ragContext: string[] = []
): PlannerMealCard {
  return {
    name: `${meal} de ${day}`,
    time: meal === 'Desayuno' ? '15 min' : meal === 'Almuerzo' ? '30 min' : '25 min',
    difficulty: 'Fácil',
    badge: 'Usa inventario',
    fusionTag: `Fusión ${fusionLabel}`,
    missing: 0,
    aiScore: 88,
    structured_ingredients: [],
    recipe_content: null,
    rag_context: ragContext,
  };
}

function buildDefaultWeek(fusionLabel: string, ragContext: string[] = []): PlannerDay[] {
  return DAY_NAMES.map((day) => ({
    day,
    meals: {
      Desayuno: createDefaultCard(day, 'Desayuno', fusionLabel, ragContext),
      Almuerzo: createDefaultCard(day, 'Almuerzo', fusionLabel, ragContext),
      Cena: createDefaultCard(day, 'Cena', fusionLabel, ragContext),
    },
  }));
}

function parseMenuToCalendar(
  content: string,
  fusionLabel: string,
  ragContext: string[] = []
): PlannerDay[] {
  const week = buildDefaultWeek(fusionLabel, ragContext);
  const lines = content
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/\*\*/g, '')
        .replace(/^[-•]\s*/, '')
    )
    .filter(Boolean);

  const dayIndexByName = new Map(DAY_NAMES.map((d, idx) => [d.toLowerCase(), idx]));
  let currentDay = 0;

  for (const line of lines) {
    const normalized = line.toLowerCase();
    const foundDay = DAY_NAMES.find((d) => normalized.includes(d.toLowerCase()));
    if (foundDay) {
      const idx = dayIndexByName.get(foundDay.toLowerCase());
      if (typeof idx === 'number') currentDay = idx;
      continue;
    }

    const mealType: MealType | null = normalized.includes('desayuno')
      ? 'Desayuno'
      : normalized.includes('almuerzo')
        ? 'Almuerzo'
        : normalized.includes('cena')
          ? 'Cena'
          : null;

    if (!mealType) continue;

    const titlePart = line.split(':')[1]?.trim() ?? line.replace(/^[-\d.)\s]*/, '').trim();
    if (!titlePart) continue;

    const difficulty: PlannerMealCard['difficulty'] =
      titlePart.length > 42 ? 'Media' : titlePart.length > 58 ? 'Alta' : 'Fácil';

    week[currentDay].meals[mealType] = {
      name: titlePart.slice(0, 72),
      time: mealType === 'Desayuno' ? '15 min' : mealType === 'Almuerzo' ? '35 min' : '30 min',
      difficulty,
      badge: 'Perfil aplicado',
      fusionTag: `Fusión ${fusionLabel}`,
      missing: 0,
      aiScore: 86,
      structured_ingredients: [],
      recipe_content: null,
      rag_context: ragContext,
    };
  }

  // Si algún día quedó con placeholders, intenta completar usando líneas consecutivas
  // después de una etiqueta de comida (casos donde el modelo separa título en siguiente línea).
  for (let i = 0; i < lines.length - 1; i += 1) {
    const normalized = lines[i].toLowerCase();
    const mealType: MealType | null = normalized.includes('desayuno')
      ? 'Desayuno'
      : normalized.includes('almuerzo')
        ? 'Almuerzo'
        : normalized.includes('cena')
          ? 'Cena'
          : null;
    if (!mealType) continue;

    const foundDay = DAY_NAMES.find((d) => normalized.includes(d.toLowerCase()));
    const dayIdx = foundDay ? dayIndexByName.get(foundDay.toLowerCase()) : undefined;
    if (typeof dayIdx !== 'number') continue;

    const current = week[dayIdx].meals[mealType];
    const isPlaceholder = current.name.includes(`de ${week[dayIdx].day}`);
    if (!isPlaceholder) continue;

    const nextLine = lines[i + 1]?.trim();
    if (!nextLine) continue;
    if (DAY_NAMES.some((d) => nextLine.toLowerCase().includes(d.toLowerCase()))) continue;
    if (/(desayuno|almuerzo|cena)/i.test(nextLine)) continue;

    week[dayIdx].meals[mealType] = {
      ...current,
      name: nextLine.slice(0, 72),
      difficulty: nextLine.length > 58 ? 'Alta' : nextLine.length > 42 ? 'Media' : 'Fácil',
      badge: 'Perfil aplicado',
      structured_ingredients: current.structured_ingredients ?? [],
      rag_context: current.rag_context ?? ragContext,
    };
  }

  return week;
}

function sanitizeStructuredIngredients(input: unknown): StructuredRecipeIngredient[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      normalized_name: typeof item.normalized_name === 'string' ? item.normalized_name : '',
      quantity:
        typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : null,
      unit: typeof item.unit === 'string' ? item.unit : null,
      optional_quantity_text:
        typeof item.optional_quantity_text === 'string' ? item.optional_quantity_text : null,
      category: typeof item.category === 'string' ? item.category : null,
      estimated_cost_optional:
        typeof item.estimated_cost_optional === 'number' &&
        Number.isFinite(item.estimated_cost_optional)
          ? item.estimated_cost_optional
          : null,
      structured: Boolean(item.structured),
    }))
    .filter((item) => item.name.length > 0 && item.normalized_name.length > 0);
}

function normalizePlannerDay(day: unknown): PlannerDay | null {
  if (!day || typeof day !== 'object') return null;
  const source = day as Record<string, unknown>;
  if (typeof source.day !== 'string') return null;
  const mealsRaw = source.meals;
  if (!mealsRaw || typeof mealsRaw !== 'object') return null;
  const mealsObject = mealsRaw as Record<string, unknown>;

  const makeMeal = (mealType: MealType): PlannerMealCard => {
    const raw = mealsObject[mealType];
    const meal = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const difficulty =
      meal?.difficulty === 'Media' || meal?.difficulty === 'Alta' ? meal.difficulty : 'Fácil';
    return {
      name: typeof meal?.name === 'string' ? meal.name : `${mealType} de ${source.day}`,
      time:
        typeof meal?.time === 'string'
          ? meal.time
          : mealType === 'Desayuno'
            ? '15 min'
            : mealType === 'Almuerzo'
              ? '35 min'
              : '30 min',
      difficulty,
      badge: typeof meal?.badge === 'string' ? meal.badge : 'Perfil aplicado',
      fusionTag: typeof meal?.fusionTag === 'string' ? meal.fusionTag : 'Fusión personalizada',
      missing: typeof meal?.missing === 'number' ? meal.missing : 0,
      aiScore: typeof meal?.aiScore === 'number' ? meal.aiScore : 86,
      structured_ingredients: sanitizeStructuredIngredients(meal?.structured_ingredients),
      recipe_content: typeof meal?.recipe_content === 'string' ? meal.recipe_content : null,
      rag_context: sanitizeStringArray(meal?.rag_context),
    };
  };

  return {
    day: source.day as (typeof DAY_NAMES)[number],
    meals: {
      Desayuno: makeMeal('Desayuno'),
      Almuerzo: makeMeal('Almuerzo'),
      Cena: makeMeal('Cena'),
    },
  };
}

function normalizePlannerCalendar(input: unknown): PlannerDay[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .map((day) => normalizePlannerDay(day))
    .filter((day): day is PlannerDay => day !== null);
  return normalized;
}

function patchMealInCalendar(
  calendar: PlannerDay[],
  day: string,
  mealType: MealType,
  patch: Partial<PlannerMealCard>
): PlannerDay[] {
  return calendar.map((dayEntry) =>
    dayEntry.day !== day
      ? dayEntry
      : {
          ...dayEntry,
          meals: {
            ...dayEntry.meals,
            [mealType]: {
              ...dayEntry.meals[mealType],
              ...patch,
            },
          },
        }
  );
}

function extractShoppingItems(content: string): string[] {
  const marker = 'lista de compras';
  const lower = content.toLowerCase();
  const idx = lower.indexOf(marker);
  if (idx < 0) return [];

  return content
    .slice(idx)
    .split('\n')
    .map((line) => line.replace(/^[-•\d.)\s]*/, '').trim())
    .filter((line) => line.length > 2)
    .slice(1, 20);
}

function pick<T>(arr: T[], max: number): T[] {
  return arr.slice(0, max);
}

function mealKey(day: string, mealType: MealType): string {
  return buildMealKey(day, mealType);
}

function modeLabel(mode: OptimizationMode): string {
  switch (mode) {
    case 'optimize_cost':
      return 'Optimizar costo';
    case 'reduce_waste':
      return 'Optimizar desperdicio';
    case 'prioritize_fresh':
      return 'Priorizar frescos';
    case 'reduce_missing':
      return 'Reducir faltantes';
    case 'reuse_proteins':
      return 'Reutilizar proteínas';
    case 'balance_ingredients':
      return 'Balancear ingredientes';
    default:
      return mode;
  }
}

function parseSnapshot(rows: OptimizationSnapshotRow[]): OptimizationSnapshotView[] {
  return rows
    .map((row) => {
      const notes = Array.isArray(row.explainability_notes)
        ? row.explainability_notes.filter((note): note is string => typeof note === 'string')
        : [];

      const baselineCalendar = normalizePlannerCalendar(row.baseline_calendar);
      const optimizedCalendar = normalizePlannerCalendar(row.optimized_calendar);

      const baselineScore = row.baseline_score as unknown as MealPlanOptimizationScore;
      const optimizedScore = row.optimized_score as unknown as MealPlanOptimizationScore;
      const comparison = row.comparison as unknown as MealPlanComparison;

      if (!row.id || !row.optimization_mode) return null;

      return {
        id: row.id,
        createdAt: row.created_at,
        mode: row.optimization_mode,
        baselineScore,
        optimizedScore,
        comparison,
        notes,
        baselineCalendar,
        optimizedCalendar,
      } satisfies OptimizationSnapshotView;
    })
    .filter((row): row is OptimizationSnapshotView => row !== null);
}

function toSimulationDays(days: PlannerDay[]): Array<{
  day: string;
  meals: Array<{ label: string; title: string; time: string; difficulty: string }>;
}> {
  return days.map((day) => ({
    day: day.day,
    meals: MEALS.map((mealType) => ({
      label: mealType,
      title: day.meals[mealType].name.replace(/\*\*/g, '').trim(),
      time: day.meals[mealType].time,
      difficulty: day.meals[mealType].difficulty,
    })),
  }));
}

function formatInventoryQuantityValue(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function convertToUnit(value: number, from: NormalizedUnit, to: NormalizedUnit): number | null {
  if (from === to) return value;
  return convertQuantity(value, from, to);
}

function normalizeIngredientKey(value: string): string {
  return normalizeInventoryName(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCurrentPlannerDayIndex(): number {
  // JS: Sunday=0 ... Saturday=6 | Planner: Monday=0 ... Sunday=6
  const jsDay = new Date().getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function buildRecipeRequirementsFromCalendar(days: PlannerDay[]): RecipeRequirement[] {
  const requirements: RecipeRequirement[] = [];
  for (const day of days) {
    for (const mealType of MEALS) {
      const meal = day.meals[mealType];
      const payload = {
        title: meal.name,
        structured_ingredients: meal.structured_ingredients ?? [],
        ingredients: [],
      };
      const extracted = extractRecipeRequirements(payload).map((item) => ({
        ...item,
        usedInRecipes: [`${day.day} · ${mealType} · ${meal.name}`],
      }));
      requirements.push(...extracted);
    }
  }
  return groupRequirementsByIngredient(requirements);
}

type NarrativeDaySection = {
  day: string;
  meals: Array<{ meal: string; text: string }>;
};
type ShoppingShareFormat = 'short' | 'detailed';

function parseNarrativeMenu(content: string): NarrativeDaySection[] {
  const sections: NarrativeDaySection[] = [];
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const dayRegex =
    /^(?:\*{0,2})?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)(?:\*{0,2})?$/i;
  const mealRegex = /^(desayuno|almuerzo|cena)\s*:\s*(.+)$/i;
  let currentSection: NarrativeDaySection | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-•]\s*/, '').trim();
    const dayMatch = line.match(dayRegex);
    if (dayMatch) {
      currentSection = {
        day: dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1),
        meals: [],
      };
      sections.push(currentSection);
      continue;
    }

    const mealMatch = line.match(mealRegex);
    if (mealMatch && currentSection) {
      currentSection.meals.push({
        meal: mealMatch[1].charAt(0).toUpperCase() + mealMatch[1].slice(1).toLowerCase(),
        text: mealMatch[2].replace(/\*\*/g, '').trim(),
      });
    }
  }
  return sections;
}

function buildShoppingWhatsappText(
  shoppingList: ReturnType<typeof buildQuantifiedShoppingList>,
  peopleCount: number,
  period: PlannerPeriod,
  format: ShoppingShareFormat
): string {
  const periodLabel =
    period === 'week' ? 'semanal' : period === 'fortnight' ? 'quincenal' : 'mensual';
  const lines: string[] = [
    `🛒 Lista de mercado CocinaCore (${periodLabel})`,
    `👥 ${peopleCount} personas`,
    '',
  ];

  for (const group of shoppingList.groups) {
    const buyItems = group.items.filter((item) => item.status === 'buy');
    if (buyItems.length === 0) continue;
    lines.push(`*${group.category}*`);
    for (const item of buyItems) {
      lines.push(`- [ ] ${item.ingredientName}: ${item.quantityToBuy ?? 'revisar'} ${item.unit}`);
      if (format === 'detailed' && item.usedInRecipes.length > 0) {
        lines.push(`   ↳ uso: ${item.usedInRecipes.join(', ')}`);
      }
    }
    lines.push('');
  }

  if (shoppingList.estimatedCostTotal > 0) {
    lines.push(`💵 Costo estimado: ~$${shoppingList.estimatedCostTotal.toFixed(2)}`);
  }

  lines.push('', 'Generado por CocinaCore');
  return lines.join('\n');
}

export default function MealPlannerPage() {
  const [mode, setMode] = useState<PlannerMode>('balanced_ai');
  const [period, setPeriod] = useState<PlannerPeriod>('week');
  const [baseCuisine, setBaseCuisine] = useState('Latinoamericana');
  const [fusionCuisines, setFusionCuisines] = useState<string[]>([]);
  const [goal, setGoal] = useState('Familiar');
  const [peopleCount, setPeopleCount] = useState(4);
  const [inventory, setInventory] = useState<string[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemExtended[]>([]);
  const [selectedRestrictions, setSelectedRestrictions] = useState<string[]>([]);
  const [fusionIntensity, setFusionIntensity] = useState<FusionIntensity>('media');
  const [intensityAuto, setIntensityAuto] = useState(true);
  const [usePdfContext, setUsePdfContext] = useState(true);
  const [culinaryProfile, setCulinaryProfile] = useState<{
    preferred: string[];
    avoid: string[];
    goals: string[];
    level: string | null;
  }>({ preferred: [], avoid: [], goals: [], level: null });
  const fusionLabel = useMemo(
    () => buildFusionLabel(baseCuisine, fusionCuisines),
    [baseCuisine, fusionCuisines]
  );
  const [calendarData, setCalendarData] = useState<PlannerDay[]>(() =>
    buildDefaultWeek('Latinoamericana')
  );
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [applyingShoppingItemKey, setApplyingShoppingItemKey] = useState<string | null>(null);
  const [shoppingApplySummary, setShoppingApplySummary] = useState<string | null>(null);
  const [shoppingApplyStage, setShoppingApplyStage] = useState<string | null>(null);
  const [consumingRecipe, setConsumingRecipe] = useState(false);
  const [recentMovements, setRecentMovements] = useState<InventoryMovementRow[]>([]);
  const [shoppingShareFeedback, setShoppingShareFeedback] = useState<string | null>(null);
  const [shoppingShareFormat, setShoppingShareFormat] = useState<ShoppingShareFormat>('short');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [pdfContextCount, setPdfContextCount] = useState(0);
  const [inventorySuggestion, setInventorySuggestion] = useState<SuggestedInventoryItem[]>([]);
  const [inventorySuggestionUpdatedAt, setInventorySuggestionUpdatedAt] = useState<string | null>(
    null
  );
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantType, setTenantType] = useState<string>('home');
  const [userId, setUserId] = useState<string | null>(null);
  const [mealPlanId, setMealPlanId] = useState<string | null>(null);
  const [optimizationHistory, setOptimizationHistory] = useState<OptimizationSnapshotView[]>([]);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);
  const [historyModeFilter, setHistoryModeFilter] = useState<OptimizationMode | 'all'>('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<'all' | '7d' | '30d' | '90d'>('all');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyNow, setHistoryNow] = useState(() => Date.now());
  const [hasSavedPlan, setHasSavedPlan] = useState(false);
  const [mealDetail, setMealDetail] = useState<MealDetailState>({
    open: false,
    day: '',
    mealType: 'Desayuno',
    card: null,
    content: '',
    loading: false,
    error: null,
  });
  const [mealDetailTab, setMealDetailTab] = useState<MealDetailTab>('summary');
  const [selectedMeal, setSelectedMeal] = useState<SelectedMealState>(null);
  const [lockedMeals, setLockedMeals] = useState<string[]>([]);
  const [activeWeekIndex, setActiveWeekIndex] = useState(0);
  const [activeDayIndex, setActiveDayIndex] = useState(() => getCurrentPlannerDayIndex());
  const [shoppingCollapsed, setShoppingCollapsed] = useState(false);
  const [simulatedDayIndex, setSimulatedDayIndex] = useState(() => getCurrentPlannerDayIndex());
  const [simulationCalendar, setSimulationCalendar] = useState<PlannerDay[]>(() =>
    buildDefaultWeek('Latinoamericana')
  );
  const [ingredientConstraints, setIngredientConstraints] = useState<string[]>([]);
  const [activeOptimizationMode, setActiveOptimizationMode] = useState<OptimizationMode | null>(
    null
  );
  const [showSimulationDetails, setShowSimulationDetails] = useState(false);
  const [showAdvancedTimeline, setShowAdvancedTimeline] = useState(false);
  const [replacementTarget, setReplacementTarget] = useState<SelectedMealState>(null);
  const [replacementAlternatives, setReplacementAlternatives] = useState<RecipeAlternative[]>([]);

  useEffect(() => {
    const loadProfileAndInventory = async () => {
      setLoadingInventory(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: authData } = await supabase.auth.getUser();
        const authUserId = authData.user?.id ?? null;
        setUserId(authUserId);

        const inventoryQuery = supabase
          .from('recipe_inventory_items')
          .select('id,ingredient_name,normalized_name,quantity,unit,category,estimated_unit_price')
          .eq('user_id', authUserId ?? '')
          .order('updated_at', { ascending: false })
          .limit(200);

        const [
          { data: userRow },
          inventoryResult,
          { data: profileRow },
          { data: profileTermRows },
          { data: termsRows },
          { data: savedPlanRow },
          { data: suggestionRow },
          { data: movementsRows },
        ] = await Promise.all([
          authUserId
            ? supabase.from('users').select('tenant_id').eq('id', authUserId).maybeSingle()
            : Promise.resolve({ data: null }),
          inventoryQuery,
          supabase
            .from('user_culinary_profiles')
            .select('level')
            .eq('user_id', authUserId ?? '')
            .maybeSingle(),
          supabase
            .from('user_culinary_profile_terms')
            .select('preference_type,term_id')
            .eq('user_id', authUserId ?? ''),
          supabase.from('culinary_terms').select('id,label').limit(300),
          supabase
            .from('user_meal_plans')
            .select('*')
            .eq('user_id', authUserId ?? '')
            .maybeSingle(),
          supabase
            .from('user_meal_plan_inventory_suggestions')
            .select('normalized_items,updated_at')
            .eq('user_id', authUserId ?? '')
            .maybeSingle(),
          supabase
            .from('inventory_movements')
            .select('*')
            .eq('user_id', authUserId ?? '')
            .order('created_at', { ascending: false })
            .limit(8),
        ]);

        const resolvedTenantId = userRow?.tenant_id ?? null;
        setTenantId(resolvedTenantId);
        if (resolvedTenantId) {
          const { data: tenantRow } = await supabase
            .from('tenants')
            .select('tenant_type')
            .eq('id', resolvedTenantId)
            .maybeSingle();
          if (tenantRow?.tenant_type) setTenantType(tenantRow.tenant_type);
        }

        let inventoryRows = (inventoryResult.data ?? []) as ShoppingInventoryRow[];
        if (inventoryResult.error && isMissingDbColumnError(inventoryResult.error)) {
          const { data: legacyRows } = await supabase
            .from('recipe_inventory_items')
            .select('id,ingredient_name,quantity')
            .eq('user_id', authUserId ?? '')
            .order('updated_at', { ascending: false })
            .limit(200);
          inventoryRows = (legacyRows ?? []) as ShoppingInventoryRow[];
        }

        const items = inventoryRows.map((row) => row.ingredient_name).filter(Boolean);
        setInventory(items);
        setInventoryItems(toInventoryRows(inventoryRows));
        setRecentMovements((movementsRows ?? []) as InventoryMovementRow[]);
        const termById = new Map((termsRows ?? []).map((row) => [row.id, row.label]));
        const mappedRows = (profileTermRows ?? []) as Array<{
          preference_type: 'identity' | 'prefer' | 'avoid' | 'goal';
          term_id: string;
        }>;
        const labelsByType = (type: 'identity' | 'prefer' | 'avoid' | 'goal') =>
          mappedRows
            .filter((row) => row.preference_type === type)
            .map((row) => termById.get(row.term_id) ?? null)
            .filter((label): label is string => Boolean(label));

        const preferred = labelsByType('prefer');
        const suggestedCuisine = preferred.find((term) => CUISINES.includes(term));
        const profileAvoid = labelsByType('avoid');
        const profileGoals = labelsByType('goal');

        if (suggestedCuisine) setBaseCuisine(suggestedCuisine);
        if (profileGoals.length > 0) setGoal(profileGoals[0]);
        setSelectedRestrictions(profileAvoid);
        setCulinaryProfile({
          preferred,
          avoid: profileAvoid,
          goals: profileGoals,
          level: profileRow?.level ?? null,
        });

        if (savedPlanRow) {
          const savedCalendar = normalizePlannerCalendar(savedPlanRow.calendar_payload);
          if (savedCalendar.length > 0) {
            setCalendarData(savedCalendar);
          }
          setResult(savedPlanRow.ai_content ?? '');
          setPeopleCount(savedPlanRow.people_count ?? 4);
          setMealPlanId(savedPlanRow.id ?? null);
          setHasSavedPlan(true);
        } else {
          setMealPlanId(null);
          setHasSavedPlan(false);
        }

        if (suggestionRow?.normalized_items && Array.isArray(suggestionRow.normalized_items)) {
          const parsed = suggestionRow.normalized_items as unknown as SuggestedInventoryItem[];
          setInventorySuggestion(parsed);
          setInventorySuggestionUpdatedAt(suggestionRow.updated_at ?? null);
        } else {
          setInventorySuggestion([]);
          setInventorySuggestionUpdatedAt(null);
        }

        if (resolvedTenantId && authUserId) {
          const { data: snapshotRows } = await supabase
            .from('user_meal_plan_optimization_snapshots')
            .select('*')
            .eq('tenant_id', resolvedTenantId)
            .eq('user_id', authUserId)
            .order('created_at', { ascending: false })
            .limit(12);
          const mappedSnapshots = parseSnapshot((snapshotRows ?? []) as OptimizationSnapshotRow[]);
          setOptimizationHistory(mappedSnapshots);
        } else {
          setOptimizationHistory([]);
        }
      } finally {
        setLoadingInventory(false);
      }
    };

    void loadProfileAndInventory();
  }, []);

  useEffect(() => {
    if (!intensityAuto) return;
    setFusionIntensity(GOAL_TO_INTENSITY[goal] ?? 'media');
  }, [goal, intensityAuto]);

  useEffect(() => {
    setSimulationCalendar(calendarData);
  }, [calendarData]);

  useEffect(() => {
    if (simulatedDayIndex < simulationCalendar.length) return;
    setSimulatedDayIndex(0);
  }, [simulatedDayIndex, simulationCalendar.length]);

  const filteredProfileBadges = useMemo(
    () =>
      pick(
        [
          ...culinaryProfile.preferred,
          ...culinaryProfile.goals,
          ...culinaryProfile.avoid.map((item) => `Evitar: ${item}`),
          ...(culinaryProfile.level ? [`Nivel: ${culinaryProfile.level}`] : []),
        ],
        8
      ),
    [culinaryProfile]
  );

  const profileFlags = [
    { label: 'Inventario', active: inventory.length > 0 },
    { label: 'Perfil culinario', active: filteredProfileBadges.length > 0 },
    { label: 'Historial', active: true },
    { label: 'Preferencias', active: culinaryProfile.preferred.length > 0 },
    { label: 'Restricciones', active: selectedRestrictions.length > 0 },
    { label: 'Objetivos', active: culinaryProfile.goals.length > 0 || Boolean(goal) },
  ];

  const mealPlanRequirements = useMemo<RecipeRequirement[]>(() => {
    const fromCalendar = buildRecipeRequirementsFromCalendar(simulationCalendar);
    if (fromCalendar.length > 0) return fromCalendar;
    return inventorySuggestion.map((item) => ({
      ingredientName: item.display_name || item.canonical_name,
      normalizedName: item.canonical_name.toLowerCase(),
      requiredQuantity: item.quantity,
      requiredUnit: item.unit as RecipeRequirement['requiredUnit'],
      usedInRecipes: item.sources,
    }));
  }, [inventorySuggestion, simulationCalendar]);

  const inventoryProjection = useMemo(
    () => buildMealPlanInventoryProjection(mealPlanRequirements, inventoryItems),
    [mealPlanRequirements, inventoryItems]
  );

  const smartShoppingList = useMemo(
    () =>
      mealPlanRequirements.length > 0
        ? buildQuantifiedShoppingList(mealPlanRequirements, inventoryItems)
        : buildSmartShoppingList(inventoryProjection),
    [inventoryProjection, inventoryItems, mealPlanRequirements]
  );

  const narrativeSections = useMemo(() => parseNarrativeMenu(result), [result]);
  const shoppingWhatsappText = useMemo(
    () =>
      buildShoppingWhatsappText(smartShoppingList, peopleCount || 4, period, shoppingShareFormat),
    [smartShoppingList, peopleCount, period, shoppingShareFormat]
  );
  const isRestaurantMode = tenantType === 'restaurant';

  const inventoryInsights = useMemo(() => {
    const projectionItems = inventoryProjection.items;
    if (projectionItems.length === 0) return [];
    const reuseCandidate = projectionItems
      .map((item) => ({ item, uses: item.usedInRecipes.length }))
      .sort((a, b) => b.uses - a.uses)[0];

    const insights: string[] = [];
    if (reuseCandidate && reuseCandidate.uses > 1) {
      insights.push(
        `Este menú reutiliza ${reuseCandidate.item.ingredientName} en ${reuseCandidate.uses} recetas.`
      );
    }
    if (inventoryProjection.summary.missing + inventoryProjection.summary.partial > 0) {
      insights.push(
        `Tu inventario cubre parte del menú, pero faltan ${
          inventoryProjection.summary.missing + inventoryProjection.summary.partial
        } ingredientes.`
      );
    }
    if (inventoryProjection.summary.unknown > 0) {
      insights.push(
        `Hay ${inventoryProjection.summary.unknown} ingredientes que requieren revisión manual por cantidad no estructurada.`
      );
    }
    return insights;
  }, [inventoryProjection]);

  const supermarketMetrics = useMemo(() => {
    const reusedCount = inventoryProjection.items.filter(
      (item) => item.usedInRecipes.length > 1
    ).length;
    return {
      estimatedCost: smartShoppingList.estimatedCostTotal,
      missingCount: inventoryProjection.summary.missing + inventoryProjection.summary.partial,
      reusedCount,
      reviewCount: inventoryProjection.summary.unknown,
    };
  }, [inventoryProjection, smartShoppingList]);

  const constrainedProjectionItems = useMemo(
    () =>
      inventoryProjection.items.map((item) => {
        if (!ingredientConstraints.includes(item.ingredientName)) return item;
        if (item.requiredTotalQuantity === null) return item;
        const adjustedRequired = Number((item.requiredTotalQuantity * 0.6).toFixed(2));
        return {
          ...item,
          requiredTotalQuantity: adjustedRequired,
          projectedUsedQuantity: adjustedRequired,
        };
      }),
    [inventoryProjection.items, ingredientConstraints]
  );

  const mealSimulation = useMemo(
    () => buildMealPlanSimulation(toSimulationDays(simulationCalendar), constrainedProjectionItems),
    [simulationCalendar, constrainedProjectionItems]
  );

  const baselineSimulation = useMemo(
    () => buildMealPlanSimulation(toSimulationDays(calendarData), constrainedProjectionItems),
    [calendarData, constrainedProjectionItems]
  );

  const menuHealthSummary = useMemo(() => {
    const coveredMessage =
      mealSimulation.weeklyCoverage >= 80
        ? 'Tu inventario cubre gran parte del menú.'
        : mealSimulation.weeklyCoverage >= 50
          ? 'Tu inventario cubre una parte relevante del menú.'
          : 'Tu inventario cubre poco del menú actual.';
    return {
      coveredMessage,
      lowIngredientsCount: mealSimulation.criticalIngredients.length,
      shoppingItemsCount: smartShoppingList.groups.reduce(
        (acc, group) => acc + group.items.filter((item) => item.status === 'buy').length,
        0
      ),
      estimatedCost: smartShoppingList.estimatedCostTotal,
    };
  }, [mealSimulation, smartShoppingList]);

  const optimizationScore = useMemo(
    () =>
      calculateMealPlanScore(
        inventoryProjection,
        mealSimulation,
        activeOptimizationMode ?? 'reduce_waste'
      ),
    [inventoryProjection, mealSimulation, activeOptimizationMode]
  );

  const baselineScore = useMemo(
    () =>
      calculateMealPlanScore(
        inventoryProjection,
        baselineSimulation,
        activeOptimizationMode ?? 'reduce_waste'
      ),
    [inventoryProjection, baselineSimulation, activeOptimizationMode]
  );

  const optimizationComparison = useMemo(
    () => compareMealPlans(baselineScore, optimizationScore),
    [baselineScore, optimizationScore]
  );

  const optimizationNotes = useMemo(
    () => explainOptimization(optimizationComparison, activeOptimizationMode ?? 'reduce_waste'),
    [optimizationComparison, activeOptimizationMode]
  );

  const filteredOptimizationHistory = useMemo(() => {
    const maxAgeMs =
      historyDateFilter === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : historyDateFilter === '30d'
          ? 30 * 24 * 60 * 60 * 1000
          : historyDateFilter === '90d'
            ? 90 * 24 * 60 * 60 * 1000
            : null;

    return optimizationHistory.filter((snapshot) => {
      if (historyModeFilter !== 'all' && snapshot.mode !== historyModeFilter) return false;
      if (maxAgeMs !== null && historyNow - new Date(snapshot.createdAt).getTime() > maxAgeMs)
        return false;
      return true;
    });
  }, [optimizationHistory, historyDateFilter, historyModeFilter, historyNow]);

  const visibleOptimizationHistory = useMemo(
    () => filteredOptimizationHistory.slice(0, historyPage * HISTORY_PAGE_SIZE),
    [filteredOptimizationHistory, historyPage]
  );

  const hasMoreHistory = visibleOptimizationHistory.length < filteredOptimizationHistory.length;

  useEffect(() => {
    setHistoryPage(1);
    setHistoryNow(Date.now());
  }, [historyDateFilter, historyModeFilter]);

  const reorderSuggestions = useMemo(() => {
    const suggestions: string[] = [];
    if (ingredientConstraints.length > 0) {
      suggestions.push(
        `Priorizá ahorro de ${ingredientConstraints.join(', ')} moviendo recetas de alto consumo al final de la semana.`
      );
    }
    if (mealSimulation.predictions.length > 0) {
      suggestions.push(
        `Podés adelantar recetas antes de ${mealSimulation.predictions[0].split(' el ')[1] ?? 'días críticos'} para reducir faltantes.`
      );
    }
    if (activeOptimizationMode === 'optimize_cost') {
      suggestions.push(
        'Reordenamos almuerzos para concentrar ingredientes compartidos y reducir compras duplicadas.'
      );
    }
    if (activeOptimizationMode === 'prioritize_fresh') {
      suggestions.push(
        'Conviene cocinar ingredientes frescos entre lunes y miércoles para evitar pérdida de calidad.'
      );
    }
    if (suggestions.length === 0 && mealSimulation.reusedIngredients.length > 0) {
      suggestions.push(
        `El menú ya reutiliza ${mealSimulation.reusedIngredients.slice(0, 2).join(' y ')} de forma eficiente.`
      );
    }
    return suggestions.slice(0, 4);
  }, [ingredientConstraints, mealSimulation, activeOptimizationMode]);

  const hasSimulationChanges = useMemo(() => {
    const toComparable = (days: PlannerDay[]) =>
      days.map((day) => ({
        day: day.day,
        meals: MEALS.map((mealType) => day.meals[mealType].name),
      }));

    return (
      JSON.stringify(toComparable(simulationCalendar)) !==
      JSON.stringify(toComparable(calendarData))
    );
  }, [simulationCalendar, calendarData]);

  const hasActiveMenu = hasSavedPlan || result.trim().length > 0;
  const recipeWarmupProgress = useMemo(() => {
    const totalSlots = calendarData.length * MEALS.length;
    const readySlots = calendarData.reduce((count, day) => {
      return (
        count +
        MEALS.filter(
          (mealType) =>
            typeof day.meals[mealType].recipe_content === 'string' &&
            day.meals[mealType].recipe_content.trim().length > 0
        ).length
      );
    }, 0);
    return {
      totalSlots,
      readySlots,
      percent: totalSlots > 0 ? Math.round((readySlots / totalSlots) * 100) : 0,
      isPartial: readySlots > 0 && readySlots < totalSlots,
    };
  }, [calendarData]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (hasSavedPlan) {
      setError('Ya tenés un menú guardado. Primero usá “Borrar guardado” para crear uno nuevo.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const effectivePeopleCount =
        Number.isFinite(peopleCount) && peopleCount > 0 ? peopleCount : 4;
      const apiMode: 'inventory_to_menu' | 'menu_to_shopping' =
        mode === 'inventory_to_menu' ? 'inventory_to_menu' : 'menu_to_shopping';
      const apiPeriod: PlannerPeriod = period;
      const skeletonCalendar = buildDefaultWeek(fusionLabel, []);
      setResult('');
      setPdfContextCount(0);
      setCalendarData(skeletonCalendar);
      setSimulationCalendar(skeletonCalendar);
      setPeopleCount(effectivePeopleCount);

      if (tenantId && userId) {
        await persistMealPlan(skeletonCalendar, '', effectivePeopleCount);
      }

      setError('Menú inicial listo. Las recetas se generan al abrir cada comida.');

      void (async () => {
        try {
          let pdfChunks: string[] = [];
          if (usePdfContext) {
            const supabase = getSupabaseBrowserClient();
            const query = `Menu ${period}. Cocina base ${baseCuisine}. Fusión ${fusionCuisines.join(', ') || 'sin fusión'}. Objetivo ${goal}. Ingredientes: ${inventory.join(', ') || 'sin inventario'}.`;
            const embedRes = await fetch('/api/embeddings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: [query] }),
            });

            if (embedRes.ok) {
              const embedPayload = (await embedRes.json()) as { embeddings: number[][] };
              const queryEmbedding = embedPayload.embeddings[0];
              const { data: chunkRows, error: chunksError } = await supabase.rpc('match_chunks', {
                query_embedding: queryEmbedding,
                match_threshold: 0.35,
                match_count: 8,
                filter_tenant_id: tenantId,
              });
              if (!chunksError) {
                pdfChunks = ((chunkRows ?? []) as MatchChunkRow[])
                  .filter((row) => typeof row.content === 'string' && row.content.trim().length > 0)
                  .sort((a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0))
                  .map((row) => row.content)
                  .slice(0, 8);
                setPdfContextCount(pdfChunks.length);
              }
            }
          }

          const res = await fetch('/api/meal-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: apiMode,
              period: apiPeriod,
              baseCuisine,
              fusionCuisines,
              fusionIntensity,
              peopleCount: effectivePeopleCount,
              inventory,
              culinaryProfile: {
                preferred: [...culinaryProfile.preferred, goal],
                avoid: selectedRestrictions,
                goals: culinaryProfile.goals,
                level: culinaryProfile.level,
              },
              chunks: pdfChunks,
            }),
          });

          if (!res.ok) {
            const payload = await readErrorPayload(res, 'Error generando menú.');
            throw new Error(payload.error ?? 'Error generando menú.');
          }

          const payload = (await res.json()) as { content: string };
          const content = payload.content;
          const parsedCalendar = parseMenuToCalendar(content, fusionLabel, pdfChunks);
          setResult(content);
          setCalendarData(parsedCalendar);
          setSimulationCalendar(parsedCalendar);

          if (tenantId && userId) {
            await persistMealPlan(parsedCalendar, content, effectivePeopleCount);

            const supabase = getSupabaseBrowserClient();
            const parsedShopping = extractShoppingItems(content);
            await supabase
              .from('shopping_list_items')
              .delete()
              .eq('tenant_id', tenantId)
              .eq('user_id', userId)
              .eq('source', 'meal_planner');

            const toInsert = parsedShopping.slice(0, 80).map((item) => ({
              tenant_id: tenantId,
              user_id: userId,
              source: 'meal_planner',
              ingredient_name: item,
              quantity: null,
              status: 'pending' as const,
            }));

            if (toInsert.length > 0) {
              await supabase.from('shopping_list_items').insert(toInsert);
            }
          }
        } catch (backgroundError) {
          setError(
            backgroundError instanceof Error ? backgroundError.message : 'Error generando menú.'
          );
          setCalendarData(skeletonCalendar);
          setSimulationCalendar(skeletonCalendar);
        }
      })();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando menú.');
    } finally {
      setLoading(false);
    }
  };

  const exportPlan = () => {
    const text =
      result ||
      calendarData
        .map(
          (day) =>
            `${day.day}\n- Desayuno: ${day.meals.Desayuno.name}\n- Almuerzo: ${day.meals.Almuerzo.name}\n- Cena: ${day.meals.Cena.name}`
        )
        .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cocinacore-menu.txt';
    a.click();
    URL.revokeObjectURL(url);
    setError('Menú exportado en TXT.');
  };

  const sharePlan = async () => {
    const text =
      result ||
      calendarData
        .map(
          (day) =>
            `${day.day}: ${day.meals.Desayuno.name} / ${day.meals.Almuerzo.name} / ${day.meals.Cena.name}`
        )
        .join('\n');
    if (navigator.share) {
      await navigator.share({ title: 'Mi menú CocinaCore', text });
      return;
    }
    await navigator.clipboard.writeText(text);
    setError('Menú copiado al portapapeles.');
  };

  const regenerateWeek = async () => {
    await onSubmit({ preventDefault: () => undefined } as FormEvent);
  };

  const persistMealPlan = async (
    calendarToSave: PlannerDay[],
    aiContent: string,
    effectivePeopleCount: number
  ) => {
    if (!tenantId || !userId) {
      setError('No se pudo guardar automáticamente: falta sesión o tenant.');
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { data: upsertedPlan, error: upsertError } = await supabase
      .from('user_meal_plans')
      .upsert(
        {
          tenant_id: tenantId,
          user_id: userId,
          people_count: effectivePeopleCount,
          period,
          mode,
          base_cuisine: baseCuisine,
          fusion_cuisines: fusionCuisines,
          fusion_intensity: fusionIntensity,
          goal,
          restrictions: selectedRestrictions,
          inventory_snapshot: inventory,
          calendar_payload: calendarToSave,
          ai_content: aiContent || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,user_id' }
      )
      .select('id')
      .single();

    if (upsertError) {
      setError(`No se pudo guardar menú automáticamente: ${upsertError.message}`);
      return;
    }

    setMealPlanId(upsertedPlan?.id ?? null);
    setHasSavedPlan(true);
    setPeopleCount(effectivePeopleCount);
    setCalendarData(calendarToSave);
  };

  const deleteSavedPlan = async () => {
    if (!tenantId || !userId) {
      setError('No se pudo borrar: falta sesión o tenant.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const deleteQuery = supabase
        .from('user_meal_plans')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);

      const scopedDeleteQuery = mealPlanId ? deleteQuery.eq('id', mealPlanId) : deleteQuery;
      const { data: deletedRows, error: deleteError } = await scopedDeleteQuery.select('id');

      if (deleteError) {
        setError(`No se pudo borrar menú: ${deleteError.message}`);
        return;
      }
      if (!deletedRows || deletedRows.length === 0) {
        setError('No se borró ningún menú guardado en BD para esta sesión.');
        return;
      }
      setHasSavedPlan(false);
      setMealPlanId(null);
      setResult('');
      const fallbackCalendar = buildDefaultWeek(buildFusionLabel(baseCuisine, fusionCuisines));
      setCalendarData(fallbackCalendar);
      setSimulationCalendar(fallbackCalendar);
      setInventorySuggestion([]);
      setInventorySuggestionUpdatedAt(null);
      setOptimizationHistory([]);
      setExpandedSnapshotId(null);
      setMealDetail((prev) => ({ ...prev, open: false, content: '', error: null, loading: false }));
      setError('Menú guardado eliminado.');
    } finally {
      setLoading(false);
    }
  };

  const generateInventorySuggestion = async () => {
    if (!tenantId || !userId) {
      setError('No se pudo generar inventario: falta sesión o tenant.');
      return;
    }
    const effectivePeopleCount = Number.isFinite(peopleCount) && peopleCount > 0 ? peopleCount : 4;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/meal-plan/inventory-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuContent: result,
          peopleCount: effectivePeopleCount,
          inventory,
          restrictions: selectedRestrictions,
          profile: {
            preferred: culinaryProfile.preferred,
            goals: culinaryProfile.goals,
            level: culinaryProfile.level,
          },
        }),
      });

      if (!response.ok) {
        const payload = await readErrorPayload(response, 'No se pudo generar inventario sugerido.');
        throw new Error(payload.error ?? 'No se pudo generar inventario sugerido.');
      }

      const payload = (await response.json()) as {
        items?: RawSuggestedItem[];
        peopleCount?: number;
      };
      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const normalizedItems = buildInventorySuggestion(rawItems, effectivePeopleCount);

      const supabase = getSupabaseBrowserClient();
      const { data: mealPlanRow } = await supabase
        .from('user_meal_plans')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .maybeSingle();

      const mealPlanId = mealPlanRow?.id;
      if (!mealPlanId) {
        throw new Error('Primero guardá el menú antes de generar inventario sugerido.');
      }

      const nowIso = new Date().toISOString();
      const { error: upsertError } = await supabase
        .from('user_meal_plan_inventory_suggestions')
        .upsert(
          {
            tenant_id: tenantId,
            user_id: userId,
            meal_plan_id: mealPlanId,
            people_count: effectivePeopleCount,
            period,
            normalized_items: normalizedItems,
            raw_items: rawItems,
            updated_at: nowIso,
          },
          { onConflict: 'tenant_id,user_id' }
        );
      if (upsertError) throw upsertError;

      setInventorySuggestion(normalizedItems);
      setInventorySuggestionUpdatedAt(nowIso);
      setError(`Inventario sugerido generado para ${effectivePeopleCount} personas.`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'No se pudo generar inventario sugerido.'
      );
    } finally {
      setLoading(false);
    }
  };

  const applyShoppingItemToInventory = async (payload: {
    category: string;
    item: (typeof smartShoppingList.groups)[number]['items'][number];
  }) => {
    setShoppingApplySummary(null);
    setShoppingApplyStage('Iniciando aplicación de compra...');

    if (!tenantId || !userId) {
      setError('No se pudo aplicar compra: falta sesión o tenant.');
      setShoppingApplyStage('No se detectó sesión/tenant para aplicar compra.');
      return;
    }
    const { item, category } = payload;
    const uiItemKey = `${category}-${item.normalizedName || item.ingredientName}`;
    if (item.status !== 'buy') {
      setShoppingApplyStage('El ingrediente seleccionado no requiere compra.');
      return;
    }
    if (item.quantityToBuy === null || item.quantityToBuy <= 0) {
      setError('Cantidad de compra no válida para aplicar.');
      setShoppingApplyStage('Cantidad a comprar inválida.');
      return;
    }

    const unit = normalizeUnit(item.unit);
    if (unit === 'unknown') {
      setError(`No se pudo aplicar ${item.ingredientName}: unidad no estructurada.`);
      setShoppingApplyStage('Unidad no estructurada: requiere revisión manual.');
      return;
    }

    setApplyingShoppingItemKey(uiItemKey);
    setError(null);
    setShoppingApplyStage(`Validando ${item.ingredientName}...`);

    try {
      const normalizedTarget = normalizeIngredientKey(item.normalizedName || item.ingredientName);
      if (!normalizedTarget) {
        setError(`No se pudo aplicar ${item.ingredientName}: nombre no normalizado.`);
        setShoppingApplyStage('No se pudo normalizar el nombre del ingrediente.');
        return;
      }

      const supabase = getSupabaseBrowserClient();
      setShoppingApplyStage('Buscando ingrediente existente...');
      let schemaMode: InventorySchemaMode = 'normalized';
      let existingRows: ShoppingInventoryRow[] = [];
      const { data: normalizedRows, error: fetchError } = await supabase
        .from('recipe_inventory_items')
        .select('id, ingredient_name, normalized_name, quantity, unit, category')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(120);

      if (fetchError && isMissingDbColumnError(fetchError)) {
        schemaMode = 'legacy';
        const { data: legacyRows, error: legacyFetchError } = await supabase
          .from('recipe_inventory_items')
          .select('id, ingredient_name, quantity')
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(120);
        if (legacyFetchError) throw legacyFetchError;
        existingRows = (legacyRows ?? []) as ShoppingInventoryRow[];
        setShoppingApplyStage(
          'Inventario con esquema anterior detectado. Aplicando compatibilidad...'
        );
      } else if (fetchError) {
        throw fetchError;
      } else {
        existingRows = (normalizedRows ?? []) as ShoppingInventoryRow[];
      }

      const candidateRows = (existingRows ?? []).filter((row) => {
        const rowNormalized = normalizeIngredientKey(row.normalized_name ?? row.ingredient_name);
        const rowIngredientName = normalizeIngredientKey(row.ingredient_name);
        return rowNormalized === normalizedTarget || rowIngredientName === normalizedTarget;
      });

      const targetRow =
        candidateRows.find((row) => {
          const rowUnit =
            schemaMode === 'normalized'
              ? normalizeUnit(row.unit ?? null)
              : parseQuantity(row.quantity ?? '').unit;
          if (rowUnit === 'unknown')
            return row.quantity === null || row.quantity.trim().length === 0;
          return canCompareUnits(rowUnit, unit);
        }) ?? candidateRows[0];

      if (!targetRow) {
        setShoppingApplyStage('Insertando ingrediente en inventario...');
        const insertPayload: Database['public']['Tables']['recipe_inventory_items']['Insert'] = {
          tenant_id: tenantId,
          user_id: userId,
          ingredient_name: item.ingredientName,
          quantity:
            schemaMode === 'normalized'
              ? formatInventoryQuantityValue(item.quantityToBuy)
              : `${formatInventoryQuantityValue(item.quantityToBuy)} ${item.unit}`,
          notes: 'Agregado desde lista inteligente de compras',
        };
        if (schemaMode === 'normalized') {
          insertPayload.normalized_name = normalizedTarget;
          insertPayload.unit = item.unit;
          insertPayload.category = category;
        }
        const { data: insertedRows, error: insertError } = await supabase
          .from('recipe_inventory_items')
          .insert(insertPayload)
          .select('id')
          .limit(1);
        if (insertError) throw insertError;

        const insertedRow = insertedRows?.[0];
        if (insertedRow?.id) {
          setShoppingApplyStage('Registrando movimiento de compra...');
          const { error: movementError } = await supabase.from('inventory_movements').insert({
            tenant_id: tenantId,
            user_id: userId,
            inventory_item_id: insertedRow.id,
            movement_type: 'purchase',
            quantity: item.quantityToBuy,
            unit: item.unit,
            normalized_name: normalizedTarget,
            source: 'shopping_list',
            source_recipe: null,
            source_meal_plan_id: mealPlanId,
            notes: 'Aplicado desde lista inteligente de compras',
          });
          if (movementError) {
            setShoppingApplyStage(
              `Inventario actualizado. Movimiento no registrado: ${movementError.message}`
            );
          }
        }
      } else {
        setShoppingApplyStage('Actualizando cantidad existente...');
        const currentQuantityRaw =
          schemaMode === 'normalized'
            ? [targetRow.quantity ?? '', targetRow.unit ?? ''].join(' ').trim()
            : (targetRow.quantity ?? '');
        const parsedCurrent = parseQuantity(currentQuantityRaw);
        const rowUnit =
          schemaMode === 'normalized' ? normalizeUnit(targetRow.unit ?? null) : parsedCurrent.unit;

        let nextQuantityValue = item.quantityToBuy;
        let nextUnitValue: string = item.unit;

        if (parsedCurrent.structured && parsedCurrent.value !== null && rowUnit !== 'unknown') {
          const incomingConverted = convertToUnit(item.quantityToBuy, unit, rowUnit);
          if (incomingConverted === null) {
            setError(
              `No se pudo aplicar ${item.ingredientName}: unidades incompatibles (${item.unit} vs ${targetRow.unit ?? 'sin unidad'}).`
            );
            setShoppingApplyStage('Unidades incompatibles entre compra e inventario existente.');
            return;
          }
          nextQuantityValue = Number((parsedCurrent.value + incomingConverted).toFixed(3));
          nextUnitValue = targetRow.unit ?? item.unit;
        } else if ((targetRow.quantity ?? '').trim().length > 0 && rowUnit === 'unknown') {
          setError(
            `No se pudo sumar ${item.ingredientName} automáticamente porque el inventario actual no tiene unidad comparable.`
          );
          setShoppingApplyStage('No se pudo sumar automáticamente por unidad no comparable.');
          return;
        }

        const updatePayload: Database['public']['Tables']['recipe_inventory_items']['Update'] = {
          ingredient_name: targetRow.ingredient_name || item.ingredientName,
          quantity:
            schemaMode === 'normalized'
              ? formatInventoryQuantityValue(nextQuantityValue)
              : `${formatInventoryQuantityValue(nextQuantityValue)} ${nextUnitValue}`,
          updated_at: new Date().toISOString(),
        };
        if (schemaMode === 'normalized') {
          updatePayload.unit = nextUnitValue;
          updatePayload.category = targetRow.category ?? category;
        }

        const { error: updateError } = await supabase
          .from('recipe_inventory_items')
          .update(updatePayload)
          .eq('id', targetRow.id)
          .eq('tenant_id', tenantId)
          .eq('user_id', userId);
        if (updateError) throw updateError;

        setShoppingApplyStage('Registrando movimiento de compra...');
        const { error: movementError } = await supabase.from('inventory_movements').insert({
          tenant_id: tenantId,
          user_id: userId,
          inventory_item_id: targetRow.id,
          movement_type: 'purchase',
          quantity: item.quantityToBuy,
          unit: item.unit,
          normalized_name: normalizedTarget,
          source: 'shopping_list',
          source_recipe: null,
          source_meal_plan_id: mealPlanId,
          notes: 'Aplicado desde lista inteligente de compras',
        });
        if (movementError) {
          setShoppingApplyStage(
            `Inventario actualizado. Movimiento no registrado: ${movementError.message}`
          );
        }
      }

      setShoppingApplyStage('Refrescando inventario local...');
      const { data: inventoryRows, error: inventoryError } = await supabase
        .from('recipe_inventory_items')
        .select(
          'id, ingredient_name, normalized_name, quantity, unit, category, estimated_unit_price'
        )
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      let refreshedRows = (inventoryRows ?? []) as ShoppingInventoryRow[];
      if (inventoryError && isMissingDbColumnError(inventoryError)) {
        const { data: legacyInventoryRows, error: legacyInventoryError } = await supabase
          .from('recipe_inventory_items')
          .select('id, ingredient_name, quantity')
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });
        if (legacyInventoryError) {
          throw new Error(
            `Compra aplicada pero falló refresco local: ${legacyInventoryError.message}`
          );
        }
        refreshedRows = (legacyInventoryRows ?? []) as ShoppingInventoryRow[];
      } else if (inventoryError) {
        throw new Error(`Compra aplicada pero falló refresco local: ${inventoryError.message}`);
      }

      const rows = toInventoryRows(refreshedRows);
      setInventoryItems(rows);
      setInventory(
        rows.map((row) => `${row.ingredient_name} ${row.quantity ?? ''}`.trim()).filter(Boolean)
      );

      setShoppingApplySummary(
        `Compra aplicada: ${item.ingredientName} +${item.quantityToBuy} ${item.unit}. Inventario actualizado.`
      );
      setShoppingApplyStage('Compra aplicada correctamente.');

      const { count: verifyCount, error: verifyError } = await supabase
        .from('recipe_inventory_items')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);
      if (!verifyError && typeof verifyCount === 'number') {
        setShoppingApplyStage(
          `Compra aplicada correctamente. Inventario activo: ${verifyCount} ingredientes.`
        );
      }
    } catch (caughtError) {
      setError(getErrorMessage(caughtError, 'No se pudo aplicar compra al inventario.'));
      setShoppingApplySummary(null);
      setShoppingApplyStage('Falló la aplicación de compra. Revisá el error.');
    } finally {
      setApplyingShoppingItemKey(null);
    }
  };

  const mealConsumptionPreview = useMemo(() => {
    const card = mealDetail.card;
    if (!card) return { items: [] as ConsumptionPreviewItem[], canApply: false };
    const structured = card.structured_ingredients ?? [];
    const items: ConsumptionPreviewItem[] = structured.map((ingredient) => {
      const requiredUnitNormalized = normalizeUnit(ingredient.unit);
      if (
        !ingredient.structured ||
        ingredient.quantity === null ||
        requiredUnitNormalized === 'unknown'
      ) {
        return {
          ingredientName: ingredient.name,
          normalizedName: ingredient.normalized_name,
          requiredQuantity: ingredient.quantity,
          requiredUnit: ingredient.unit,
          availableQuantity: null,
          availableUnit: null,
          afterQuantity: null,
          afterUnit: null,
          status: 'review',
          reason: 'Ingrediente no estructurado o unidad no comparable',
        };
      }

      const candidates = inventoryItems.filter(
        (row) =>
          (row.normalized_name ?? normalizeInventoryName(row.ingredient_name)) ===
          ingredient.normalized_name
      );
      if (candidates.length === 0) {
        return {
          ingredientName: ingredient.name,
          normalizedName: ingredient.normalized_name,
          requiredQuantity: ingredient.quantity,
          requiredUnit: ingredient.unit,
          availableQuantity: 0,
          availableUnit: ingredient.unit,
          afterQuantity: 0,
          afterUnit: ingredient.unit,
          status: 'insufficient',
          reason: 'No está en inventario',
        };
      }

      const targetRow = candidates.find((row) => {
        const rowUnit = normalizeUnit(row.unit);
        return rowUnit !== 'unknown' && canCompareUnits(rowUnit, requiredUnitNormalized);
      });
      if (!targetRow) {
        return {
          ingredientName: ingredient.name,
          normalizedName: ingredient.normalized_name,
          requiredQuantity: ingredient.quantity,
          requiredUnit: ingredient.unit,
          availableQuantity: null,
          availableUnit: null,
          afterQuantity: null,
          afterUnit: null,
          status: 'review',
          reason: 'Unidad incompatible con inventario',
        };
      }

      const rowParsed = parseQuantity(
        [targetRow.quantity ?? '', targetRow.unit ?? ''].join(' ').trim()
      );
      const rowUnit = normalizeUnit(targetRow.unit);
      if (!rowParsed.structured || rowParsed.value === null || rowUnit === 'unknown') {
        return {
          ingredientName: ingredient.name,
          normalizedName: ingredient.normalized_name,
          requiredQuantity: ingredient.quantity,
          requiredUnit: ingredient.unit,
          availableQuantity: null,
          availableUnit: targetRow.unit,
          afterQuantity: null,
          afterUnit: targetRow.unit,
          status: 'review',
          reason: 'Cantidad actual no estructurada en inventario',
          inventoryItemId: targetRow.id,
        };
      }

      const availableInRequiredUnit =
        rowUnit === requiredUnitNormalized
          ? rowParsed.value
          : convertQuantity(rowParsed.value, rowUnit, requiredUnitNormalized);
      if (availableInRequiredUnit === null) {
        return {
          ingredientName: ingredient.name,
          normalizedName: ingredient.normalized_name,
          requiredQuantity: ingredient.quantity,
          requiredUnit: ingredient.unit,
          availableQuantity: null,
          availableUnit: ingredient.unit,
          afterQuantity: null,
          afterUnit: ingredient.unit,
          status: 'review',
          reason: 'No se pudo convertir unidades',
          inventoryItemId: targetRow.id,
        };
      }

      const status: ConsumptionStatus =
        availableInRequiredUnit >= ingredient.quantity ? 'sufficient' : 'insufficient';
      const remainingInRequiredUnit = Number(
        Math.max(availableInRequiredUnit - ingredient.quantity, 0).toFixed(3)
      );

      return {
        ingredientName: ingredient.name,
        normalizedName: ingredient.normalized_name,
        requiredQuantity: ingredient.quantity,
        requiredUnit: ingredient.unit,
        availableQuantity: Number(availableInRequiredUnit.toFixed(3)),
        availableUnit: ingredient.unit,
        afterQuantity: remainingInRequiredUnit,
        afterUnit: ingredient.unit,
        status,
        reason: status === 'insufficient' ? 'No alcanza inventario' : undefined,
        inventoryItemId: targetRow.id,
      };
    });

    const canApply = items.length > 0 && items.every((item) => item.status === 'sufficient');
    return { items, canApply };
  }, [mealDetail.card, inventoryItems]);

  const applyRecipeConsumption = async () => {
    if (!mealDetail.card || !tenantId || !userId) {
      setError('No se pudo aplicar consumo: falta receta o sesión.');
      return;
    }
    const preview = mealConsumptionPreview;
    if (preview.items.length === 0) {
      setError('Esta receta no tiene ingredientes estructurados para consumo real.');
      return;
    }
    if (!preview.canApply) {
      setError('Esta receta requiere revisión manual antes de descontar inventario.');
      return;
    }

    setConsumingRecipe(true);
    setError(null);
    setShoppingApplySummary(null);
    try {
      const supabase = getSupabaseBrowserClient();
      for (const item of preview.items) {
        if (!item.inventoryItemId || item.requiredQuantity === null || !item.requiredUnit) continue;

        const { data: row, error: fetchError } = await supabase
          .from('recipe_inventory_items')
          .select('id, quantity, unit')
          .eq('id', item.inventoryItemId)
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .maybeSingle();
        if (fetchError || !row)
          throw new Error('No se pudo validar inventario antes de aplicar consumo.');

        const rowParsed = parseQuantity([row.quantity ?? '', row.unit ?? ''].join(' ').trim());
        const rowUnit = normalizeUnit(row.unit);
        const reqUnit = normalizeUnit(item.requiredUnit);
        if (
          !rowParsed.structured ||
          rowParsed.value === null ||
          rowUnit === 'unknown' ||
          reqUnit === 'unknown'
        ) {
          throw new Error(`No se pudo consumir ${item.ingredientName}: unidad no comparable.`);
        }
        const requiredInRowUnit =
          reqUnit === rowUnit
            ? item.requiredQuantity
            : convertQuantity(item.requiredQuantity, reqUnit, rowUnit);
        if (requiredInRowUnit === null) {
          throw new Error(`No se pudo convertir unidad para ${item.ingredientName}.`);
        }
        if (rowParsed.value < requiredInRowUnit) {
          throw new Error(`Inventario insuficiente para ${item.ingredientName}.`);
        }

        const nextQuantity = Number((rowParsed.value - requiredInRowUnit).toFixed(3));
        const { error: updateError } = await supabase
          .from('recipe_inventory_items')
          .update({
            quantity: formatInventoryQuantityValue(nextQuantity),
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.inventoryItemId)
          .eq('tenant_id', tenantId)
          .eq('user_id', userId);
        if (updateError) throw updateError;

        const { error: movementError } = await supabase.from('inventory_movements').insert({
          tenant_id: tenantId,
          user_id: userId,
          inventory_item_id: item.inventoryItemId,
          movement_type: 'recipe_consumption',
          quantity: item.requiredQuantity,
          unit: item.requiredUnit,
          normalized_name: item.normalizedName,
          source: 'meal_planner',
          source_recipe: mealDetail.card.name.replace(/\*\*/g, '').trim(),
          source_meal_plan_id: mealPlanId,
          notes: `${mealDetail.day} · ${mealDetail.mealType}`,
        });
        if (movementError) throw movementError;
      }

      const { data: inventoryRows } = await supabase
        .from('recipe_inventory_items')
        .select(
          'id, ingredient_name, normalized_name, quantity, unit, category, estimated_unit_price'
        )
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      const normalizedRows = (inventoryRows ?? []) as InventoryItemExtended[];
      setInventoryItems(normalizedRows);
      setInventory(
        normalizedRows
          .map((row) => `${row.ingredient_name} ${row.quantity ?? ''}`.trim())
          .filter(Boolean)
      );

      const { data: movementRows } = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(8);
      setRecentMovements((movementRows ?? []) as InventoryMovementRow[]);

      setShoppingApplySummary(
        `Consumo aplicado: ${mealDetail.card.name.replace(/\*\*/g, '').trim()} actualizado en inventario real.`
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'No se pudo aplicar consumo real.'
      );
    } finally {
      setConsumingRecipe(false);
    }
  };

  const shareShoppingToWhatsapp = () => {
    setShoppingShareFeedback(null);
    const encoded = encodeURIComponent(shoppingWhatsappText);
    const url = `https://wa.me/?text=${encoded}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setShoppingShareFeedback('Lista lista para enviar por WhatsApp.');
  };

  const copyShoppingList = async () => {
    try {
      await navigator.clipboard.writeText(shoppingWhatsappText);
      setShoppingShareFeedback('Lista copiada al portapapeles.');
    } catch {
      setShoppingShareFeedback('No se pudo copiar. Probá enviar directo por WhatsApp.');
    }
  };

  const generateMealDetailFromAI = async (
    day: string,
    mealType: MealType,
    card: PlannerMealCard
  ) => {
    const cleanTitle = card.name.replace(/\*\*/g, '').trim();
    setMealDetail((prev) => ({
      ...prev,
      open: true,
      day,
      mealType,
      card,
      loading: true,
      error: null,
    }));

    try {
      const ingredients = [cleanTitle, ...inventory.slice(0, 8)];
      const response = await fetch('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipeName: cleanTitle,
          mealType,
          day,
          ingredients,
          chunks: card.rag_context ?? [],
          culinaryProfile: {
            level: culinaryProfile.level,
            preferred: culinaryProfile.preferred,
            avoid: selectedRestrictions,
            goals: culinaryProfile.goals,
            identity: [baseCuisine, ...fusionCuisines],
          },
        }),
      });

      if (!response.ok) {
        const payload = await readErrorPayload(response, 'No se pudo cargar la preparación.');
        setMealDetail((prev) => ({
          ...prev,
          loading: false,
          error: payload.error ?? 'No se pudo cargar la preparación.',
        }));
        return;
      }

      const payload = (await response.json()) as {
        recipe?: string;
        structuredIngredients?: StructuredRecipeIngredient[];
      };
      const content = payload.recipe?.trim();

      if (!content) {
        setMealDetail((prev) => ({
          ...prev,
          loading: false,
          error: 'No se encontró preparación para esta receta.',
        }));
        return;
      }

      const structuredForMeal = sanitizeStructuredIngredients(payload.structuredIngredients);
      const nextCalendar = patchMealInCalendar(calendarData, day, mealType, {
        structured_ingredients: structuredForMeal,
        recipe_content: content,
      });
      const nextSimulation = patchMealInCalendar(simulationCalendar, day, mealType, {
        structured_ingredients: structuredForMeal,
        recipe_content: content,
      });

      setCalendarData(nextCalendar);
      setSimulationCalendar(nextSimulation);

      if (tenantId && userId) {
        await persistMealPlan(nextCalendar, result, peopleCount);
      }

      setMealDetail((prev) => ({
        ...prev,
        loading: false,
        content,
        card: prev.card
          ? {
              ...prev.card,
              structured_ingredients: structuredForMeal,
              recipe_content: content,
            }
          : prev.card,
        error: null,
      }));
      setMealDetailTab('summary');
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Error al cargar preparación.';
      setMealDetail((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const openMealDetail = async (day: string, mealType: MealType, card: PlannerMealCard) => {
    const cachedContent = typeof card.recipe_content === 'string' ? card.recipe_content.trim() : '';
    if (cachedContent.length > 0) {
      let nextCard = card;
      const hasStructured = (card.structured_ingredients ?? []).length > 0;
      if (!hasStructured) {
        const parsedStructured = sanitizeStructuredIngredients(
          extractStructuredIngredients(cachedContent)
        );
        if (parsedStructured.length > 0) {
          nextCard = {
            ...card,
            structured_ingredients: parsedStructured,
          };

          const nextCalendar = patchMealInCalendar(calendarData, day, mealType, {
            structured_ingredients: parsedStructured,
          });
          const nextSimulation = patchMealInCalendar(simulationCalendar, day, mealType, {
            structured_ingredients: parsedStructured,
          });
          setCalendarData(nextCalendar);
          setSimulationCalendar(nextSimulation);

          if (tenantId && userId) {
            const supabase = getSupabaseBrowserClient();
            const { error: persistError } = await supabase
              .from('user_meal_plans')
              .update({
                calendar_payload: nextCalendar,
                updated_at: new Date().toISOString(),
              })
              .eq('tenant_id', tenantId)
              .eq('user_id', userId);
            if (persistError) {
              setError(`No se pudo persistir ingredientes estructurados: ${persistError.message}`);
            }
          }
        }
      }

      setMealDetail({
        open: true,
        day,
        mealType,
        card: nextCard,
        content: cachedContent,
        loading: false,
        error: null,
      });
      setMealDetailTab('summary');
      return;
    }

    setMealDetail({
      open: true,
      day,
      mealType,
      card,
      content: '',
      loading: true,
      error: null,
    });
    setMealDetailTab('summary');
    void generateMealDetailFromAI(day, mealType, card);
  };

  const toggleRestriction = (value: string) => {
    setSelectedRestrictions((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const toggleFusionCuisine = (value: string) => {
    setFusionCuisines((prev) => {
      if (prev.includes(value)) return prev.filter((item) => item !== value);
      if (prev.length >= 2) return prev;
      return [...prev, value];
    });
  };

  const moveMealAcrossDay = (dayIndex: number, mealType: MealType, direction: -1 | 1) => {
    setSimulationCalendar((prev) =>
      moveMealAcrossDayState(prev, dayIndex, mealType, direction, lockedMeals)
    );
  };

  const buildAlternativesForMeal = (mealType: MealType): RecipeAlternative[] => {
    const hasInventory = inventoryItems.length > 0;
    const goalLabel = goal.toLowerCase();
    const fusionLabel = fusionCuisines.length > 0 ? fusionCuisines.join(' + ') : baseCuisine;
    const baseSuggestions: Record<MealType, string[]> = {
      Desayuno: [
        'Arepa integral con huevos',
        'Smoothie bowl tropical',
        'Tostadas de aguacate y tomate',
      ],
      Almuerzo: [
        'Pollo al horno con vegetales',
        'Pasta cremosa de semana',
        'Ensalada tibia con proteína',
      ],
      Cena: ['Sopa ligera de vegetales', 'Tacos de pollo rápidos', 'Bowl de arroz con verduras'],
    };
    return baseSuggestions[mealType].map((title, index) => ({
      id: `${mealType}-${index}-${Date.now()}`,
      title,
      description: `Alternativa ${fusionLabel} adaptada al objetivo ${goalLabel}.`,
      reasons: [
        hasInventory ? 'Usa ingredientes que ya tenés.' : 'Reduce compras adicionales.',
        index === 0
          ? 'Bajo costo estimado.'
          : index === 1
            ? 'Se prepara más rápido.'
            : 'Disminuye desperdicio.',
        'Compatible con tu planificación actual.',
      ],
      time: index === 1 ? '25 min' : '35 min',
      difficulty: index === 0 ? 'Media' : 'Fácil',
    }));
  };

  const openReplacementModal = (day: string, mealType: MealType) => {
    if (lockedMeals.includes(mealKey(day, mealType))) {
      setError('Esa receta está bloqueada en personalización avanzada.');
      return;
    }
    setReplacementTarget({ day, mealType });
    setReplacementAlternatives(buildAlternativesForMeal(mealType));
  };

  const replaceMealWithAlternative = (alternativeId: string) => {
    const target = replacementTarget;
    if (!target) return;
    const selectedAlternative = replacementAlternatives.find((item) => item.id === alternativeId);
    if (!selectedAlternative) return;
    const fusionLabel = buildFusionLabel(baseCuisine, fusionCuisines);
    setSimulationCalendar((prev) =>
      prev.map((dayEntry) =>
        dayEntry.day !== target.day
          ? dayEntry
          : {
              ...dayEntry,
              meals: {
                ...dayEntry.meals,
                [target.mealType]: {
                  ...dayEntry.meals[target.mealType],
                  name: selectedAlternative.title,
                  time: selectedAlternative.time,
                  difficulty: selectedAlternative.difficulty,
                  badge: 'Ajuste inteligente',
                  fusionTag: `Fusión ${fusionLabel}`,
                  aiScore: Math.max(84, dayEntry.meals[target.mealType].aiScore - 1),
                },
              },
            }
      )
    );
    setReplacementTarget(null);
    setReplacementAlternatives([]);
  };

  const regenerateMealSlot = () => {
    const target = replacementTarget;
    if (!target) return;
    const generated = buildAlternativesForMeal(target.mealType)[Math.floor(Math.random() * 3)];
    if (!generated) return;
    const fusionLabel = buildFusionLabel(baseCuisine, fusionCuisines);
    setSimulationCalendar((prev) =>
      prev.map((dayEntry) =>
        dayEntry.day !== target.day
          ? dayEntry
          : {
              ...dayEntry,
              meals: {
                ...dayEntry.meals,
                [target.mealType]: {
                  ...dayEntry.meals[target.mealType],
                  name: generated.title,
                  time: generated.time,
                  difficulty: generated.difficulty,
                  badge: 'Regenerada',
                  fusionTag: `Fusión ${fusionLabel}`,
                  aiScore: Math.max(80, dayEntry.meals[target.mealType].aiScore - 2),
                },
              },
            }
      )
    );
    setReplacementTarget(null);
    setReplacementAlternatives([]);
  };

  const regenerateSingleMeal = (day: string, mealType: MealType) => {
    if (lockedMeals.includes(mealKey(day, mealType))) {
      setError('Esa receta está bloqueada en personalización avanzada.');
      return;
    }
    setReplacementTarget({ day, mealType });
    setReplacementAlternatives(buildAlternativesForMeal(mealType));
  };

  const regenerateDayMeals = (day: string) => {
    setSimulationCalendar((prev) =>
      prev.map((entry) => {
        if (entry.day !== day) return entry;
        const nextMeals: Record<MealType, PlannerMealCard> = { ...entry.meals };
        MEALS.forEach((mealType) => {
          if (lockedMeals.includes(mealKey(day, mealType))) return;
          const nextSuggestion = buildAlternativesForMeal(mealType)[Math.floor(Math.random() * 3)];
          if (!nextSuggestion) return;
          nextMeals[mealType] = {
            ...nextMeals[mealType],
            name: nextSuggestion.title,
            time: nextSuggestion.time,
            difficulty: nextSuggestion.difficulty,
            badge: 'Regenerada',
            aiScore: Math.max(82, nextMeals[mealType].aiScore - 2),
          };
        });
        return { ...entry, meals: nextMeals };
      })
    );
  };

  const moveMealAcrossSlot = (dayIndex: number, mealType: MealType, direction: -1 | 1) => {
    setSimulationCalendar((prev) =>
      moveMealAcrossSlotState(prev, dayIndex, mealType, direction, lockedMeals)
    );
  };

  const toggleLockedMeal = (day: string, mealType: MealType) => {
    const key = mealKey(day, mealType);
    setLockedMeals((prev) =>
      prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key]
    );
  };

  const toggleIngredientConstraint = (value: string) => {
    setIngredientConstraints((prev) =>
      prev.includes(value) ? prev.filter((entry) => entry !== value) : [...prev, value]
    );
  };

  const applyOptimization = (mode: OptimizationMode) => {
    const optimizedCalendar = applyOptimizationState(simulationCalendar, mode, lockedMeals);
    setActiveOptimizationMode(mode);
    setSimulationCalendar(optimizedCalendar);

    void (async () => {
      if (!tenantId || !userId) return;

      const supabase = getSupabaseBrowserClient();
      let resolvedMealPlanId = mealPlanId;

      if (!resolvedMealPlanId) {
        const { data: planRow } = await supabase
          .from('user_meal_plans')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .maybeSingle();
        resolvedMealPlanId = planRow?.id ?? null;
      }

      if (!resolvedMealPlanId) return;

      const optimizedSimulation = buildMealPlanSimulation(
        toSimulationDays(optimizedCalendar),
        constrainedProjectionItems
      );
      const optimizedScore = calculateMealPlanScore(inventoryProjection, optimizedSimulation, mode);
      const baseline = calculateMealPlanScore(inventoryProjection, baselineSimulation, mode);
      const comparison = compareMealPlans(baseline, optimizedScore);
      const notes = explainOptimization(comparison, mode);

      const { data: insertedSnapshot, error: snapshotError } = await supabase
        .from('user_meal_plan_optimization_snapshots')
        .insert({
          tenant_id: tenantId,
          user_id: userId,
          meal_plan_id: resolvedMealPlanId,
          optimization_mode: mode,
          baseline_score: baseline,
          optimized_score: optimizedScore,
          comparison,
          explainability_notes: notes,
          baseline_calendar: calendarData,
          optimized_calendar: optimizedCalendar,
          metadata: {
            period,
            peopleCount,
            constraints: ingredientConstraints,
            lockedMealsCount: lockedMeals.length,
          },
        })
        .select('*')
        .single();

      if (snapshotError) {
        setError(`No se pudo guardar snapshot de optimización: ${snapshotError.message}`);
        return;
      }

      setMealPlanId(resolvedMealPlanId);
      if (insertedSnapshot) {
        const [parsed] = parseSnapshot([insertedSnapshot as OptimizationSnapshotRow]);
        if (parsed) {
          setOptimizationHistory((prev) =>
            [parsed, ...prev.filter((entry) => entry.id !== parsed.id)].slice(0, 12)
          );
        }
      }
    })();
  };

  const resetSimulation = () => {
    setSimulationCalendar(calendarData);
    setIngredientConstraints([]);
    setActiveOptimizationMode(null);
    setError('Simulación restablecida al menú original.');
  };

  const applySimulationToMenu = () => {
    setCalendarData(simulationCalendar);
    setActiveOptimizationMode(null);
    setError('Reorganización aplicada al menú (sin tocar stock real).');
  };

  const restoreSnapshotTemporarily = (snapshot: OptimizationSnapshotView) => {
    if (!Array.isArray(snapshot.optimizedCalendar) || snapshot.optimizedCalendar.length === 0) {
      setError('Ese snapshot no tiene calendario válido para restaurar.');
      return;
    }
    setSimulationCalendar(snapshot.optimizedCalendar);
    setActiveOptimizationMode(snapshot.mode);
    setError('Simulación restaurada desde historial (sin tocar stock real).');
  };

  const deleteOptimizationSnapshot = async (snapshotId: string) => {
    if (!tenantId || !userId) {
      setError('No se pudo eliminar snapshot: falta sesión o tenant.');
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const { error: deleteError } = await supabase
      .from('user_meal_plan_optimization_snapshots')
      .delete()
      .eq('id', snapshotId)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (deleteError) {
      setError(`No se pudo eliminar snapshot: ${deleteError.message}`);
      return;
    }

    setOptimizationHistory((prev) => prev.filter((entry) => entry.id !== snapshotId));
    setExpandedSnapshotId((prev) => (prev === snapshotId ? null : prev));
    setError('Snapshot eliminado del historial.');
  };

  const exportOptimizationSnapshot = (snapshot: OptimizationSnapshotView) => {
    const payload = {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      mode: snapshot.mode,
      baselineScore: snapshot.baselineScore,
      optimizedScore: snapshot.optimizedScore,
      comparison: snapshot.comparison,
      notes: snapshot.notes,
      baselineCalendar: snapshot.baselineCalendar,
      optimizedCalendar: snapshot.optimizedCalendar,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cocinacore-optimization-${snapshot.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderPeriodView = () => {
    const dayTabs = DAY_NAMES.map((day, idx) => (
      <button
        key={`tab-${day}`}
        type="button"
        onClick={() => setActiveDayIndex(idx)}
        className={`rounded-lg border px-2.5 py-1 text-xs font-semibold sm:text-sm ${
          activeDayIndex === idx
            ? 'border-[#16110D] bg-[#16110D] text-[#F5ECE2]'
            : 'border-[#E8DDD2] bg-white text-[#6B5A50] hover:border-[#C56A1A]/40'
        }`}
      >
        {day.slice(0, 3)}
      </button>
    ));

    const renderSingleDay = (day: PlannerDay) => (
      <section className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <CalendarDays size={14} className="text-[#C56A1A]" />
            <p className="text-sm font-semibold">{day.day}</p>
          </div>
          <button
            type="button"
            onClick={() => regenerateDayMeals(day.day)}
            className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
          >
            Regenerar día
          </button>
        </div>
        <div className="space-y-2">
          {MEALS.map((mealType) => (
            <MealCard
              key={`${day.day}-${mealType}`}
              day={day.day}
              mealType={mealType}
              card={day.meals[mealType]}
              onViewPreparation={openMealDetail}
              onChangeRecipe={openReplacementModal}
              onRegenerateMeal={regenerateSingleMeal}
              onSelectMeal={setSelectedMeal}
              selected={selectedMeal?.day === day.day && selectedMeal?.mealType === mealType}
              locked={lockedMeals.includes(mealKey(day.day, mealType))}
            />
          ))}
        </div>
      </section>
    );

    if (period === 'fortnight') {
      const weekDays = activeWeekIndex === 0 ? calendarData.slice(0, 7) : calendarData.slice(0, 7);
      const safeDay = weekDays[activeDayIndex] ?? weekDays[0];
      return (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveWeekIndex(0)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold sm:text-sm ${activeWeekIndex === 0 ? 'border-[#16110D] bg-[#16110D] text-[#F5ECE2]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
            >
              Semana 1
            </button>
            <button
              type="button"
              onClick={() => setActiveWeekIndex(1)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold sm:text-sm ${activeWeekIndex === 1 ? 'border-[#16110D] bg-[#16110D] text-[#F5ECE2]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
            >
              Semana 2
            </button>
          </div>
          <div className="flex flex-wrap gap-2">{dayTabs}</div>
          {safeDay ? renderSingleDay(safeDay) : null}
        </section>
      );
    }

    if (period === 'month') {
      const safeDay = calendarData[activeDayIndex % Math.max(calendarData.length, 1)] ?? null;
      return (
        <section className="space-y-3">
          <section className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[#6B5A50]">Vista mensual compacta</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {Array.from({ length: 28 }).map((_, idx) => {
                const dayData = calendarData[idx % calendarData.length];
                const active = idx === activeDayIndex;
                return (
                  <button
                    type="button"
                    key={`month-${idx + 1}`}
                    onClick={() => setActiveDayIndex(idx)}
                    className={`rounded-xl border bg-white p-2 text-left ${active ? 'border-[#16110D] ring-1 ring-[#16110D]/20' : 'border-[#E8DDD2]'}`}
                  >
                    <p className="text-xs font-semibold text-[#6B5A50]">Día {idx + 1}</p>
                    <p className="mt-1 text-xs text-[#241A14] line-clamp-2">
                      {dayData.meals.Cena.name}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
          {safeDay ? renderSingleDay(safeDay) : null}
        </section>
      );
    }

    const safeDay = calendarData[activeDayIndex] ?? calendarData[0];
    return (
      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">{dayTabs}</div>
        {safeDay ? renderSingleDay(safeDay) : null}
      </section>
    );
  };

  return (
    <>
      <main className="texture-paper min-h-screen bg-[#FAF6F1] px-2 py-4 text-[#241A14] sm:px-3 sm:py-5 md:px-6 md:py-7 xl:py-8">
        <section className="mx-auto w-full max-w-[1400px]">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-3xl border border-[#E8DDD2] bg-white/85 p-3 premium-shadow sm:p-4 md:p-6 xl:p-7"
          >
            <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-[#6D4AFF]/10 blur-3xl" />
            <div className="pointer-events-none absolute left-0 top-0 h-40 w-40 rounded-full bg-[#C56A1A]/10 blur-3xl" />

            <div className="relative flex flex-col gap-5 md:gap-6">
              <div className="mx-auto w-full xl:max-w-4xl">
                <div className="flex w-full items-center justify-center rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 md:w-auto">
                  <Image
                    src="/logo.png"
                    alt="CocinaCore"
                    width={200}
                    height={56}
                    className="h-32 w-auto sm:h-64"
                  />
                </div>
                <h1 className="mt-4 text-center text-2xl font-semibold leading-tight sm:text-3xl md:text-4xl lg:text-5xl">
                  Planificador culinario inteligente
                </h1>
                <p className="mt-2 text-center text-base text-[#6B5A50] sm:text-lg md:mx-auto md:max-w-4xl">
                  Organiza comidas semanales, quincenales o mensuales usando IA, inventario y
                  preferencias culinarias.
                </p>
              </div>

              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-center">
                <Link
                  href="/app"
                  className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40 lg:min-w-[190px]"
                  type="button"
                >
                  ← Volver al dashboard
                </Link>
                <button
                  onClick={() => void regenerateWeek()}
                  className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40 lg:min-w-[190px]"
                  type="button"
                >
                  <RefreshCw size={14} className="mr-1 inline" /> Regenerar menú
                </button>
                <button
                  onClick={exportPlan}
                  className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40 lg:min-w-[190px]"
                  type="button"
                >
                  <Download size={14} className="mr-1 inline" /> Exportar PDF
                </button>
                <button
                  onClick={() => void sharePlan()}
                  className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40 lg:min-w-[190px]"
                  type="button"
                >
                  <Share2 size={14} className="mr-1 inline" /> Compartir menú
                </button>
              </div>
            </div>
          </motion.section>

          <form
            onSubmit={onSubmit}
            className="mt-4 grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_390px]"
          >
            <section className="space-y-4">
              <div className="grid gap-3 rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                <ToolbarSegment
                  label="Periodo"
                  options={PERIOD_OPTIONS.map((option) => ({
                    value: option.key,
                    label: option.label,
                  }))}
                  value={period}
                  onChange={(value) => setPeriod(value as PlannerPeriod)}
                />
                <ToolbarSegment
                  label="Modo"
                  options={MODE_OPTIONS.map((option) => ({
                    value: option.key,
                    label: option.label,
                  }))}
                  value={mode}
                  onChange={(value) => setMode(value as PlannerMode)}
                />
                <ToolbarSegment
                  label="Intensidad de fusión"
                  options={[
                    { value: 'sutil', label: 'Sutil' },
                    { value: 'media', label: 'Media' },
                    { value: 'alta', label: 'Alta' },
                  ]}
                  value={fusionIntensity}
                  onChange={(value) => {
                    setIntensityAuto(false);
                    setFusionIntensity(value as FusionIntensity);
                  }}
                />
                <div className="flex flex-col items-start gap-2 rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[#6B5A50]">
                    Preset automático por objetivo:{' '}
                    <span className="font-semibold text-[#241A14]">{goal}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIntensityAuto(true);
                      setFusionIntensity(GOAL_TO_INTENSITY[goal] ?? 'media');
                    }}
                    className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#A55412] hover:border-[#C56A1A]/40"
                  >
                    Auto
                  </button>
                </div>
              </div>

              <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-[#6D4AFF]" />
                  <h2 className="text-lg font-semibold">Configuración inteligente</h2>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                    Cocina base
                    <select
                      value={baseCuisine}
                      onChange={(e) => setBaseCuisine(e.target.value)}
                      className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none"
                    >
                      {CUISINES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                    <p>Fusión culinaria</p>
                    <div className="flex flex-wrap gap-2 rounded-xl border border-[#E8DDD2] bg-white p-2">
                      {CUISINES.filter((value) => value !== baseCuisine).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => toggleFusionCuisine(value)}
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${fusionCuisines.includes(value) ? 'border-[#6D4AFF]/45 bg-[#6D4AFF]/10 text-[#6D4AFF]' : 'border-[#E8DDD2] text-[#6B5A50]'}`}
                        >
                          {CUISINE_FLAGS[value] ?? '🍽️'} {value}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-normal text-[#8C7A6D]">
                      Adapta recetas usando sabores, ingredientes y tradiciones de otra cultura
                      culinaria.
                    </p>
                  </div>

                  <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                    Objetivo culinario
                    <select
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none"
                    >
                      {GOALS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                    Personas del menú
                    <input
                      value={peopleCount}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        setPeopleCount(Number.isFinite(parsed) ? parsed : 4);
                      }}
                      type="number"
                      min={1}
                      max={50}
                      className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none"
                    />
                    <span className="text-xs font-normal text-[#8C7A6D]">
                      Si queda vacío o inválido, se usa 4 por defecto.
                    </span>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                    Nivel culinario
                    <select
                      value={culinaryProfile.level ?? ''}
                      onChange={(e) =>
                        setCulinaryProfile((prev) => ({ ...prev, level: e.target.value || null }))
                      }
                      className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none"
                    >
                      <option value="">Sin preferencia</option>
                      <option value="Principiante">Principiante</option>
                      <option value="Intermedio">Intermedio</option>
                      <option value="Chef">Chef</option>
                    </select>
                  </label>
                </div>

                <div className="mt-4">
                  <p className="text-sm font-semibold text-[#6B5A50]">Restricciones</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {RESTRICTIONS.map((restriction) => (
                      <button
                        key={restriction}
                        type="button"
                        onClick={() => toggleRestriction(restriction)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedRestrictions.includes(restriction) ? 'border-red-300 bg-red-50 text-red-700' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
                      >
                        {restriction}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-[#E8DDD2] bg-[#faf2e9] p-3">
                  <p className="text-sm font-semibold">Perfil culinario aplicado</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {filteredProfileBadges.length > 0 ? (
                      filteredProfileBadges.map((item) => (
                        <span
                          key={item}
                          className="rounded-full border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs text-[#6B5A50]"
                        >
                          {item}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-[#6B5A50]">Sin perfil activo todavía.</span>
                    )}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-[#E8DDD2] bg-white p-3">
                  <p className="text-sm font-semibold text-[#241A14]">Fusión activa</p>
                  <p className="mt-1 text-sm text-[#6B5A50]">
                    {CUISINE_FLAGS[baseCuisine] ?? '🍽️'} {baseCuisine}
                    {fusionCuisines.length > 0 ? (
                      <>
                        {' '}
                        +{' '}
                        {fusionCuisines
                          .map((fusion) => `${CUISINE_FLAGS[fusion] ?? '🍽️'} ${fusion}`)
                          .join(' + ')}
                      </>
                    ) : (
                      ' (sin fusión)'
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[#8C7A6D]">
                    Resultado: cocina {baseCuisine.toLowerCase()}
                    {fusionCuisines.length > 0
                      ? ` fusionada con ${fusionCuisines.join(' y ').toLowerCase()}`
                      : ''}
                    .
                  </p>
                  <p className="mt-1 text-xs text-[#8C7A6D]">
                    Intensidad aplicada:{' '}
                    <span className="font-semibold text-[#241A14]">{fusionIntensity}</span>
                  </p>
                </div>

                <div className="mt-3 rounded-xl border border-[#E8DDD2] bg-white p-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-[#241A14]">
                    <input
                      type="checkbox"
                      checked={usePdfContext}
                      onChange={(event) => setUsePdfContext(event.target.checked)}
                      className="h-4 w-4 rounded border-[#E8DDD2]"
                    />
                    Usar contexto de biblioteca PDF
                  </label>
                  <p className="mt-1 text-xs text-[#8C7A6D]">
                    Si está activo, el planificador busca primero contexto relevante en tus
                    PDFs/globales y luego genera el menú con IA.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={loading || loadingInventory}
                  className="mt-4 h-12 w-full rounded-xl bg-[#C56A1A] px-4 text-base font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60"
                >
                  {loading ? 'Generando planificación...' : 'Generar planificación inteligente'}
                </button>
              </article>

              <section className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold">Calendario de menú</h2>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:flex sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => void regenerateWeek()}
                      disabled={!hasActiveMenu}
                      className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#6B5A50] disabled:opacity-50"
                    >
                      Regenerar semana
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateInventorySuggestion()}
                      disabled={!hasActiveMenu}
                      className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#6B5A50] disabled:opacity-50"
                    >
                      Generar inventario
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSavedPlan()}
                      disabled={!hasSavedPlan}
                      className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#6B5A50] disabled:opacity-50"
                    >
                      Borrar guardado
                    </button>
                  </div>
                </div>
                {hasActiveMenu ? (
                  <div className="mb-3 rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-2">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-semibold text-[#241A14]">
                        Recetas generadas: {recipeWarmupProgress.readySlots}/
                        {recipeWarmupProgress.totalSlots}
                      </p>
                      <p className="text-xs text-[#6B5A50]">
                        {recipeWarmupProgress.readySlots === 0
                          ? 'On-demand activo · ninguna receta abierta todavía'
                          : recipeWarmupProgress.isPartial
                            ? `On-demand parcial · ${recipeWarmupProgress.percent}% disponibles`
                            : 'Todas las recetas ya están disponibles'}
                      </p>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#C56A1A] to-[#6D4AFF] transition-all"
                        style={{ width: `${recipeWarmupProgress.percent}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                {hasActiveMenu ? (
                  renderPeriodView()
                ) : (
                  <div className="rounded-xl border border-dashed border-[#E8DDD2] bg-[#FAF6F1] p-4 text-sm text-[#6B5A50]">
                    No hay un menú generado todavía. Completá la configuración y usá{' '}
                    <span className="font-semibold text-[#241A14]">
                      “Generar planificación inteligente”
                    </span>
                    .
                  </div>
                )}
              </section>

              {hasActiveMenu && ENABLE_HOME_INTELLIGENCE_DASHBOARD ? (
                <HomeIntelligenceDashboard
                  weeklyCoverage={mealSimulation.weeklyCoverage}
                  criticalCount={mealSimulation.criticalIngredients.length}
                  reusedCount={mealSimulation.reusedIngredients.length}
                  projectedCost={smartShoppingList.estimatedCostTotal}
                  criticalIngredients={mealSimulation.criticalIngredients}
                  reusedIngredients={mealSimulation.reusedIngredients}
                />
              ) : hasActiveMenu ? (
                <div className="relative">
                  <div className="pointer-events-none opacity-45 grayscale">
                    <HomeIntelligenceDashboard
                      weeklyCoverage={mealSimulation.weeklyCoverage}
                      criticalCount={mealSimulation.criticalIngredients.length}
                      reusedCount={mealSimulation.reusedIngredients.length}
                      projectedCost={smartShoppingList.estimatedCostTotal}
                      criticalIngredients={mealSimulation.criticalIngredients}
                      reusedIngredients={mealSimulation.reusedIngredients}
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-0 rounded-2xl border border-dashed border-[#C56A1A]/40 bg-[#FAF6F1]/40" />
                  <div className="pointer-events-none absolute right-3 top-3 rounded-full border border-[#C56A1A]/30 bg-[#C56A1A]/10 px-2 py-0.5 text-[10px] font-semibold text-[#A55412]">
                    Pausado temporalmente
                  </div>
                </div>
              ) : null}
              {hasActiveMenu ? (
                <DailyKitchenCard
                  dayState={mealSimulation.dayStates[simulatedDayIndex] ?? null}
                  message={mealSimulation.dailyKitchenMessage}
                />
              ) : null}
              {!isRestaurantMode ? (
                <>
                  <MenuHealthCard
                    coveredMessage={menuHealthSummary.coveredMessage}
                    lowIngredientsCount={menuHealthSummary.lowIngredientsCount}
                    shoppingItemsCount={menuHealthSummary.shoppingItemsCount}
                    estimatedCost={menuHealthSummary.estimatedCost}
                    onViewDetails={() => setShowSimulationDetails((prev) => !prev)}
                  />
                  {showSimulationDetails ? (
                    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold text-[#241A14]">
                          Detalle de simulación operativa
                        </h3>
                        <button
                          type="button"
                          onClick={() => setShowSimulationDetails(false)}
                          className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                        >
                          Cerrar
                        </button>
                      </div>
                      <div className="space-y-4">
                        <InventoryDepletionPreview items={inventoryProjection.items} />
                        <InventoryPlaybackCard
                          dayStates={mealSimulation.dayStates}
                          selectedDayIndex={simulatedDayIndex}
                        />
                        <SmartPredictionCard predictions={mealSimulation.predictions} />
                      </div>
                    </article>
                  ) : null}
                </>
              ) : (
                <>
                  <InventoryDepletionPreview items={inventoryProjection.items} />
                  <InventoryPlaybackCard
                    dayStates={mealSimulation.dayStates}
                    selectedDayIndex={simulatedDayIndex}
                  />
                  <SmartPredictionCard predictions={mealSimulation.predictions} />
                </>
              )}
              {isRestaurantMode ? (
                <AdvancedTimelineSection
                  open={showAdvancedTimeline}
                  onToggle={() => setShowAdvancedTimeline((prev) => !prev)}
                >
                  <EditableMealTimeline
                    days={simulationCalendar}
                    lockedMeals={lockedMeals}
                    onToggleLock={toggleLockedMeal}
                    onMoveDay={moveMealAcrossDay}
                    onMoveMealSlot={moveMealAcrossSlot}
                    selectedDayIndex={simulatedDayIndex}
                    onSimulateDay={setSimulatedDayIndex}
                  />
                </AdvancedTimelineSection>
              ) : null}
              {isRestaurantMode ? (
                <SimulationControls
                  onReset={resetSimulation}
                  onApply={applySimulationToMenu}
                  hasChanges={hasSimulationChanges}
                />
              ) : null}
              {isRestaurantMode ? (
                <>
                  <IngredientConstraintCard
                    options={inventoryProjection.items.map((item) => item.ingredientName)}
                    selected={ingredientConstraints}
                    onToggle={toggleIngredientConstraint}
                  />
                  <SmartOptimizationPanel
                    activeMode={activeOptimizationMode}
                    onOptimize={applyOptimization}
                  />
                  <OptimizationScoreCard score={optimizationScore} />
                  <BeforeAfterComparisonCard comparison={optimizationComparison} />
                  <AIOptimizationInsights notes={optimizationNotes} />
                </>
              ) : null}
              {isRestaurantMode ? (
                <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                  <div className="flex items-center gap-2">
                    <History size={16} className="text-[#6D4AFF]" />
                    <h3 className="text-lg font-semibold">Historial de optimizaciones</h3>
                  </div>
                  <p className="mt-1 text-sm text-[#6B5A50]">
                    Últimos snapshots guardados para revisar mejoras y restaurar simulaciones
                    temporales.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-[#6B5A50]">
                      Filtrar por modo
                      <select
                        value={historyModeFilter}
                        onChange={(event) =>
                          setHistoryModeFilter(event.target.value as OptimizationMode | 'all')
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-[#E8DDD2] bg-white px-2 text-xs text-[#241A14] outline-none"
                      >
                        <option value="all">Todos</option>
                        <option value="optimize_cost">Optimizar costo</option>
                        <option value="reduce_waste">Optimizar desperdicio</option>
                        <option value="prioritize_fresh">Priorizar frescos</option>
                        <option value="reduce_missing">Reducir faltantes</option>
                        <option value="reuse_proteins">Reutilizar proteínas</option>
                        <option value="balance_ingredients">Balancear ingredientes</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-[#6B5A50]">
                      Filtrar por fecha
                      <select
                        value={historyDateFilter}
                        onChange={(event) =>
                          setHistoryDateFilter(event.target.value as 'all' | '7d' | '30d' | '90d')
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-[#E8DDD2] bg-white px-2 text-xs text-[#241A14] outline-none"
                      >
                        <option value="all">Todo el historial</option>
                        <option value="7d">Últimos 7 días</option>
                        <option value="30d">Últimos 30 días</option>
                        <option value="90d">Últimos 90 días</option>
                      </select>
                    </label>
                  </div>
                  {filteredOptimizationHistory.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-[#E8DDD2] bg-[#FAF6F1] px-3 py-4 text-sm text-[#6B5A50]">
                      No hay snapshots para el filtro seleccionado. Probá otro modo/fecha o ejecutá
                      una optimización nueva.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {visibleOptimizationHistory.map((snapshot) => {
                        const improvement =
                          snapshot.optimizedScore.total - snapshot.baselineScore.total;
                        const expanded = expandedSnapshotId === snapshot.id;
                        return (
                          <section
                            key={snapshot.id}
                            className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] p-3"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-[#241A14]">
                                  {modeLabel(snapshot.mode)}
                                </p>
                                <p className="text-xs text-[#6B5A50]">
                                  {new Date(snapshot.createdAt).toLocaleString('es-AR')}
                                </p>
                              </div>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                                  improvement >= 0
                                    ? 'border-[#567A3B]/40 bg-[#567A3B]/10 text-[#567A3B]'
                                    : 'border-[#B84D4D]/40 bg-[#B84D4D]/10 text-[#B84D4D]'
                                }`}
                              >
                                Mejora total {improvement >= 0 ? '+' : ''}
                                {improvement}
                              </span>
                            </div>

                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              <div className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1.5 text-xs">
                                <p className="text-[#6B5A50]">Score antes</p>
                                <p className="font-semibold text-[#241A14]">
                                  {snapshot.baselineScore.total}
                                </p>
                              </div>
                              <div className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1.5 text-xs">
                                <p className="text-[#6B5A50]">Score después</p>
                                <p className="font-semibold text-[#241A14]">
                                  {snapshot.optimizedScore.total}
                                </p>
                              </div>
                              <div className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1.5 text-xs">
                                <p className="text-[#6B5A50]">Resumen</p>
                                <p className="line-clamp-2 font-semibold text-[#241A14]">
                                  {snapshot.notes[0] ?? 'Sin resumen disponible.'}
                                </p>
                              </div>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedSnapshotId((prev) =>
                                    prev === snapshot.id ? null : snapshot.id
                                  )
                                }
                                className="rounded-lg border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                              >
                                <Eye size={12} className="mr-1 inline" />
                                {expanded ? 'Ocultar detalle' : 'Ver detalle'}
                              </button>
                              <button
                                type="button"
                                onClick={() => restoreSnapshotTemporarily(snapshot)}
                                className="rounded-lg border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#6D4AFF]/40"
                              >
                                <RotateCcw size={12} className="mr-1 inline" />
                                Restaurar simulación
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteOptimizationSnapshot(snapshot.id)}
                                className="rounded-lg border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs font-semibold text-[#B84D4D] hover:border-[#B84D4D]/40"
                              >
                                <Trash2 size={12} className="mr-1 inline" />
                                Eliminar
                              </button>
                              <button
                                type="button"
                                onClick={() => exportOptimizationSnapshot(snapshot)}
                                className="rounded-lg border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#6D4AFF]/40"
                              >
                                <Download size={12} className="mr-1 inline" />
                                Exportar
                              </button>
                            </div>

                            {expanded ? (
                              <div className="mt-2 rounded-lg border border-[#E8DDD2] bg-white px-3 py-2 text-xs text-[#6B5A50]">
                                <p className="font-semibold text-[#241A14]">
                                  Explicación principal
                                </p>
                                <ul className="mt-1 list-disc space-y-1 pl-4">
                                  {snapshot.notes.slice(0, 3).map((note) => (
                                    <li key={note} className="break-words">
                                      {note}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                      {hasMoreHistory ? (
                        <button
                          type="button"
                          onClick={() => setHistoryPage((prev) => prev + 1)}
                          className="w-full rounded-lg border border-[#E8DDD2] bg-white px-3 py-2 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                        >
                          Ver más historial
                        </button>
                      ) : null}
                    </div>
                  )}
                </article>
              ) : null}
              {isRestaurantMode ? <ReorderSuggestionCard suggestions={reorderSuggestions} /> : null}

              {result ? (
                <section className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">Plan culinario generado</h3>
                      <p className="text-xs text-[#6B5A50]">
                        Vista editorial del menú para {peopleCount || 4} personas.
                      </p>
                    </div>
                    {usePdfContext ? (
                      <span className="rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-2 py-0.5 text-[10px] font-semibold text-[#6D4AFF]">
                        Contexto PDF: {pdfContextCount}
                      </span>
                    ) : null}
                  </div>

                  {narrativeSections.length > 0 ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {narrativeSections.map((section) => (
                        <article
                          key={section.day}
                          className="rounded-xl border border-[#E8DDD2] bg-white/85 p-3"
                        >
                          <p className="text-sm font-semibold text-[#241A14]">{section.day}</p>
                          <ul className="mt-2 space-y-2">
                            {section.meals.map((meal) => (
                              <li
                                key={`${section.day}-${meal.meal}-${meal.text.slice(0, 16)}`}
                                className="rounded-lg border border-[#E8DDD2] bg-[#FAF6F1] p-2"
                              >
                                <p className="text-xs font-semibold text-[#6B5A50]">{meal.meal}</p>
                                <p className="mt-1 text-sm text-[#241A14]">{meal.text}</p>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-[#E8DDD2] bg-white/85 p-3 text-sm text-[#3d312a]">
                      {result}
                    </pre>
                  )}
                </section>
              ) : null}
            </section>

            <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
              {!hasActiveMenu ? (
                <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-4 xl:p-5">
                  <h3 className="text-lg font-semibold text-[#241A14]">Tu cocina está lista</h3>
                  <p className="mt-2 text-sm text-[#6B5A50]">
                    Cuando generes un menú, acá vas a ver la lista de compras, inventario proyectado
                    y acciones rápidas.
                  </p>
                  <Link
                    href="/app"
                    className="mt-4 inline-flex rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50]"
                  >
                    Volver al dashboard
                  </Link>
                </article>
              ) : (
                <>
                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ShoppingCart size={16} className="text-[#567A3B]" />
                        <h3 className="text-lg font-semibold">Lista inteligente de compras</h3>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <div className="inline-flex rounded-lg border border-[#E8DDD2] bg-white p-0.5">
                          <button
                            type="button"
                            onClick={() => setShoppingShareFormat('short')}
                            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                              shoppingShareFormat === 'short'
                                ? 'bg-[#16110D] text-white'
                                : 'text-[#6B5A50]'
                            }`}
                          >
                            Corto
                          </button>
                          <button
                            type="button"
                            onClick={() => setShoppingShareFormat('detailed')}
                            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                              shoppingShareFormat === 'detailed'
                                ? 'bg-[#16110D] text-white'
                                : 'text-[#6B5A50]'
                            }`}
                          >
                            Detallado
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyShoppingList()}
                          className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                        >
                          <span className="inline-flex items-center gap-1">
                            <ClipboardCopy size={14} /> Copiar
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={shareShoppingToWhatsapp}
                          className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                        >
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle size={14} /> WhatsApp
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShoppingCollapsed((prev) => !prev)}
                          className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                        >
                          {shoppingCollapsed ? (
                            <span className="inline-flex items-center gap-1">
                              <ChevronDown size={14} /> Expandir
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <ChevronUp size={14} /> Colapsar
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                    {!shoppingCollapsed ? (
                      <div className="mt-3 space-y-2">
                        <SmartShoppingSection
                          shopping={smartShoppingList}
                          onApplyShoppingItem={applyShoppingItemToInventory}
                          applyingItemKey={applyingShoppingItemKey}
                        />
                        {shoppingApplySummary ? (
                          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                            {shoppingApplySummary}
                          </p>
                        ) : null}
                        {shoppingApplyStage ? (
                          <p className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-xs text-[#6B5A50]">
                            Estado: {shoppingApplyStage}
                          </p>
                        ) : null}
                        {shoppingShareFeedback ? (
                          <p className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-xs text-[#6B5A50]">
                            {shoppingShareFeedback}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>

                  <SupermarketModeCard
                    estimatedCost={supermarketMetrics.estimatedCost}
                    missingCount={supermarketMetrics.missingCount}
                    reusedCount={supermarketMetrics.reusedCount}
                    reviewCount={supermarketMetrics.reviewCount}
                  />

                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <h3 className="text-lg font-semibold">Resumen de inventario proyectado</h3>
                    <p className="mt-1 text-sm text-[#6B5A50]">
                      Proyección de consumo para este menú (sin descontar stock real).
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
                      <SummaryBadge
                        label="Suficientes"
                        value={inventoryProjection.summary.sufficient}
                        tone="success"
                      />
                      <SummaryBadge
                        label="Faltantes"
                        value={inventoryProjection.summary.missing}
                        tone="danger"
                      />
                      <SummaryBadge
                        label="Parciales"
                        value={inventoryProjection.summary.partial}
                        tone="warning"
                      />
                      <SummaryBadge
                        label="A revisar"
                        value={inventoryProjection.summary.unknown}
                        tone="neutral"
                      />
                    </div>
                    <p className="mt-3 rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 text-xs text-[#6B5A50]">
                      Costo estimado:{' '}
                      <span className="font-semibold text-[#241A14]">
                        ~${inventoryProjection.summary.estimatedCost.toFixed(2)}
                      </span>
                    </p>
                  </article>

                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-lg font-semibold">Inventario sugerido del menú</h3>
                      <span className="rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-2 py-0.5 text-[10px] font-semibold text-[#6D4AFF]">
                        {peopleCount || 4} personas
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#6B5A50]">
                      Lista separada del inventario real, consolidada por equivalencias.
                    </p>
                    {inventorySuggestionUpdatedAt ? (
                      <p className="mt-1 text-[11px] text-[#8C7A6D]">
                        Actualizado: {new Date(inventorySuggestionUpdatedAt).toLocaleString()}
                      </p>
                    ) : null}
                    <ul className="mt-3 space-y-2.5">
                      {inventorySuggestion.map((item) => (
                        <li
                          key={item.canonical_name}
                          className="rounded-xl border border-[#E8DDD2] bg-white/75 p-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-[#241A14]">{item.canonical_name}</p>
                            <p className="text-xs text-[#6B5A50]">
                              {item.quantity === null
                                ? 'Cantidad estimada sin número'
                                : `${item.quantity} ${item.unit}`}
                            </p>
                          </div>
                          <p className="text-[11px] text-[#6B5A50]">
                            Nombre receta: {item.display_name}
                            {item.display_name.toLowerCase() !== item.canonical_name.toLowerCase()
                              ? ` · Equivalencia aplicada a "${item.canonical_name}"`
                              : ''}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.estimated ? (
                              <span className="rounded-full border border-[#C56A1A]/35 bg-[#C56A1A]/10 px-2 py-0.5 text-[10px] font-semibold text-[#A55412]">
                                Estimado IA ({Math.round(item.confidence * 100)}%)
                              </span>
                            ) : (
                              <span className="rounded-full border border-[#567A3B]/35 bg-[#567A3B]/10 px-2 py-0.5 text-[10px] font-semibold text-[#567A3B]">
                                Cantidad definida
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                      {inventorySuggestion.length === 0 ? (
                        <li className="rounded-xl border border-[#E8DDD2] bg-white/75 p-2 text-sm text-[#6B5A50]">
                          Todavía no generaste inventario sugerido para este menú.
                        </li>
                      ) : null}
                    </ul>
                  </article>

                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <h3 className="text-lg font-semibold">Comparación con inventario</h3>
                    <p className="mt-1 text-sm text-[#6B5A50]">
                      Estado operativo para ingredientes requeridos por el menú.
                    </p>
                    <ul className="mt-3 space-y-2">
                      {inventoryProjection.items.slice(0, 12).map((item) => (
                        <li
                          key={item.normalizedName}
                          className="rounded-xl border border-[#E8DDD2] bg-white/80 p-2 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-[#241A14]">{item.ingredientName}</p>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                item.status === 'sufficient'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                  : item.status === 'partial'
                                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                                    : item.status === 'missing'
                                      ? 'border-red-300 bg-red-50 text-red-700'
                                      : 'border-[#6B5A50]/30 bg-[#6B5A50]/10 text-[#6B5A50]'
                              }`}
                            >
                              {item.status === 'sufficient'
                                ? 'Disponible'
                                : item.status === 'partial'
                                  ? 'Parcial'
                                  : item.status === 'missing'
                                    ? 'Falta comprar'
                                    : 'No comparable'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-[#6B5A50]">
                            Requerido: {item.requiredTotalQuantity ?? '—'} {item.requiredUnit} ·
                            Disponible: {item.availableQuantity ?? '—'} {item.availableUnit}
                          </p>
                          <p className="mt-1 text-[11px] text-[#8C7A6D]">
                            Uso proyectado: {item.projectedUsedQuantity ?? '—'} {item.requiredUnit}{' '}
                            · Restante: {item.projectedRemainingQuantity ?? '—'} {item.requiredUnit}
                          </p>
                        </li>
                      ))}
                      {inventoryProjection.items.length === 0 ? (
                        <li className="rounded-xl border border-[#E8DDD2] bg-white/80 p-2 text-sm text-[#6B5A50]">
                          Generá inventario sugerido para ver la comparación con tu stock real.
                        </li>
                      ) : null}
                    </ul>
                  </article>

                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <h3 className="text-lg font-semibold">Insights CocinaCore AI</h3>
                    <ul className="mt-3 space-y-2 text-sm">
                      {inventoryInsights.map((insight) => (
                        <li
                          key={insight}
                          className="rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 text-[#6B5A50]"
                        >
                          {insight}
                        </li>
                      ))}
                      {inventoryInsights.length === 0 ? (
                        <li className="rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 text-[#6B5A50]">
                          Generá inventario sugerido para ver recomendaciones de optimización del
                          menú.
                        </li>
                      ) : null}
                    </ul>
                  </article>

                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <div className="flex items-center gap-2">
                      <Wand2 size={16} className="text-[#6D4AFF]" />
                      <h3 className="text-lg font-semibold">IA contextual activa</h3>
                    </div>
                    <p className="mt-2 text-sm text-[#6B5A50]">
                      Este menú fue generado usando tus ingredientes disponibles y preferencias
                      culinarias.
                    </p>
                    <ul className="mt-3 space-y-2 text-sm">
                      {profileFlags.map((flag) => (
                        <li
                          key={flag.label}
                          className="flex items-center justify-between rounded-lg border border-[#E8DDD2] bg-white/70 px-2 py-1.5"
                        >
                          <span>{flag.label}</span>
                          <span
                            className={
                              flag.active
                                ? 'text-[#567A3B] font-semibold'
                                : 'text-[#A55412] font-semibold'
                            }
                          >
                            {flag.active ? '✓ activo' : 'pendiente'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </article>

                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <h3 className="text-lg font-semibold">Atajos del plan</h3>
                    <p className="mt-2 rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2 text-xs text-[#6B5A50]">
                      {selectedMeal
                        ? `Comida seleccionada: ${selectedMeal.day} · ${selectedMeal.mealType}`
                        : 'Seleccioná una comida del calendario para ver su receta o cambiarla.'}
                    </p>
                    <div className="mt-3 grid gap-2">
                      {isRestaurantMode ? (
                        <button
                          type="button"
                          onClick={() => setShowAdvancedTimeline((prev) => !prev)}
                          className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50]"
                        >
                          ⚙️{' '}
                          {showAdvancedTimeline
                            ? 'Ocultar personalización avanzada'
                            : 'Abrir personalización avanzada'}
                        </button>
                      ) : null}
                      <Link
                        href="/app"
                        className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-center text-sm font-semibold text-[#6B5A50]"
                      >
                        Volver al dashboard
                      </Link>
                    </div>
                  </article>

                  <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
                    <h3 className="text-lg font-semibold">Últimos consumos</h3>
                    <p className="mt-1 text-xs text-[#6B5A50]">
                      Trazabilidad de movimientos reales de inventario.
                    </p>
                    {recentMovements.length === 0 ? (
                      <p className="mt-3 rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2 text-xs text-[#6B5A50]">
                        Todavía no hay consumos confirmados.
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-2">
                        {recentMovements.map((movement) => (
                          <li
                            key={movement.id}
                            className="rounded-xl border border-[#E8DDD2] bg-white/75 px-3 py-2"
                          >
                            <p className="text-xs font-semibold text-[#241A14]">
                              {movement.normalized_name} · {movement.quantity} {movement.unit}
                            </p>
                            <p className="mt-1 text-[11px] text-[#6B5A50]">
                              {movement.movement_type} · {movement.source_recipe ?? movement.source}
                            </p>
                            <p className="text-[11px] text-[#8C7A6D]">
                              {new Date(movement.created_at).toLocaleString()}
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                </>
              )}
            </aside>
          </form>

          {error ? (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </section>
      </main>
      <RecipeReplacementModal
        open={Boolean(replacementTarget)}
        day={replacementTarget?.day ?? ''}
        mealType={replacementTarget?.mealType ?? ''}
        alternatives={replacementAlternatives}
        onClose={() => {
          setReplacementTarget(null);
          setReplacementAlternatives([]);
        }}
        onSelectAlternative={replaceMealWithAlternative}
        onRegenerateMeal={regenerateMealSlot}
      />
      {mealDetail.open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/35 md:items-center md:justify-center">
          <div className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl border border-[#E8DDD2] bg-[#FAF6F1] shadow-2xl md:max-h-[80vh] md:max-w-2xl md:rounded-3xl">
            <div className="flex items-start justify-between border-b border-[#E8DDD2] px-4 py-3 md:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6B5A50]">
                  {mealDetail.day} · {mealDetail.mealType}
                </p>
                <h3 className="text-lg font-semibold text-[#241A14]">
                  {mealDetail.card?.name.replace(/\*\*/g, '').trim() ?? 'Preparación'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMealDetail((prev) => ({ ...prev, open: false }))}
                className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-2 text-[#6B5A50] hover:border-[#C56A1A]/40"
                aria-label="Cerrar detalle"
              >
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
              {mealDetail.loading ? (
                <p className="text-sm text-[#6B5A50]">Generando modo de preparación...</p>
              ) : null}
              {mealDetail.error ? (
                <div className="space-y-2">
                  <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {mealDetail.error}
                  </p>
                  {mealDetail.card && mealDetail.error.includes('no tiene preparación guardada') ? (
                    <button
                      type="button"
                      onClick={() =>
                        void generateMealDetailFromAI(
                          mealDetail.day,
                          mealDetail.mealType,
                          mealDetail.card as PlannerMealCard
                        )
                      }
                      className="rounded-lg border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
                    >
                      Generar preparación ahora
                    </button>
                  ) : null}
                </div>
              ) : null}
              {!mealDetail.loading && !mealDetail.error && mealDetail.content ? (
                <div>
                  <div className="mb-3 inline-flex rounded-xl border border-[#E8DDD2] bg-white p-1">
                    {[
                      { key: 'summary', label: 'Resumen' },
                      { key: 'ingredients', label: 'Ingredientes' },
                      { key: 'preparation', label: 'Preparación' },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setMealDetailTab(tab.key as MealDetailTab)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                          mealDetailTab === tab.key
                            ? 'bg-[#16110D] text-[#F5ECE2]'
                            : 'text-[#6B5A50] hover:bg-[#FAF6F1]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {mealDetailTab === 'summary' ? (
                    <div className="space-y-2 text-sm text-[#241A14]">
                      <p>
                        <strong>Receta:</strong> {mealDetail.card?.name.replace(/\*\*/g, '').trim()}
                      </p>
                      <p>
                        <strong>Tiempo:</strong> {mealDetail.card?.time}
                      </p>
                      <p>
                        <strong>Dificultad:</strong> {mealDetail.card?.difficulty}
                      </p>
                      <p>
                        <strong>Fusión:</strong> {mealDetail.card?.fusionTag}
                      </p>
                      <p className="text-[#6B5A50]">
                        Tip: cambiá a “Preparación” para ver el paso a paso completo.
                      </p>
                      <section className="mt-3 rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6B5A50]">
                          Impacto en inventario
                        </p>
                        <ul className="mt-2 space-y-2">
                          {mealConsumptionPreview.items.length === 0 ? (
                            <li className="text-xs text-[#6B5A50]">
                              Sin ingredientes estructurados para consumo real.
                            </li>
                          ) : (
                            mealConsumptionPreview.items.map((item) => (
                              <li
                                key={`${item.normalizedName}-${item.ingredientName}`}
                                className="rounded-lg border border-[#E8DDD2] bg-[#FAF6F1] p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-semibold text-[#241A14]">
                                    {item.ingredientName}
                                  </p>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                      item.status === 'sufficient'
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                        : item.status === 'insufficient'
                                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                                          : 'border-[#6B5A50]/30 bg-[#6B5A50]/10 text-[#6B5A50]'
                                    }`}
                                  >
                                    {item.status === 'sufficient'
                                      ? 'Listo'
                                      : item.status === 'insufficient'
                                        ? 'No alcanza'
                                        : 'Revisar'}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-[#6B5A50]">
                                  Requerido: {item.requiredQuantity ?? '—'}{' '}
                                  {item.requiredUnit ?? ''}
                                  {' · '}Disponible: {item.availableQuantity ?? '—'}{' '}
                                  {item.availableUnit ?? ''}
                                  {' · '}Después: {item.afterQuantity ?? '—'} {item.afterUnit ?? ''}
                                </p>
                                {item.reason ? (
                                  <p className="mt-1 text-[11px] text-[#A55412]">{item.reason}</p>
                                ) : null}
                              </li>
                            ))
                          )}
                        </ul>
                        <button
                          type="button"
                          onClick={() => void applyRecipeConsumption()}
                          disabled={consumingRecipe || !mealConsumptionPreview.canApply}
                          className="mt-3 rounded-lg border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {consumingRecipe
                            ? 'Aplicando consumo...'
                            : 'Cocinar receta (aplicar consumo)'}
                        </button>
                      </section>
                    </div>
                  ) : null}

                  {mealDetailTab === 'ingredients' ? (
                    <IngredientsSection content={mealDetail.content} />
                  ) : null}

                  {mealDetailTab === 'preparation' ? (
                    <PreparationSection content={mealDetail.content} />
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function extractSection(content: string, heading: string, fallbackHeading?: string): string {
  const normalized = content.replace(/\r/g, '');
  const headings = [heading, ...(fallbackHeading ? [fallbackHeading] : [])];
  const normalizeHeadingLine = (value: string) =>
    value.replace(/\*\*/g, '').replace(/__/g, '').trim().toLowerCase().replace(/:$/, '');
  const lines = normalized.split('\n');
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const clean = normalizeHeadingLine(lines[i]);
    if (headings.some((h) => clean === h.toLowerCase() || clean.startsWith(h.toLowerCase()))) {
      start = i + 1;
      break;
    }
  }

  if (start < 0) return '';

  const nextHeadingIndex = lines.findIndex((line, idx) => {
    if (idx <= start) return false;
    const clean = normalizeHeadingLine(line);
    return ['fuente', 'preparación', 'preparacion', 'tips', 'ingredientes'].includes(clean);
  });

  const end = nextHeadingIndex > start ? nextHeadingIndex : lines.length;
  return lines.slice(start, end).join('\n').trim();
}

function IngredientsSection(props: { content: string }) {
  const section = extractSection(props.content, 'INGREDIENTES');
  if (!section)
    return <p className="text-sm text-[#6B5A50]">No se detectaron ingredientes estructurados.</p>;
  return <pre className="whitespace-pre-wrap text-sm leading-6 text-[#241A14]">{section}</pre>;
}

function PreparationSection(props: { content: string }) {
  const section = extractSection(props.content, 'PREPARACIÓN', 'PREPARACION');
  if (!section)
    return (
      <pre className="whitespace-pre-wrap text-sm leading-6 text-[#241A14]">{props.content}</pre>
    );
  return <pre className="whitespace-pre-wrap text-sm leading-6 text-[#241A14]">{section}</pre>;
}

function ToolbarSegment(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const { label, value, onChange, options } = props;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-[#6B5A50]">{label}</p>
      <div className="flex flex-wrap gap-1 rounded-xl border border-[#E8DDD2] bg-white p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition md:text-sm ${
              value === option.value
                ? 'bg-[#16110D] text-[#F5ECE2]'
                : 'text-[#6B5A50] hover:bg-[#FAF6F1]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SummaryBadge(props: {
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneClass =
    props.tone === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : props.tone === 'warning'
        ? 'border-amber-300 bg-amber-50 text-amber-700'
        : props.tone === 'danger'
          ? 'border-red-300 bg-red-50 text-red-700'
          : 'border-[#6B5A50]/30 bg-[#6B5A50]/10 text-[#6B5A50]';

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em]">{props.label}</p>
      <p className="mt-1 text-lg font-semibold">{props.value}</p>
    </div>
  );
}

function MealCard(props: {
  day: string;
  mealType: MealType;
  card: PlannerMealCard;
  onViewPreparation: (day: string, mealType: MealType, card: PlannerMealCard) => void;
  onChangeRecipe: (day: string, mealType: MealType) => void;
  onRegenerateMeal: (day: string, mealType: MealType) => void;
  onSelectMeal: (slot: SelectedMealState) => void;
  selected: boolean;
  locked: boolean;
}) {
  const {
    day,
    mealType,
    card,
    onViewPreparation,
    onChangeRecipe,
    onRegenerateMeal,
    onSelectMeal,
    selected,
    locked,
  } = props;
  const emoji = mealType === 'Desayuno' ? '🍳' : mealType === 'Almuerzo' ? '🍝' : '🥗';

  return (
    <article
      className={`rounded-xl border bg-white/90 p-3 transition hover:-translate-y-0.5 hover:shadow-sm ${
        selected ? 'border-[#6D4AFF]/45 ring-1 ring-[#6D4AFF]/35' : 'border-[#E8DDD2]'
      }`}
      onClick={() => onSelectMeal({ day, mealType })}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelectMeal({ day, mealType });
      }}
    >
      <p className="text-xs font-semibold text-[#6B5A50]">
        {emoji} {mealType}
      </p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold text-[#241A14]">{card.name}</p>
      <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-[#6B5A50]">
        <span className="rounded-full border border-[#E8DDD2] px-2 py-0.5">{card.time}</span>
        <span className="rounded-full border border-[#E8DDD2] px-2 py-0.5">{card.difficulty}</span>
        <span className="rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-2 py-0.5 text-[#6D4AFF]">
          {card.badge}
        </span>
        <span className="rounded-full border border-[#C56A1A]/30 bg-[#C56A1A]/10 px-2 py-0.5 text-[#A55412]">
          {card.fusionTag}
        </span>
        {locked ? (
          <span className="rounded-full border border-[#16110D]/20 bg-[#16110D]/10 px-2 py-0.5 text-[#16110D]">
            Bloqueada
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-[#6B5A50]">
        Faltantes: {card.missing} · Score IA: {card.aiScore}%
      </p>
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => onViewPreparation(day, mealType, card)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-[11px] font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
        >
          <Eye size={12} /> Ver receta
        </button>
        <button
          type="button"
          onClick={() => onChangeRecipe(day, mealType)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-[11px] font-semibold text-[#241A14] hover:border-[#6D4AFF]/40"
        >
          <Wand2 size={12} /> Cambiar receta
        </button>
        <button
          type="button"
          onClick={() => onRegenerateMeal(day, mealType)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-[11px] font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
        >
          <RefreshCw size={12} /> Regenerar comida
        </button>
      </div>
    </article>
  );
}
