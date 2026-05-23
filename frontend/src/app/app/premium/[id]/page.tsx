'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  CheckCircle2,
  Clock3,
  Heart,
  ListPlus,
  MapPin,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Utensils,
} from 'lucide-react';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';

type PremiumRecipeRow = Database['public']['Tables']['premium_recipes']['Row'];
type PremiumReviewRow = Database['public']['Tables']['premium_recipe_reviews']['Row'];
type PremiumReportInsert = Database['public']['Tables']['premium_review_reports']['Insert'];
type HistoryRow = Database['public']['Tables']['recipe_ai_history']['Row'];
type InventoryRow = Database['public']['Tables']['recipe_inventory_items']['Row'];
type UserRow = Database['public']['Tables']['users']['Row'];

type RecipeStep = { index: number; text: string };

type RecipeIngredient = {
  name: string;
  quantity: string;
  available: boolean;
};

type PremiumDetailData = {
  userId: string;
  userTenantId: string | null;
  recipe: PremiumRecipeRow;
  history: HistoryRow | null;
  reviews: PremiumReviewRow[];
  inventory: InventoryRow[];
  alreadySaved: boolean;
  profile: {
    level: string | null;
    identity: string[];
    preferred: string[];
    avoid: string[];
    goals: string[];
  };
  similarRecipes: PremiumRecipeRow[];
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function parseIngredients(payload: HistoryRow['recipe_payload'], inventory: InventoryRow[]): RecipeIngredient[] {
  if (!payload || typeof payload !== 'object' || !('ingredients' in payload)) return [];
  const raw = (payload as { ingredients?: unknown }).ingredients;
  if (!Array.isArray(raw)) return [];

  const inventoryNames = inventory.map((item) => normalize(item.ingredient_name));

  return raw
    .map((entry) => (typeof entry === 'string' ? entry : ''))
    .filter((entry) => entry.trim().length > 0)
    .slice(0, 20)
    .map((entry) => {
      const [namePart, ...qtyParts] = entry.split(':');
      const cleanName = namePart.trim();
      const quantity = qtyParts.join(':').trim() || 'Cantidad a gusto';
      const available = inventoryNames.some((item) => normalize(cleanName).includes(item) || item.includes(normalize(cleanName)));
      return {
        name: cleanName,
        quantity,
        available,
      };
    });
}

function parseSteps(payload: HistoryRow['recipe_payload']): RecipeStep[] {
  if (!payload || typeof payload !== 'object' || !('steps' in payload)) return [];
  const raw = (payload as { steps?: unknown }).steps;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
    .slice(0, 12)
    .map((text, index) => ({ index: index + 1, text }));
}

function parseMetaField(payload: HistoryRow['recipe_payload'], field: string): string | null {
  if (!payload || typeof payload !== 'object' || !(field in payload)) return null;
  const value = (payload as Record<string, unknown>)[field];
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean.length > 0 ? clean : null;
}

function difficultyFromScore(score: number): string {
  if (score >= 99) return 'Chef';
  if (score >= 97) return 'Media';
  return 'Fácil';
}

export default function PremiumRecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const recipeId = typeof params?.id === 'string' ? params.id : '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [data, setData] = useState<PremiumDetailData | null>(null);

  const load = useCallback(async () => {
    if (!recipeId) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        setError('Necesitás iniciar sesión para ver esta receta premium.');
        setLoading(false);
        return;
      }

      const userId = authData.user.id;

      const [
        { data: userRow },
        { data: recipeRow, error: recipeError },
        { data: reviewsRows },
        { data: inventoryRows },
        { data: profileRow },
        { data: profileTermRows },
        { data: termRows },
        { data: premiumRows },
        { data: savedRows },
      ] = await Promise.all([
        supabase.from('users').select('id,tenant_id,full_name,onboarding_completed').eq('id', userId).maybeSingle(),
        supabase.from('premium_recipes').select('*').eq('id', recipeId).maybeSingle(),
        supabase.from('premium_recipe_reviews').select('*').eq('premium_recipe_id', recipeId).order('created_at', { ascending: false }),
        supabase.from('recipe_inventory_items').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('user_culinary_profiles').select('*').maybeSingle(),
        supabase.from('user_culinary_profile_terms').select('*'),
        supabase.from('culinary_terms').select('*').limit(400),
        supabase.from('premium_recipes').select('*').eq('status', 'published').order('published_at', { ascending: false }).limit(120),
        supabase.from('saved_premium_recipes').select('premium_recipe_id').eq('premium_recipe_id', recipeId).maybeSingle(),
      ]);

      if (recipeError || !recipeRow) {
        setError('No se encontró la receta premium o no tenés acceso.');
        setLoading(false);
        return;
      }

      const historyResult = await supabase
        .from('recipe_ai_history')
        .select('*')
        .eq('id', recipeRow.source_recipe_history_id)
        .maybeSingle();

      const historyRow = historyResult.data ?? null;

      const mapTerms = new Map<string, string>();
      for (const term of termRows ?? []) mapTerms.set(term.id, term.label);

      const profile = {
        level: profileRow?.level ?? null,
        identity: [] as string[],
        preferred: [] as string[],
        avoid: [] as string[],
        goals: [] as string[],
      };

      for (const row of profileTermRows ?? []) {
        const label = mapTerms.get(row.term_id);
        if (!label) continue;
        if (row.preference_type === 'identity') profile.identity.push(label);
        if (row.preference_type === 'prefer') profile.preferred.push(label);
        if (row.preference_type === 'avoid') profile.avoid.push(label);
        if (row.preference_type === 'goal') profile.goals.push(label);
      }

      const targetNormalized = normalize(historyRow?.recipe_title ?? recipeRow.creator_display_name ?? '');

      const similarRecipes = (premiumRows ?? [])
        .filter((row) => row.id !== recipeRow.id)
        .map((row) => ({ row, key: normalize(row.creator_display_name ?? '') }))
        .map((entry) => {
          const score = targetNormalized.length > 0 && entry.key.length > 0 && (targetNormalized.includes(entry.key) || entry.key.includes(targetNormalized)) ? 2 : 0;
          return { row: entry.row, score };
        })
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.row)
        .slice(0, 6);

      setData({
        userId,
        userTenantId: (userRow as UserRow | null)?.tenant_id ?? null,
        recipe: recipeRow,
        history: historyRow,
        reviews: reviewsRows ?? [],
        inventory: inventoryRows ?? [],
        alreadySaved: Boolean(savedRows?.premium_recipe_id),
        profile,
        similarRecipes,
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Error inesperado cargando la receta premium.');
    } finally {
      setLoading(false);
    }
  }, [recipeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ingredients = useMemo(() => {
    if (!data) return [];
    return parseIngredients(data.history?.recipe_payload ?? null, data.inventory);
  }, [data]);

  const steps = useMemo(() => {
    if (!data) return [];
    return parseSteps(data.history?.recipe_payload ?? null);
  }, [data]);

  const likes = useMemo(() => (data?.reviews ?? []).filter((review) => review.stars >= 4).length, [data]);
  const dislikes = useMemo(() => (data?.reviews ?? []).filter((review) => review.stars <= 2).length, [data]);

  const explanation = useMemo(() => {
    if (!data) return [];
    const reasons: string[] = [];
    if (data.profile.preferred.length > 0) reasons.push(`Coincide con tus preferencias: ${data.profile.preferred.slice(0, 2).join(', ')}`);
    if (ingredients.some((item) => item.available)) reasons.push('Usa ingredientes que ya tenés disponibles en inventario');
    if (data.profile.level) reasons.push(`Encaja con tu nivel culinario: ${data.profile.level}`);
    if (likes > dislikes) reasons.push('Tiene feedback positivo en la comunidad premium');

    return reasons.length > 0 ? reasons : ['Se recomienda por calidad premium y señales positivas recientes.'];
  }, [data, ingredients, likes, dislikes]);

  const cuisineRegion = data?.profile.identity[0] ?? 'Global';
  const baseCulture = data?.profile.identity[0] ?? 'Cocina de autor';
  const fusionCulture = data && data.profile.identity.length > 1 ? data.profile.identity.slice(0, 2).join(' + ') : `${baseCulture} + local`;

  async function vote(stars: 1 | 5): Promise<void> {
    if (!data) return;
    setSaving(true);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error: voteError } = await supabase.from('premium_recipe_reviews').upsert(
      [{ premium_recipe_id: data.recipe.id, user_id: data.userId, stars, comment: null, updated_at: new Date().toISOString() }],
      { onConflict: 'premium_recipe_id,user_id' }
    );

    if (voteError) {
      setMessage(`No se pudo guardar feedback: ${voteError.message}`);
      setSaving(false);
      return;
    }

    setMessage(stars === 5 ? 'Feedback guardado: Me gusta.' : 'Feedback guardado: No me gusta.');
    setSaving(false);
    await load();
  }

  async function saveRecipe(): Promise<void> {
    if (!data || !data.userTenantId) {
      setMessage('No se pudo guardar: falta tenant activo.');
      return;
    }

    if (data.alreadySaved) {
      setMessage('Esta receta ya está guardada en tu colección premium.');
      return;
    }

    setSaving(true);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error: saveError } = await supabase.from('saved_premium_recipes').insert({
      tenant_id: data.userTenantId,
      user_id: data.userId,
      premium_recipe_id: data.recipe.id,
      notes: null,
    });

    if (saveError) {
      setMessage(`No se pudo guardar receta: ${saveError.message}`);
      setSaving(false);
      return;
    }

    setMessage('Receta guardada en tu colección premium.');
    setSaving(false);
    await load();
  }

  async function unsaveRecipe(): Promise<void> {
    if (!data || !data.userTenantId) {
      setMessage('No se pudo quitar: falta tenant activo.');
      return;
    }

    if (!data.alreadySaved) {
      setMessage('La receta no está guardada actualmente.');
      return;
    }

    setSaving(true);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { error: deleteError } = await supabase
      .from('saved_premium_recipes')
      .delete()
      .eq('tenant_id', data.userTenantId)
      .eq('user_id', data.userId)
      .eq('premium_recipe_id', data.recipe.id);

    if (deleteError) {
      setMessage(`No se pudo quitar de guardadas: ${deleteError.message}`);
      setSaving(false);
      return;
    }

    setMessage('Receta quitada de tu colección premium.');
    setSaving(false);
    await load();
  }

  async function addMissingToShoppingList(): Promise<void> {
    if (!data) return;

    if (ingredients.length === 0) {
      setMessage('No hay ingredientes estructurados para enviar a compras.');
      return;
    }

    const missing = ingredients.filter((item) => !item.available);
    if (missing.length === 0) {
      setMessage('No hay faltantes: ya tenés todos los ingredientes principales.');
      return;
    }

    if (!data.userTenantId) {
      setMessage('No se pudo guardar en compras: falta tenant activo.');
      return;
    }

    setSaving(true);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();
    const { data: existingRows } = await supabase
      .from('shopping_list_items')
      .select('ingredient_name,status')
      .eq('status', 'pending');

    const existing = new Set((existingRows ?? []).map((row) => normalize(row.ingredient_name)));

    const rowsToInsert = missing
      .filter((item) => !existing.has(normalize(item.name)))
      .map((item) => ({
        tenant_id: data.userTenantId as string,
        user_id: data.userId,
        source: 'premium_detail',
        premium_recipe_id: data.recipe.id,
        ingredient_name: item.name,
        quantity: item.quantity,
        status: 'pending' as const,
      }));

    if (rowsToInsert.length === 0) {
      setMessage('Los faltantes ya estaban en tu lista de compras.');
      setSaving(false);
      return;
    }

    const { error: insertError } = await supabase.from('shopping_list_items').insert(rowsToInsert);

    if (insertError) {
      setMessage(`No se pudo guardar en compras: ${insertError.message}`);
      setSaving(false);
      return;
    }

    setMessage(`Se agregaron ${rowsToInsert.length} ingredientes faltantes a tu lista de compras.`);
    setSaving(false);
  }

  async function submitReport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!data) return;
    const reason = reportReason.trim();
    if (reason.length < 8) {
      setMessage('El reporte debe tener al menos 8 caracteres.');
      return;
    }

    setSaving(true);
    setMessage(null);

    const payload: PremiumReportInsert = {
      premium_recipe_id: data.recipe.id,
      review_id: null,
      reporter_user_id: data.userId,
      reason,
    };

    const supabase = getSupabaseBrowserClient();
    const { error: reportError } = await supabase.from('premium_review_reports').insert(payload);

    if (reportError) {
      setMessage(`No se pudo enviar el reporte: ${reportError.message}`);
    } else {
      setMessage('Reporte enviado correctamente.');
      setReportReason('');
    }

    setSaving(false);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FAF6F1] p-6 text-[#6B5A50]">
        <p>Cargando receta premium...</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-[#FAF6F1] p-6">
        <Link href="/app/premium" className="text-sm text-[#A55412]">← Volver al Premium Board</Link>
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error ?? 'No se encontró la receta.'}</p>
      </main>
    );
  }

  const recipeTitle = data.history?.recipe_title ?? `Receta premium #${data.recipe.id.slice(0, 8)}`;
  const prepTime = parseMetaField(data.history?.recipe_payload ?? null, 'estimated_time') ?? '30-40 min';
  const origin = parseMetaField(data.history?.recipe_payload ?? null, 'origin') ?? 'Inspiración culinaria premium';
  const fusionApplied = parseMetaField(data.history?.recipe_payload ?? null, 'fusion') ?? fusionCulture;
  const techniques = parseMetaField(data.history?.recipe_payload ?? null, 'techniques') ?? 'Salteado, montaje y equilibrio de sabores';

  return (
    <main className="min-h-screen bg-[#FAF6F1] px-4 pb-12 pt-6 md:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/app/premium" className="inline-flex items-center gap-1 text-sm font-semibold text-[#A55412] hover:text-[#C56A1A]">
          ← Volver al Premium Board
        </Link>

        <section className="overflow-hidden rounded-3xl border border-[#E8DDD2] bg-white/80 premium-shadow">
          <div className="relative h-56 bg-gradient-to-br from-[#16110D] via-[#2A1E18] to-[#6B5A50] md:h-72">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(197,106,26,0.45),_transparent_65%)]" />
            <div className="absolute left-6 top-6 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-white/30 bg-black/30 px-3 py-1 text-white">Premium</span>
              <span className="rounded-full border border-white/30 bg-black/30 px-3 py-1 text-white">Recomendada</span>
              {ingredients.some((item) => item.available) ? (
                <span className="rounded-full border border-white/30 bg-[#567A3B]/70 px-3 py-1 text-white">Usa inventario</span>
              ) : null}
            </div>
            <div className="absolute bottom-5 left-6 right-6">
              <h1 className="text-3xl font-semibold text-white md:text-4xl">{recipeTitle}</h1>
              <p className="mt-2 text-sm text-white/85">{cuisineRegion} · {baseCulture} · Fusión {fusionCulture}</p>
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-4">
            <Badge icon={<Clock3 size={14} />} label={prepTime} />
            <Badge icon={<Utensils size={14} />} label={difficultyFromScore(Number(data.recipe.eligibility_score))} />
            <Badge icon={<Sparkles size={14} />} label={`Score IA ${Number(data.recipe.eligibility_score).toFixed(1)}`} />
            <Badge icon={<Heart size={14} />} label={`${likes} likes · ${dislikes} dislikes`} />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card title="Por qué se recomienda" icon={<Sparkles size={16} />}>
            <ul className="space-y-2 text-sm text-[#6B5A50]">
              {explanation.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 text-[#567A3B]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Contexto culinario" icon={<MapPin size={16} />}>
            <ul className="space-y-2 text-sm text-[#6B5A50]">
              <li><strong className="text-[#241A14]">Origen:</strong> {origin}</li>
              <li><strong className="text-[#241A14]">Cultura base:</strong> {baseCulture}</li>
              <li><strong className="text-[#241A14]">Fusión aplicada:</strong> {fusionApplied}</li>
              <li><strong className="text-[#241A14]">Técnicas:</strong> {techniques}</li>
            </ul>
          </Card>

          <Card title="Acciones" icon={<ShieldCheck size={16} />}>
            <div className="flex flex-wrap gap-2">
              <ActionButton disabled={saving} onClick={() => void vote(5)} icon={<ThumbsUp size={14} />} label="Me gusta" />
              <ActionButton disabled={saving} onClick={() => void vote(1)} icon={<ThumbsDown size={14} />} label="No me gusta" />
              <ActionButton disabled={saving || data.alreadySaved} onClick={() => void saveRecipe()} icon={<Bookmark size={14} />} label={data.alreadySaved ? "Guardada" : "Guardar"} />
              <ActionButton disabled={saving || !data.alreadySaved} onClick={() => void unsaveRecipe()} icon={<Bookmark size={14} />} label="Quitar guardada" />
              <Link href="/meal-planner" className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-3 py-1.5 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40">
                <ListPlus size={14} /> Agregar al menú
              </Link>
              <a href="#similares" className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-3 py-1.5 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40">
                <ArrowUpRight size={14} /> Ver similares
              </a>
            </div>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="Ingredientes inteligentes" icon={<ListPlus size={16} />}>
            {ingredients.length > 0 ? (
              <ul className="space-y-2">
                {ingredients.map((item) => (
                  <li key={`${item.name}-${item.quantity}`} className="flex items-center justify-between rounded-xl border border-[#E8DDD2] bg-white/60 px-3 py-2 text-sm">
                    <span className="text-[#241A14]">{item.name} <span className="text-[#6B5A50]">({item.quantity})</span></span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${item.available ? 'bg-[#567A3B]/15 text-[#567A3B]' : 'bg-[#A55412]/12 text-[#A55412]'}`}>
                      {item.available ? 'Disponible' : 'Falta comprar'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#6B5A50]">Esta receta no expone ingredientes estructurados por RLS/privacidad del origen.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton disabled={saving} onClick={() => void addMissingToShoppingList()} icon={<ListPlus size={14} />} label="Agregar faltantes a compras" />
              <Link href="/meal-planner" className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-3 py-1.5 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40">
                <ArrowUpRight size={14} /> Usar en meal planner
              </Link>
            </div>
          </Card>

          <Card title="Preparación" icon={<Utensils size={16} />}>
            {steps.length > 0 ? (
              <ol className="space-y-2">
                {steps.map((step) => (
                  <li key={step.index} className="rounded-xl border border-[#E8DDD2] bg-white/60 px-3 py-2 text-sm text-[#241A14]">
                    <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#C56A1A]/15 text-xs font-semibold text-[#A55412]">{step.index}</span>
                    {step.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-[#6B5A50]">No hay pasos estructurados visibles en esta receta premium.</p>
            )}
          </Card>
        </section>

        <Card title="Reportar receta" icon={<AlertTriangle size={16} />}>
          <form onSubmit={(event) => void submitReport(event)} className="space-y-3">
            <textarea
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value)}
              placeholder="Contá brevemente por qué querés reportar esta receta."
              className="h-24 w-full rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm text-[#241A14] outline-none focus:border-[#C56A1A]/50"
            />
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-[#C56A1A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#A55412] disabled:opacity-60"
            >
              Enviar reporte
            </button>
          </form>
        </Card>

        <section id="similares" className="space-y-3">
          <h2 className="text-2xl font-semibold text-[#241A14]">Más recetas similares</h2>
          <p className="text-sm text-[#6B5A50]">Basadas en región, cultura, fusión y señales de feedback.</p>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.similarRecipes.length > 0 ? (
              data.similarRecipes.map((recipe) => (
                <Link key={recipe.id} href={`/app/premium/${recipe.id}`} className="rounded-2xl border border-[#E8DDD2] bg-white/75 p-4 premium-shadow hover:border-[#C56A1A]/35">
                  <p className="text-base font-semibold text-[#241A14]">Receta premium</p>
                  <p className="mt-1 text-xs text-[#6B5A50]">Score {Number(recipe.eligibility_score).toFixed(1)} · {difficultyFromScore(Number(recipe.eligibility_score))}</p>
                  <p className="mt-2 text-sm text-[#6B5A50]">Creador: {recipe.creator_display_name ?? 'Miembro premium'}</p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-[#6B5A50]">Aún no hay recetas similares disponibles.</p>
            )}
          </div>
        </section>

        {message ? (
          <p className="rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 text-sm text-[#241A14]">{message}</p>
        ) : null}
      </div>
    </main>
  );
}

function Card(props: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[#241A14]">
        <span className="text-[#6D4AFF]">{props.icon}</span>
        {props.title}
      </h3>
      {props.children}
    </article>
  );
}

function Badge(props: { icon: React.ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-[#E8DDD2] bg-white/75 px-3 py-2 text-sm text-[#241A14]">
      <span className="text-[#6D4AFF]">{props.icon}</span>
      {props.label}
    </div>
  );
}

function ActionButton(props: { disabled?: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-3 py-1.5 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40 disabled:opacity-60"
    >
      {props.icon}
      {props.label}
    </button>
  );
}
