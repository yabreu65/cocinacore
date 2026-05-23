'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Bot,
  CalendarDays,
  Download,
  Eye,
  Lock,
  RefreshCw,
  Share2,
  ShoppingCart,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

const CUISINES = ['Venezolana', 'Colombiana', 'Latinoamericana', 'Asiática', 'Italiana', 'Mediterránea', 'Mexicana'];
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
const RESTRICTIONS = ['Sin gluten', 'Sin lactosa', 'Keto', 'Frutos secos', 'Mariscos', 'Vegetariano'];

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

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;
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
type MealDetailTab = 'summary' | 'ingredients' | 'preparation';
type ShoppingListEntry = {
  id: string;
  ingredientName: string;
  quantity: string | null;
  status: 'pending' | 'purchased';
};
type SelectedMealState = { day: string; mealType: MealType } | null;

async function readErrorPayload(response: Response, fallback: string): Promise<ErrorPayload> {
  const payload: unknown = await response.json().catch(() => ({ error: fallback }));
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const maybeError = (payload as { error?: unknown }).error;
    return { error: typeof maybeError === 'string' ? maybeError : fallback };
  }
  return { error: fallback };
}

function buildFusionLabel(baseCuisine: string, fusionCuisines: string[]): string {
  if (fusionCuisines.length === 0) return baseCuisine;
  return `${baseCuisine} + ${fusionCuisines.join(' + ')}`;
}

function createDefaultCard(day: string, meal: MealType, fusionLabel: string): PlannerMealCard {
  return {
    name: `${meal} de ${day}`,
    time: meal === 'Desayuno' ? '15 min' : meal === 'Almuerzo' ? '30 min' : '25 min',
    difficulty: 'Fácil',
    badge: 'Usa inventario',
    fusionTag: `Fusión ${fusionLabel}`,
    missing: 0,
    aiScore: 88,
  };
}

function buildDefaultWeek(fusionLabel: string): PlannerDay[] {
  return DAY_NAMES.map((day) => ({
    day,
    meals: {
      Desayuno: createDefaultCard(day, 'Desayuno', fusionLabel),
      Almuerzo: createDefaultCard(day, 'Almuerzo', fusionLabel),
      Cena: createDefaultCard(day, 'Cena', fusionLabel),
    },
  }));
}

function parseMenuToCalendar(content: string, fusionLabel: string): PlannerDay[] {
  const week = buildDefaultWeek(fusionLabel);
  const lines = content
    .split('\n')
    .map((line) => line.trim().replace(/\*\*/g, '').replace(/^[-•]\s*/, ''))
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
    };
  }

  return week;
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
  return `${day}::${mealType}`;
}

