'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  BookHeart,
  CheckCircle2,
  Clock3,
  Flame,
  Heart,
  ListPlus,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  UtensilsCrossed,
} from 'lucide-react';

import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';

type PremiumRecipeRow = Database['public']['Tables']['premium_recipes']['Row'];
type HistoryRow = Database['public']['Tables']['recipe_ai_history']['Row'];
type InventoryRow = Database['public']['Tables']['recipe_inventory_items']['Row'];
type CulinaryProfileRow = Database['public']['Tables']['user_culinary_profiles']['Row'];
type CulinaryProfileTermRow = Database['public']['Tables']['user_culinary_profile_terms']['Row'];

type PremiumCard = {
  id: string;
  title: string;
  creator: string;
  minutes: number;
  difficulty: 'Fácil' | 'Media' | 'Chef';
  region: string;
  culture: string;
  fusion: string;
  aiScore: number;
  likes: number;
  dislikes: number;
  savedCount: number;
  inventoryMatch: number;
  missingIngredients: string[];
  explainWhy: string;
  publishedAt: string | null;
};

type DashboardProfile = {
  level: string | null;
  identity: string[];
  preferred: string[];
  avoid: string[];
  goals: string[];
};

type SavedPremiumRow = Database['public']['Tables']['saved_premium_recipes']['Row'];

type PremiumBoardData = {
  userId: string | null;
  inventory: InventoryRow[];
  profile: DashboardProfile;
  premiumCards: PremiumCard[];
  recentHistory: HistoryRow[];
  savedRecipeIds: string[];
  savedRows: SavedPremiumRow[];
};

const REGION_GROUPS: Record<string, string[]> = {
  Iberoamericana: ['latina', 'mexicana', 'venezolana', 'colombiana', 'latinoamericana'],
  Mediterránea: ['mediterránea', 'italiana', 'griega', 'española'],
  Asiática: ['asiática', 'japonesa', 'coreana', 'china', 'tailandesa'],
  Árabe: ['árabe', 'libanesa', 'turca'],
  Africana: ['africana', 'marroquí', 'etíope'],
};

const RECIPES_PLACEHOLDER = 'Receta premium de comunidad';

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function inferRegion(tags: string[]): string {
  const normalizedTags = tags.map((tag) => normalize(tag));

  for (const [region, keys] of Object.entries(REGION_GROUPS)) {
    const hasRegion = keys.some((key) => normalizedTags.some((tag) => tag.includes(normalize(key))));
    if (hasRegion) return region;
  }

  return 'Global';
}

function toRecipeTitle(source: HistoryRow | null, fallback: string): string {
  const title = source?.recipe_title?.trim();
  if (title && title.length > 0) return title;
  return fallback;
}

function parseDifficulty(eligibilityScore: number): 'Fácil' | 'Media' | 'Chef' {
  if (eligibilityScore >= 99) return 'Chef';
  if (eligibilityScore >= 97) return 'Media';
  return 'Fácil';
}

function scoreRecipe(input: {
  base: PremiumRecipeRow;
  likes: number;
  dislikes: number;
  inventoryMatch: number;
  profileMatch: number;
  freshnessBoost: number;
}): number {
  const { base, likes, dislikes, inventoryMatch, profileMatch, freshnessBoost } = input;
  const quality = Number(base.eligibility_score);
  const engagement = likes * 3 - dislikes * 2;
  const inventoryWeight = inventoryMatch * 4;
  const profileWeight = profileMatch * 3;
  return Math.max(0, Math.min(100, quality + engagement + inventoryWeight + profileWeight + freshnessBoost));
}

function mapProfile(
  profileRow: CulinaryProfileRow | null,
  termRows: CulinaryProfileTermRow[],
  termsMap: Map<string, string>
): DashboardProfile {
  const profile: DashboardProfile = {
    level: profileRow?.level ?? null,
    identity: [],
    preferred: [],
    avoid: [],
    goals: [],
  };

  for (const row of termRows) {
    const termLabel = termsMap.get(row.term_id);
    if (!termLabel) continue;

    if (row.preference_type === 'identity') profile.identity.push(termLabel);
    if (row.preference_type === 'prefer') profile.preferred.push(termLabel);
    if (row.preference_type === 'avoid') profile.avoid.push(termLabel);
    if (row.preference_type === 'goal') profile.goals.push(termLabel);
  }

  return profile;
}

function buildExplainReason(card: PremiumCard, profile: DashboardProfile): string {
  const reasons: string[] = [];

  if (profile.preferred.length > 0) reasons.push(`preferencias como ${profile.preferred.slice(0, 2).join(' y ')}`);
  if (profile.goals.length > 0) reasons.push(`objetivos ${profile.goals.slice(0, 1).join(', ')}`);
  if (card.inventoryMatch > 0) reasons.push('ingredientes que ya tenés en inventario');

  if (reasons.length === 0) {
    return 'Recomendada por calidad premium y feedback positivo de la comunidad.';
  }

  return `Recomendada porque coincide con ${reasons.join(', ')}.`;
}

function parsePayloadIngredients(payload: HistoryRow['recipe_payload']): string[] {
  if (!payload || typeof payload !== 'object') return [];
  if (!('ingredients' in payload)) return [];
  const ingredients = (payload as { ingredients?: unknown }).ingredients;
  if (!Array.isArray(ingredients)) return [];

  return ingredients
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

export default function PremiumBoardIntelligentPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PremiumBoardData>({
    userId: null,
    inventory: [],
    profile: { level: null, identity: [], preferred: [], avoid: [], goals: [] },
    premiumCards: [],
    recentHistory: [],
    savedRecipeIds: [],
    savedRows: [],
  });

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError || !authData.user) {
        setError('Necesitás iniciar sesión para ver el board premium.');
        setLoading(false);
        return;
      }

      const userId = authData.user.id;

      const [
        { data: inventoryRows },
        { data: premiumRows, error: premiumError },
        { data: reviewRows },
        { data: profileRow },
        { data: profileTermRows },
        { data: termRows },
        { data: ownHistoryRows },
        { data: savedRows },
      ] = await Promise.all([
        supabase.from('recipe_inventory_items').select('*').order('created_at', { ascending: false }).limit(80),
        supabase
          .from('premium_recipes')
          .select('*')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(120),
        supabase.from('premium_recipe_reviews').select('*').order('created_at', { ascending: false }).limit(600),
        supabase.from('user_culinary_profiles').select('*').maybeSingle(),
        supabase.from('user_culinary_profile_terms').select('*'),
        supabase.from('culinary_terms').select('*').limit(400),
        supabase
          .from('recipe_ai_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(80),
        supabase.from('saved_premium_recipes').select('*').order('created_at', { ascending: false }).limit(80),
      ]);

      if (premiumError) {
        setError(`No se pudo cargar Premium Board: ${premiumError.message}`);
        setLoading(false);
        return;
      }

      const safeInventory = inventoryRows ?? [];
      const safePremiumRows = premiumRows ?? [];
      const safeReviewRows = reviewRows ?? [];
      const safeProfileTermRows = profileTermRows ?? [];
      const safeTermRows = termRows ?? [];
      const safeHistoryRows = ownHistoryRows ?? [];

      const historyById = new Map<string, HistoryRow>();
      for (const row of safeHistoryRows) historyById.set(row.id, row);

      const termsMap = new Map<string, string>();
      for (const row of safeTermRows) termsMap.set(row.id, row.label);

      const profile = mapProfile(profileRow ?? null, safeProfileTermRows, termsMap);
      const inventoryNames = safeInventory.map((item) => normalize(item.ingredient_name));

      const cards = safePremiumRows.map((row) => {
        const sourceHistory = historyById.get(row.source_recipe_history_id);
        const title = toRecipeTitle(sourceHistory ?? null, RECIPES_PLACEHOLDER);
        const titleNormalized = normalize(title);

        const likes = safeReviewRows.filter((review) => review.premium_recipe_id === row.id && review.stars >= 4).length;
        const dislikes = safeReviewRows.filter((review) => review.premium_recipe_id === row.id && review.stars <= 2).length;
        const savedCount = safeReviewRows.filter((review) => review.premium_recipe_id === row.id).length;

        const payloadIngredients = sourceHistory ? parsePayloadIngredients(sourceHistory.recipe_payload) : [];
        const inventoryMatch = inventoryNames.reduce((acc, ingredient) => {
          if (titleNormalized.includes(ingredient)) return acc + 1;
          if (payloadIngredients.some((entry) => normalize(entry).includes(ingredient))) return acc + 1;
          return acc;
        }, 0);

        const profileTags = [...profile.identity, ...profile.preferred, ...profile.goals];
        const profileMatch = profileTags.reduce((acc, tag) => {
          if (titleNormalized.includes(normalize(tag))) return acc + 1;
          return acc;
        }, 0);

        const publishedTime = row.published_at ? Date.parse(row.published_at) : Date.now();
        const daysSincePublish = Math.max(0, Math.floor((Date.now() - publishedTime) / (1000 * 60 * 60 * 24)));
        const freshnessBoost = daysSincePublish <= 7 ? 4 : daysSincePublish <= 21 ? 2 : 0;

        const region = inferRegion([...profile.identity, ...profile.preferred, title]);
        const culture = profile.identity[0] ?? 'Cocina global';
        const fusion = profile.identity.length >= 2 ? `${profile.identity[0]} + ${profile.identity[1]}` : `${culture} + local`;

        const aiScore = scoreRecipe({
          base: row,
          likes,
          dislikes,
          inventoryMatch,
          profileMatch,
          freshnessBoost,
        });

        const missingIngredients = payloadIngredients
          .filter((entry) => !inventoryNames.some((name) => normalize(entry).includes(name)))
          .slice(0, 4);

        const card: PremiumCard = {
          id: row.id,
          title,
          creator: row.creator_display_name?.trim() || 'Miembro premium',
          minutes: 20 + ((likes + 1) % 4) * 10,
          difficulty: parseDifficulty(Number(row.eligibility_score)),
          region,
          culture,
          fusion,
          aiScore,
          likes,
          dislikes,
          savedCount,
          inventoryMatch,
          missingIngredients,
          explainWhy: '',
          publishedAt: row.published_at,
        };

        card.explainWhy = buildExplainReason(card, profile);
        return card;
      });

      const safeSavedRows = savedRows ?? [];

      setData({
        userId,
        inventory: safeInventory,
        profile,
        premiumCards: cards.sort((a, b) => b.aiScore - a.aiScore),
        recentHistory: safeHistoryRows,
        savedRecipeIds: safeSavedRows.map((row) => row.premium_recipe_id),
        savedRows: safeSavedRows,
      });
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : 'Error inesperado al cargar el board premium.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const topRecipes = useMemo(() => data.premiumCards.slice(0, 8), [data.premiumCards]);

  const savedRecipes = useMemo(() => {
    const saved = new Set(data.savedRecipeIds);
    return data.premiumCards.filter((card) => saved.has(card.id)).slice(0, 12);
  }, [data.premiumCards, data.savedRecipeIds]);

  const recommendedForYou = useMemo(() => {
    return data.premiumCards
      .slice()
      .sort((a, b) => (b.inventoryMatch + b.aiScore) - (a.inventoryMatch + a.aiScore))
      .slice(0, 6);
  }, [data.premiumCards]);

  const byRegion = useMemo(() => {
    const map = new Map<string, PremiumCard[]>();
    for (const card of data.premiumCards) {
      const list = map.get(card.region) ?? [];
      list.push(card);
      map.set(card.region, list);
    }

    return Array.from(map.entries())
      .map(([region, recipes]) => ({ region, recipes: recipes.slice(0, 10) }))
      .sort((a, b) => b.recipes.length - a.recipes.length)
      .slice(0, 5);
  }, [data.premiumCards]);

  const fusionTrending = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const card of data.premiumCards) {
      const current = map.get(card.fusion) ?? { label: card.fusion, count: 0 };
      current.count += 1;
      map.set(card.fusion, current);
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [data.premiumCards]);

  const inventoryDriven = useMemo(() => {
    return data.premiumCards.filter((card) => card.inventoryMatch > 0).slice(0, 6);
  }, [data.premiumCards]);

  const learnByLevel = useMemo(() => {
    if (data.profile.level?.toLowerCase().includes('chef')) {
      return data.premiumCards.filter((card) => card.difficulty === 'Chef').slice(0, 6);
    }
    if (data.profile.level?.toLowerCase().includes('inter')) {
      return data.premiumCards.filter((card) => card.difficulty !== 'Fácil').slice(0, 6);
    }
    return data.premiumCards.filter((card) => card.difficulty === 'Fácil').slice(0, 6);
  }, [data.premiumCards, data.profile.level]);

  async function voteRecipe(recipeId: string, stars: 1 | 5): Promise<void> {
    if (!data.userId) return;
    const supabase = getSupabaseBrowserClient();

    await supabase.from('premium_recipe_reviews').upsert(
      [{ premium_recipe_id: recipeId, user_id: data.userId, stars, comment: null, updated_at: new Date().toISOString() }],
      { onConflict: 'premium_recipe_id,user_id' }
    );

    await loadBoard();
  }

  const profileSummary = [
    data.profile.identity.length > 0 ? `Identidad: ${data.profile.identity.slice(0, 2).join(', ')}` : null,
    data.profile.preferred.length > 0 ? `Preferencias: ${data.profile.preferred.slice(0, 2).join(', ')}` : null,
    data.profile.goals.length > 0 ? `Objetivos: ${data.profile.goals.slice(0, 2).join(', ')}` : null,
    data.profile.level ? `Nivel: ${data.profile.level}` : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <main className="min-h-screen bg-[#FAF6F1] px-4 pb-10 pt-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-[#E8DDD2] bg-white/80 p-6 premium-shadow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6D4AFF]">Premium Board Inteligente</p>
              <h1 className="mt-2 text-3xl font-semibold text-[#241A14] md:text-4xl">Descubrimiento culinario con contexto real</h1>
              <p className="mt-2 max-w-3xl text-[#6B5A50]">
                Recomendaciones construidas con tu perfil culinario, tu inventario, tu feedback y señales reales de la comunidad premium.
              </p>
            </div>
            <Link
              href="/app"
              className="inline-flex items-center gap-1 rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
            >
              Volver al panel <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {profileSummary.length > 0 ? (
              profileSummary.map((item) => (
                <span key={item} className="rounded-full border border-[#E8DDD2] bg-white px-3 py-1 text-xs text-[#6B5A50]">
                  {item}
                </span>
              ))
            ) : (
              <span className="rounded-full border border-[#E8DDD2] bg-white px-3 py-1 text-xs text-[#A55412]">
                Completá tu perfil culinario para recomendaciones más precisas.
              </span>
            )}
          </div>
        </header>

        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[#6D4AFF]"><BookHeart size={18} /></span>
            <h2 className="text-2xl font-semibold text-[#241A14]">Mis recetas premium guardadas</h2>
          </div>
          <p className="text-sm text-[#6B5A50]">Tu colección personal para cocinar después y reutilizar en meal planner.</p>
          {savedRecipes.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {savedRecipes.map((card) => (
                <Link key={card.id} href={`/app/premium/${card.id}`} className="rounded-2xl border border-[#E8DDD2] bg-white/75 p-4 premium-shadow hover:border-[#C56A1A]/35">
                  <p className="text-base font-semibold text-[#241A14] line-clamp-1">{card.title}</p>
                  <p className="mt-1 text-xs text-[#6B5A50]">{card.fusion} · score {card.aiScore.toFixed(0)}</p>
                  <p className="mt-2 text-xs text-[#6B5A50]">Guardada para tu tenant.</p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4 text-sm text-[#6B5A50]">
              Aún no guardaste recetas premium. Abrí una receta y usá el botón Guardar.
            </p>
          )}
        </section>

        <Section
          title="Recomendado para ti"
          subtitle="Se adapta a tu perfil, gustos y señales de uso."
          icon={<Sparkles size={18} />}
          loading={loading}
          emptyMessage="Aún no hay recetas premium publicadas para recomendar."
          cards={recommendedForYou}
          onLike={voteRecipe}
          savedRecipeIds={data.savedRecipeIds}
        />

        <section className="grid gap-4 lg:grid-cols-2">
          <SimplePanel title="Cocina fusión trending" icon={<Flame size={18} />}>
            {fusionTrending.length > 0 ? (
              <ul className="space-y-2">
                {fusionTrending.map((item) => (
                  <li key={item.label} className="flex items-center justify-between rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2">
                    <span className="text-sm font-medium text-[#241A14]">{item.label}</span>
                    <span className="text-xs text-[#6B5A50]">{item.count} recetas</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#6B5A50]">Todavía no hay combinaciones de fusión suficientes para mostrar tendencia.</p>
            )}
          </SimplePanel>

          <SimplePanel title="Estado de personalización" icon={<CheckCircle2 size={18} />}>
            <ul className="space-y-2 text-sm text-[#6B5A50]">
              <li>• Inventario cargado: <strong className="text-[#241A14]">{data.inventory.length} ingredientes</strong></li>
              <li>• Historial propio: <strong className="text-[#241A14]">{data.recentHistory.length} recetas</strong></li>
              <li>• Feedback premium: <strong className="text-[#241A14]">activo en tiempo real</strong></li>
              <li>• Recomendaciones IA explicables: <strong className="text-[#241A14]">habilitadas</strong></li>
            </ul>
          </SimplePanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <SimplePanel title="Según tu inventario" icon={<ListPlus size={18} />}>
            {inventoryDriven.length > 0 ? (
              <MiniRecipeList cards={inventoryDriven} />
            ) : (
              <p className="text-sm text-[#6B5A50]">Agregá ingredientes para activar recomendaciones basadas en lo que ya tenés.</p>
            )}
          </SimplePanel>

          <SimplePanel title="Aprender cocina" icon={<BookHeart size={18} />}>
            {learnByLevel.length > 0 ? (
              <MiniRecipeList cards={learnByLevel} />
            ) : (
              <p className="text-sm text-[#6B5A50]">No hay suficientes recetas para tu nivel aún. Seguimos aprendiendo.</p>
            )}
          </SimplePanel>

          <SimplePanel title="Top recetas premium" icon={<Star size={18} />}>
            {topRecipes.length > 0 ? (
              <MiniRecipeList cards={topRecipes} />
            ) : (
              <p className="text-sm text-[#6B5A50]">Sin ranking todavía: faltan publicaciones premium.</p>
            )}
          </SimplePanel>
        </section>

        {byRegion.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-2xl font-semibold text-[#241A14]">Explorar por región</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {byRegion.map((group) => (
                <SimplePanel key={group.region} title={group.region} icon={<UtensilsCrossed size={18} />}>
                  <MiniRecipeList cards={group.recipes.slice(0, 4)} />
                </SimplePanel>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function Section(props: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  loading: boolean;
  emptyMessage: string;
  cards: PremiumCard[];
  onLike: (recipeId: string, stars: 1 | 5) => Promise<void>;
  savedRecipeIds?: string[];
}) {
  const { title, subtitle, icon, loading, emptyMessage, cards, onLike, savedRecipeIds = [] } = props;
  const savedSet = new Set(savedRecipeIds);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[#6D4AFF]">{icon}</span>
        <h2 className="text-2xl font-semibold text-[#241A14]">{title}</h2>
      </div>
      <p className="text-sm text-[#6B5A50]">{subtitle}</p>

      {loading ? <p className="text-sm text-[#6B5A50]">Cargando recomendaciones…</p> : null}

      {!loading && cards.length === 0 ? <p className="text-sm text-[#6B5A50]">{emptyMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, index) => (
          <motion.article
            key={card.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(0.25, index * 0.04) }}
            className="rounded-3xl border border-[#E8DDD2] bg-white/80 p-4 premium-shadow"
          >
            <div className="relative h-32 overflow-hidden rounded-2xl bg-gradient-to-br from-[#16110D] via-[#2A1E18] to-[#6B5A50]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(197,106,26,0.35),_transparent_60%)]" />
              <div className="absolute bottom-2 left-2 rounded-lg bg-black/30 px-2 py-1 text-xs text-white">{card.region} · {card.fusion}</div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <Link href={`/app/premium/${card.id}`} className="block text-lg font-semibold text-[#241A14] line-clamp-2 hover:text-[#A55412]">{card.title}</Link>
              {savedSet.has(card.id) ? <span className="rounded-full border border-[#E8DDD2] px-2 py-0.5 text-[10px] text-[#567A3B]">Guardada</span> : null}
            </div>
            <p className="text-xs text-[#6B5A50]">Por {card.creator}</p>

            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[#E8DDD2] px-2 py-1 text-[#6B5A50]">{card.minutes} min</span>
              <span className="rounded-full border border-[#E8DDD2] px-2 py-1 text-[#6B5A50]">{card.difficulty}</span>
              <span className="rounded-full border border-[#E8DDD2] px-2 py-1 text-[#6D4AFF]">Score {card.aiScore.toFixed(0)}</span>
            </div>

            <p className="mt-2 text-xs text-[#6B5A50]">{card.explainWhy}</p>

            <div className="mt-2 text-xs text-[#6B5A50]">
              <span className="inline-flex items-center gap-1"><Heart size={12} /> {card.likes}</span>
              <span className="ml-3 inline-flex items-center gap-1"><ThumbsDown size={12} /> {card.dislikes}</span>
              <span className="ml-3 inline-flex items-center gap-1"><Clock3 size={12} /> {card.savedCount} reviews</span>
            </div>

            {card.missingIngredients.length > 0 ? (
              <p className="mt-2 text-xs text-[#A55412]">Faltantes: {card.missingIngredients.join(', ')}</p>
            ) : (
              <p className="mt-2 text-xs text-[#567A3B]">Usa ingredientes disponibles en tu cocina.</p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/app/premium/${card.id}`}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-2.5 py-1 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
              >
                <ArrowUpRight size={12} /> Ver detalle
              </Link>
              <button
                type="button"
                onClick={() => void onLike(card.id, 5)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-2.5 py-1 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
              >
                <ThumbsUp size={12} /> Me gusta
              </button>
              <button
                type="button"
                onClick={() => void onLike(card.id, 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-2.5 py-1 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
              >
                <ThumbsDown size={12} /> No me gusta
              </button>
              <Link
                href="/meal-planner"
                className="inline-flex items-center gap-1 rounded-lg border border-[#E8DDD2] px-2.5 py-1 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
              >
                <ListPlus size={12} /> Agregar al menú
              </Link>
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

function SimplePanel(props: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const { title, icon, children } = props;
  return (
    <article className="rounded-3xl border border-[#E8DDD2] bg-white/80 p-4 premium-shadow">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[#241A14]">
        <span className="text-[#6D4AFF]">{icon}</span>
        {title}
      </h3>
      {children}
    </article>
  );
}

function MiniRecipeList(props: { cards: PremiumCard[] }) {
  return (
    <ul className="space-y-2">
      {props.cards.map((card) => (
        <li key={card.id} className="rounded-xl border border-[#E8DDD2] bg-white/60 p-3">
          <p className="text-sm font-semibold text-[#241A14] line-clamp-1">{card.title}</p>
          <p className="mt-1 text-xs text-[#6B5A50]">{card.fusion} · score {card.aiScore.toFixed(0)}</p>
        </li>
      ))}
    </ul>
  );
}