export default function MealPlannerPage() {
  const [mode, setMode] = useState<PlannerMode>('balanced_ai');
  const [period, setPeriod] = useState<PlannerPeriod>('week');
  const [baseCuisine, setBaseCuisine] = useState('Latinoamericana');
  const [fusionCuisines, setFusionCuisines] = useState<string[]>([]);
  const [goal, setGoal] = useState('Familiar');
  const [inventory, setInventory] = useState<string[]>([]);
  const [selectedRestrictions, setSelectedRestrictions] = useState<string[]>([]);
  const [fusionIntensity, setFusionIntensity] = useState<FusionIntensity>('media');
  const [intensityAuto, setIntensityAuto] = useState(true);
  const [culinaryProfile, setCulinaryProfile] = useState<{
    preferred: string[];
    avoid: string[];
    goals: string[];
    level: string | null;
  }>({ preferred: [], avoid: [], goals: [], level: null });
  const fusionLabel = useMemo(() => buildFusionLabel(baseCuisine, fusionCuisines), [baseCuisine, fusionCuisines]);
  const [calendarData, setCalendarData] = useState<PlannerDay[]>(() => buildDefaultWeek('Latinoamericana'));
  const [shoppingItems, setShoppingItems] = useState<string[]>([]);
  const [shoppingListEntries, setShoppingListEntries] = useState<ShoppingListEntry[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
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

  useEffect(() => {
    const loadProfileAndInventory = async () => {
      setLoadingInventory(true);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: authData } = await supabase.auth.getUser();
        const authUserId = authData.user?.id ?? null;
        setUserId(authUserId);

        const [{ data: userRow }, { data: invRows }, { data: profileRow }, { data: profileTermRows }, { data: termsRows }, { data: savedPlanRow }, { data: shoppingRows }] = await Promise.all([
          authUserId ? supabase.from('users').select('tenant_id').eq('id', authUserId).maybeSingle() : Promise.resolve({ data: null }),
          supabase.from('recipe_inventory_items').select('ingredient_name').order('created_at', { ascending: false }).limit(200),
          supabase.from('user_culinary_profiles').select('level').maybeSingle(),
          supabase.from('user_culinary_profile_terms').select('preference_type,term_id'),
          supabase.from('culinary_terms').select('id,label').limit(300),
          supabase.from('user_meal_plans').select('*').maybeSingle(),
          supabase.from('shopping_list_items').select('id,ingredient_name,quantity,status').eq('source', 'meal_planner').order('created_at', { ascending: false }).limit(120),
        ]);

        const resolvedTenantId = userRow?.tenant_id ?? null;
        setTenantId(resolvedTenantId);

        const items = (invRows ?? []).map((row) => row.ingredient_name).filter(Boolean);
        setInventory(items);
        setShoppingListEntries(
          (shoppingRows ?? []).map((row) => ({
            id: row.id,
            ingredientName: row.ingredient_name,
            quantity: row.quantity,
            status: row.status,
          }))
        );

        const termById = new Map((termsRows ?? []).map((row) => [row.id, row.label]));
        const mappedRows = (profileTermRows ?? []) as Array<{ preference_type: 'identity' | 'prefer' | 'avoid' | 'goal'; term_id: string }>;
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
          const rawCalendar = savedPlanRow.calendar_payload;
          const savedCalendar = Array.isArray(rawCalendar) ? (rawCalendar as unknown as PlannerDay[]) : null;
          if (savedCalendar && savedCalendar.length > 0) {
            setCalendarData(savedCalendar);
          }
          setResult(savedPlanRow.ai_content ?? '');
          setHasSavedPlan(true);
        } else {
          setHasSavedPlan(false);
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

  const filteredProfileBadges = useMemo(
    () => pick([
      ...culinaryProfile.preferred,
      ...culinaryProfile.goals,
      ...culinaryProfile.avoid.map((item) => `Evitar: ${item}`),
      ...(culinaryProfile.level ? [`Nivel: ${culinaryProfile.level}`] : []),
    ], 8),
    [culinaryProfile],
  );

  const inventorySummary = useMemo(() => pick(inventory, 6), [inventory]);

  const profileFlags = [
    { label: 'Inventario', active: inventory.length > 0 },
    { label: 'Perfil culinario', active: filteredProfileBadges.length > 0 },
    { label: 'Historial', active: true },
    { label: 'Preferencias', active: culinaryProfile.preferred.length > 0 },
    { label: 'Restricciones', active: selectedRestrictions.length > 0 },
    { label: 'Objetivos', active: culinaryProfile.goals.length > 0 || Boolean(goal) },
  ];

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const apiMode: 'inventory_to_menu' | 'menu_to_shopping' =
        mode === 'inventory_to_menu' ? 'inventory_to_menu' : 'menu_to_shopping';
      const apiPeriod: 'week' | 'month' = period === 'month' ? 'month' : 'week';

      const res = await fetch('/api/meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: apiMode,
          period: apiPeriod,
          baseCuisine,
          fusionCuisines,
          fusionIntensity,
          inventory,
          culinaryProfile: {
            preferred: [...culinaryProfile.preferred, goal],
            avoid: selectedRestrictions,
            goals: culinaryProfile.goals,
            level: culinaryProfile.level,
          },
        }),
      });

      if (!res.ok) {
        const payload = await readErrorPayload(res, 'Error generando menú.');
        throw new Error(payload.error ?? 'Error generando menú.');
      }

      const payload = (await res.json()) as { content: string };
      const content = payload.content;
      const parsedCalendar = parseMenuToCalendar(content, fusionLabel);
      const parsedShopping = extractShoppingItems(content);
      setResult(content);
      setCalendarData(parsedCalendar);
      setShoppingItems(parsedShopping);

      if (tenantId && userId) {
        const supabase = getSupabaseBrowserClient();
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

        const { data: shoppingRows } = await supabase
          .from('shopping_list_items')
          .select('id,ingredient_name,quantity,status')
          .eq('source', 'meal_planner')
          .order('created_at', { ascending: false })
          .limit(120);

        setShoppingListEntries(
          (shoppingRows ?? []).map((row) => ({
            id: row.id,
            ingredientName: row.ingredient_name,
            quantity: row.quantity,
            status: row.status,
          }))
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error generando menú.');
    } finally {
      setLoading(false);
    }
  };

  const exportPlan = () => {
    const text = result || calendarData.map((day) => `${day.day}\n- Desayuno: ${day.meals.Desayuno.name}\n- Almuerzo: ${day.meals.Almuerzo.name}\n- Cena: ${day.meals.Cena.name}`).join('\n\n');
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
    const text = result || calendarData.map((day) => `${day.day}: ${day.meals.Desayuno.name} / ${day.meals.Almuerzo.name} / ${day.meals.Cena.name}`).join('\n');
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

  const regenerateDay = async () => {
    if (!selectedMeal) {
      setError('Seleccioná una comida primero para regenerar su día.');
      return;
    }
    const targetDay = selectedMeal.day;
    const lockSet = new Set(lockedMeals);
    setLoading(true);
    setError(null);
    try {
      const updated = calendarData.map((d) => ({ ...d, meals: { ...d.meals } }));
      const day = updated.find((d) => d.day === targetDay);
      if (!day) return;
      for (const mealType of MEALS) {
        if (lockSet.has(mealKey(targetDay, mealType))) continue;
        const baseName = day.meals[mealType].name;
        const response = await fetch('/api/recipe-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredients: [baseName, ...inventory.slice(0, 8)],
            culinaryProfile: {
              level: culinaryProfile.level,
              preferred: culinaryProfile.preferred,
              avoid: selectedRestrictions,
              goals: culinaryProfile.goals,
              identity: [baseCuisine, ...fusionCuisines],
            },
          }),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as { title?: string };
        if (payload.title?.trim()) {
          day.meals[mealType] = { ...day.meals[mealType], name: payload.title.trim(), badge: 'Regenerada' };
        }
      }
      setCalendarData(updated);
      setError(`Día ${targetDay} regenerado.`);
    } finally {
      setLoading(false);
    }
  };

  const changeSelectedRecipe = async () => {
    if (!selectedMeal) {
      setError('Seleccioná una comida para cambiar receta.');
      return;
    }
    const dayName = selectedMeal.day;
    const mealType = selectedMeal.mealType;
    if (lockedMeals.includes(mealKey(dayName, mealType))) {
      setError('Esa receta está bloqueada.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const day = calendarData.find((d) => d.day === dayName);
      if (!day) return;
      const response = await fetch('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients: [day.meals[mealType].name, ...inventory.slice(0, 8)],
          culinaryProfile: {
            level: culinaryProfile.level,
            preferred: culinaryProfile.preferred,
            avoid: selectedRestrictions,
            goals: culinaryProfile.goals,
            identity: [baseCuisine, ...fusionCuisines],
          },
        }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { title?: string };
      if (!payload.title?.trim()) return;
      setCalendarData((prev) =>
        prev.map((d) =>
          d.day !== dayName
            ? d
            : { ...d, meals: { ...d.meals, [mealType]: { ...d.meals[mealType], name: payload.title!.trim(), badge: 'Cambiada' } } }
        )
      );
      setError('Receta cambiada.');
    } finally {
      setLoading(false);
    }
  };

  const toggleLockSelectedRecipe = () => {
    if (!selectedMeal) {
      setError('Seleccioná una comida para bloquear.');
      return;
    }
    const key = mealKey(selectedMeal.day, selectedMeal.mealType);
    setLockedMeals((prev) => (prev.includes(key) ? prev.filter((v) => v !== key) : [...prev, key]));
    setError('Estado de bloqueo actualizado.');
  };

  const toggleShoppingItemStatus = async (entry: ShoppingListEntry) => {
    const nextStatus: ShoppingListEntry['status'] = entry.status === 'pending' ? 'purchased' : 'pending';
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase
      .from('shopping_list_items')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', entry.id);
    if (updateError) {
      setError(`No se pudo actualizar compra: ${updateError.message}`);
      return;
    }
    setShoppingListEntries((prev) => prev.map((item) => (item.id === entry.id ? { ...item, status: nextStatus } : item)));
  };

  const savePlan = async () => {
    if (!tenantId || !userId) {
      setError('No se pudo guardar: falta sesión o tenant.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: upsertError } = await supabase.from('user_meal_plans').upsert(
        {
          tenant_id: tenantId,
          user_id: userId,
          period,
          mode,
          base_cuisine: baseCuisine,
          fusion_cuisines: fusionCuisines,
          fusion_intensity: fusionIntensity,
          goal,
          restrictions: selectedRestrictions,
          inventory_snapshot: inventory,
          calendar_payload: calendarData,
          ai_content: result || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,user_id' }
      );

      if (upsertError) {
        setError(`No se pudo guardar menú: ${upsertError.message}`);
        return;
      }

      setHasSavedPlan(true);
      setError('Menú guardado correctamente. Si guardás otro, reemplaza este.');
    } finally {
      setLoading(false);
    }
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
      const { error: deleteError } = await supabase
        .from('user_meal_plans')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('user_id', userId);

      if (deleteError) {
        setError(`No se pudo borrar menú: ${deleteError.message}`);
        return;
      }
      setHasSavedPlan(false);
      setError('Menú guardado eliminado.');
    } finally {
      setLoading(false);
    }
  };

  const openMealDetail = async (day: string, mealType: MealType, card: PlannerMealCard) => {
    const cleanTitle = card.name.replace(/\*\*/g, '').trim();
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

    try {
      const ingredients = [cleanTitle, ...inventory.slice(0, 8)];
      const response = await fetch('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients,
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
        setMealDetail((prev) => ({ ...prev, loading: false, error: payload.error ?? 'No se pudo cargar la preparación.' }));
        return;
      }

      const payload = (await response.json()) as { recipe?: string };
      const content = payload.recipe?.trim();

      if (!content) {
        setMealDetail((prev) => ({ ...prev, loading: false, error: 'No se encontró preparación para esta receta.' }));
        return;
      }

      setMealDetail((prev) => ({ ...prev, loading: false, content, error: null }));
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Error al cargar preparación.';
      setMealDetail((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const toggleRestriction = (value: string) => {
    setSelectedRestrictions((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const toggleFusionCuisine = (value: string) => {
    setFusionCuisines((prev) => {
      if (prev.includes(value)) return prev.filter((item) => item !== value);
      if (prev.length >= 2) return prev;
      return [...prev, value];
    });
  };

  const renderPeriodView = () => {
    if (period === 'fortnight') {
      return (
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[#6B5A50]">Semana 1</p>
            <CalendarGrid days={calendarData.slice(0, 7)} onViewPreparation={openMealDetail} onSelectMeal={setSelectedMeal} selectedMeal={selectedMeal} lockedMeals={lockedMeals} />
          </section>
          <section className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-sm font-semibold text-[#6B5A50]">Semana 2</p>
            <CalendarGrid days={calendarData.slice(0, 7)} onViewPreparation={openMealDetail} onSelectMeal={setSelectedMeal} selectedMeal={selectedMeal} lockedMeals={lockedMeals} />
          </section>
        </div>
      );
    }

    if (period === 'month') {
      return (
        <section className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
          <p className="text-sm font-semibold text-[#6B5A50]">Vista mensual compacta</p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            {Array.from({ length: 28 }).map((_, idx) => {
              const dayData = calendarData[idx % calendarData.length];
              return (
                <div key={`month-${idx + 1}`} className="rounded-xl border border-[#E8DDD2] bg-white p-2">
                  <p className="text-xs font-semibold text-[#6B5A50]">Día {idx + 1}</p>
                  <p className="mt-1 text-xs text-[#241A14] line-clamp-2">{dayData.meals.Cena.name}</p>
                </div>
              );
            })}
          </div>
        </section>
      );
    }

    return <CalendarGrid days={calendarData} onViewPreparation={openMealDetail} onSelectMeal={setSelectedMeal} selectedMeal={selectedMeal} lockedMeals={lockedMeals} />;
  };

  return (
    <>
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-[1400px]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-[#E8DDD2] bg-white/80 p-6 premium-shadow"
        >
          <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-[#6D4AFF]/10 blur-3xl" />
          <div className="pointer-events-none absolute left-0 top-0 h-40 w-40 rounded-full bg-[#C56A1A]/10 blur-3xl" />

          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#6D4AFF]">
                <Bot size={14} /> AI Culinaria
              </div>
              <h1 className="mt-3 text-4xl font-semibold leading-tight md:text-5xl">
                Planificador culinario inteligente
              </h1>
              <p className="mt-2 max-w-3xl text-[#6B5A50]">
                Organiza comidas semanales, quincenales o mensuales usando IA, inventario y preferencias culinarias.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={() => void regenerateWeek()} className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40" type="button">
                <RefreshCw size={14} className="mr-1 inline" /> Regenerar menú
              </button>
              <button onClick={exportPlan} className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40" type="button">
                <Download size={14} className="mr-1 inline" /> Exportar PDF
              </button>
              <button onClick={() => void sharePlan()} className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40" type="button">
                <Share2 size={14} className="mr-1 inline" /> Compartir menú
              </button>
            </div>
          </div>
        </motion.section>

        <form onSubmit={onSubmit} className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
          <section className="space-y-4">
            <div className="grid gap-3 rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
              <ToolbarSegment
                label="Periodo"
                options={PERIOD_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
                value={period}
                onChange={(value) => setPeriod(value as PlannerPeriod)}
              />
              <ToolbarSegment
                label="Modo"
                options={MODE_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
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
              <div className="flex items-center justify-between rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-xs">
                <span className="text-[#6B5A50]">
                  Preset automático por objetivo: <span className="font-semibold text-[#241A14]">{goal}</span>
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

            <article className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#6D4AFF]" />
                <h2 className="text-lg font-semibold">Configuración inteligente</h2>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                  Cocina base
                  <select value={baseCuisine} onChange={(e) => setBaseCuisine(e.target.value)} className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none">
                    {CUISINES.map((value) => <option key={value} value={value}>{value}</option>)}
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
                    Adapta recetas usando sabores, ingredientes y tradiciones de otra cultura culinaria.
                  </p>
                </div>

                <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                  Objetivo culinario
                  <select value={goal} onChange={(e) => setGoal(e.target.value)} className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none">
                    {GOALS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
                  Nivel culinario
                  <select value={culinaryProfile.level ?? ''} onChange={(e) => setCulinaryProfile((prev) => ({ ...prev, level: e.target.value || null }))} className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none">
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
                  {filteredProfileBadges.length > 0
                    ? filteredProfileBadges.map((item) => (
                        <span key={item} className="rounded-full border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs text-[#6B5A50]">{item}</span>
                      ))
                    : <span className="text-xs text-[#6B5A50]">Sin perfil activo todavía.</span>}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-[#E8DDD2] bg-white p-3">
                <p className="text-sm font-semibold text-[#241A14]">Fusión activa</p>
                <p className="mt-1 text-sm text-[#6B5A50]">
                  {CUISINE_FLAGS[baseCuisine] ?? '🍽️'} {baseCuisine}
                  {fusionCuisines.length > 0 ? (
                    <> + {fusionCuisines.map((fusion) => `${CUISINE_FLAGS[fusion] ?? '🍽️'} ${fusion}`).join(' + ')}</>
                  ) : ' (sin fusión)'}
                </p>
                <p className="mt-1 text-xs text-[#8C7A6D]">
                  Resultado: cocina {baseCuisine.toLowerCase()}
                  {fusionCuisines.length > 0 ? ` fusionada con ${fusionCuisines.join(' y ').toLowerCase()}` : ''}.
                </p>
                <p className="mt-1 text-xs text-[#8C7A6D]">
                  Intensidad aplicada: <span className="font-semibold text-[#241A14]">{fusionIntensity}</span>
                </p>
              </div>

              <button type="submit" disabled={loading || loadingInventory} className="mt-4 h-12 w-full rounded-xl bg-[#C56A1A] px-4 text-base font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60">
                {loading ? 'Generando planificación...' : 'Generar planificación inteligente'}
              </button>
            </article>

            <section className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Calendario de menú</h2>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => void regenerateWeek()} className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#6B5A50]">Regenerar semana</button>
                  <button type="button" onClick={() => void savePlan()} className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#6B5A50]">Guardar menú</button>
                  <button type="button" onClick={() => void deleteSavedPlan()} disabled={!hasSavedPlan} className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#6B5A50] disabled:opacity-50">Borrar guardado</button>
                </div>
              </div>
              {renderPeriodView()}
            </section>

            {result ? (
              <section className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
                <h3 className="text-lg font-semibold">Salida textual IA</h3>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-sm text-[#3d312a]">{result}</pre>
              </section>
            ) : null}
          </section>

          <aside className="space-y-4">
            <article className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
              <div className="flex items-center gap-2">
                <ShoppingCart size={16} className="text-[#567A3B]" />
                <h3 className="text-lg font-semibold">Lista inteligente de compras</h3>
              </div>
              <p className="mt-1 text-sm text-[#6B5A50]">Separada por categorías para ejecución rápida.</p>

              <div className="mt-3 space-y-3 text-sm">
                {['Proteínas', 'Verduras', 'Lácteos', 'Especias', 'Extras'].map((group, idx) => (
                  <div key={group} className="rounded-xl border border-[#E8DDD2] bg-white/70 p-3">
                    <p className="font-semibold text-[#241A14]">{group}</p>
                    <ul className="mt-2 space-y-1 text-[#6B5A50]">
                      {(shoppingListEntries.length > 0
                        ? shoppingListEntries.map((entry) => `${entry.ingredientName}${entry.status === 'purchased' ? '::purchased' : ''}`)
                        : (shoppingItems.length ? shoppingItems : inventorySummary)
                      ).slice(idx, idx + 3).map((item) => {
                        const [name, statusMark] = item.split('::');
                        const entry = shoppingListEntries.find((v) => v.ingredientName === name);
                        const purchased = entry ? entry.status === 'purchased' : statusMark === 'purchased';
                        return (
                        <li key={`${group}-${item}`} className="flex items-center justify-between">
                          <span>{name}</span>
                          <button type="button" onClick={() => entry ? void toggleShoppingItemStatus(entry) : undefined} className="text-xs">
                            {purchased ? '✓ comprado' : '○ comprar'}
                          </button>
                        </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>

              <p className="mt-3 rounded-xl border border-[#567A3B]/30 bg-[#567A3B]/10 p-2 text-xs text-[#567A3B]">
                Ingredientes reutilizados inteligentemente para reducir compras repetidas.
              </p>
            </article>

            <article className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
              <div className="flex items-center gap-2">
                <Wand2 size={16} className="text-[#6D4AFF]" />
                <h3 className="text-lg font-semibold">IA contextual activa</h3>
              </div>
              <p className="mt-2 text-sm text-[#6B5A50]">Este menú fue generado usando tus ingredientes disponibles y preferencias culinarias.</p>
              <ul className="mt-3 space-y-2 text-sm">
                {profileFlags.map((flag) => (
                  <li key={flag.label} className="flex items-center justify-between rounded-lg border border-[#E8DDD2] bg-white/70 px-2 py-1.5">
                    <span>{flag.label}</span>
                    <span className={flag.active ? 'text-[#567A3B] font-semibold' : 'text-[#A55412] font-semibold'}>
                      {flag.active ? '✓ activo' : 'pendiente'}
                    </span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
              <h3 className="text-lg font-semibold">Acciones rápidas</h3>
              <p className="mt-2 rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2 text-xs text-[#6B5A50]">
                {selectedMeal
                  ? `Comida seleccionada: ${selectedMeal.day} · ${selectedMeal.mealType}`
                  : 'Seleccioná una comida del calendario para aplicar acciones.'}
              </p>
              <div className="mt-3 grid gap-2">
                <button type="button" onClick={() => void regenerateDay()} className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50]">Regenerar un día</button>
                <button type="button" onClick={() => void changeSelectedRecipe()} className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50]">Cambiar receta</button>
                <button type="button" onClick={toggleLockSelectedRecipe} className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50]"><Lock size={14} className="mr-1 inline" /> Bloquear receta</button>
                <Link href="/app" className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-center text-sm font-semibold text-[#6B5A50]">Volver al dashboard</Link>
              </div>
            </article>
          </aside>
        </form>

        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      </section>
    </main>
    {mealDetail.open ? (
      <div className="fixed inset-0 z-50 flex items-end bg-black/35 md:items-center md:justify-center">
        <div className="max-h-[88vh] w-full overflow-hidden rounded-t-3xl border border-[#E8DDD2] bg-[#FAF6F1] shadow-2xl md:max-h-[80vh] md:max-w-2xl md:rounded-3xl">
          <div className="flex items-start justify-between border-b border-[#E8DDD2] px-4 py-3 md:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6B5A50]">{mealDetail.day} · {mealDetail.mealType}</p>
              <h3 className="text-lg font-semibold text-[#241A14]">{mealDetail.card?.name.replace(/\*\*/g, '').trim() ?? 'Preparación'}</h3>
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
          <div className="overflow-y-auto px-4 py-4 md:px-6 md:py-5">
            {mealDetail.loading ? <p className="text-sm text-[#6B5A50]">Generando modo de preparación...</p> : null}
            {mealDetail.error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mealDetail.error}</p> : null}
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
                    <p><strong>Receta:</strong> {mealDetail.card?.name.replace(/\*\*/g, '').trim()}</p>
                    <p><strong>Tiempo:</strong> {mealDetail.card?.time}</p>
                    <p><strong>Dificultad:</strong> {mealDetail.card?.difficulty}</p>
                    <p><strong>Fusión:</strong> {mealDetail.card?.fusionTag}</p>
                    <p className="text-[#6B5A50]">Tip: cambiá a “Preparación” para ver el paso a paso completo.</p>
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
  const lines = normalized.split('\n');
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const clean = lines[i].trim().toLowerCase();
    if (headings.some((h) => clean === h.toLowerCase() || clean.startsWith(`${h.toLowerCase()}:`))) {
      start = i + 1;
      break;
    }
  }

  if (start < 0) return '';

  const nextHeadingIndex = lines.findIndex((line, idx) => {
    if (idx <= start) return false;
    const clean = line.trim().toLowerCase();
    return ['fuente', 'preparación', 'preparacion', 'tips', 'ingredientes'].includes(clean.replace(':', ''));
  });

  const end = nextHeadingIndex > start ? nextHeadingIndex : lines.length;
  return lines.slice(start, end).join('\n').trim();
}

function IngredientsSection(props: { content: string }) {
  const section = extractSection(props.content, 'INGREDIENTES');
  if (!section) return <p className="text-sm text-[#6B5A50]">No se detectaron ingredientes estructurados.</p>;
  return <pre className="whitespace-pre-wrap text-sm leading-6 text-[#241A14]">{section}</pre>;
}

function PreparationSection(props: { content: string }) {
  const section = extractSection(props.content, 'PREPARACIÓN', 'PREPARACION');
  if (!section) return <pre className="whitespace-pre-wrap text-sm leading-6 text-[#241A14]">{props.content}</pre>;
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
      <div className="inline-flex rounded-xl border border-[#E8DDD2] bg-white p-1">
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

function MealCard(props: {
  day: string;
  mealType: MealType;
  card: PlannerMealCard;
  onViewPreparation: (day: string, mealType: MealType, card: PlannerMealCard) => void;
  onSelectMeal: (slot: SelectedMealState) => void;
  selected: boolean;
  locked: boolean;
}) {
  const { day, mealType, card, onViewPreparation, onSelectMeal, selected, locked } = props;
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
      <p className="text-xs font-semibold text-[#6B5A50]">{emoji} {mealType}</p>
      <p className="mt-1 line-clamp-2 text-sm font-semibold text-[#241A14]">{card.name}</p>
      <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-[#6B5A50]">
        <span className="rounded-full border border-[#E8DDD2] px-2 py-0.5">{card.time}</span>
        <span className="rounded-full border border-[#E8DDD2] px-2 py-0.5">{card.difficulty}</span>
        <span className="rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-2 py-0.5 text-[#6D4AFF]">{card.badge}</span>
        <span className="rounded-full border border-[#C56A1A]/30 bg-[#C56A1A]/10 px-2 py-0.5 text-[#A55412]">{card.fusionTag}</span>
        {locked ? <span className="rounded-full border border-[#16110D]/20 bg-[#16110D]/10 px-2 py-0.5 text-[#16110D]">Bloqueada</span> : null}
      </div>
      <p className="mt-2 text-[11px] text-[#6B5A50]">Faltantes: {card.missing} · Score IA: {card.aiScore}%</p>
      <button
        type="button"
        onClick={() => onViewPreparation(day, mealType, card)}
        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-[11px] font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
      >
        <Eye size={12} /> Ver preparación
      </button>
    </article>
  );
}

function CalendarGrid(props: {
  days: PlannerDay[];
  onViewPreparation: (day: string, mealType: MealType, card: PlannerMealCard) => void;
  onSelectMeal: (slot: SelectedMealState) => void;
  selectedMeal: SelectedMealState;
  lockedMeals: string[];
}) {
  const { days, onViewPreparation, onSelectMeal, selectedMeal, lockedMeals } = props;
  return (
    <div className="mt-3 grid gap-3 lg:grid-cols-7">
      {days.map((day) => (
        <section key={day.day} className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
          <div className="mb-2 flex items-center gap-1">
            <CalendarDays size={14} className="text-[#C56A1A]" />
            <p className="text-sm font-semibold">{day.day}</p>
          </div>
          <div className="space-y-2">
            {MEALS.map((mealType) => (
              <MealCard
                key={`${day.day}-${mealType}`}
                day={day.day}
                mealType={mealType}
                card={day.meals[mealType]}
                onViewPreparation={onViewPreparation}
                onSelectMeal={onSelectMeal}
                selected={selectedMeal?.day === day.day && selectedMeal?.mealType === mealType}
                locked={lockedMeals.includes(mealKey(day.day, mealType))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
