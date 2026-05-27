'use client';

import Link from 'next/link';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutGrid,
  Sparkles,
  Package,
  Library,
  CalendarDays,
  Crown,
  User,
  Users,
  CreditCard,
  Search,
  ArrowUpRight,
  Menu,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { humanCopy } from '@/lib/copy';
import type { User as SupabaseUser } from '@supabase/supabase-js';

type DashboardPdfItem = {
  id: string;
  storagePath: string;
  createdAt: string;
  ocrUsed: boolean;
  processingStatus: 'processing' | 'ready' | 'failed';
  processingError: string | null;
};

type DashboardData = {
  userId: string | null;
  fullName: string;
  tenantId: string | null;
  tenantType: 'home' | 'professional';
  trialEndsAt: string | null;
  inventory: Array<{ name: string; quantity: string | null }>;
  recentRecipes: Array<{ title: string; createdAt: string; feedback: 'accepted' | 'discarded' | null }>;
  pdfCount: number;
  latestPdfOcrUsed: boolean;
  latestPdfs: DashboardPdfItem[];
  tenantBooks: Array<{ id: string; title: string }>;
  culinaryProfile: {
    level: string | null;
    identity: string[];
    preferred: string[];
    avoid: string[];
    goals: string[];
  };
  activity: string[];
};

const sidebarItems = [
  { label: 'Inicio', icon: LayoutGrid, active: true, href: '/app', description: 'Vista general con accesos rápidos y actividad reciente.' },
  { label: humanCopy.assistantRecipesNav, icon: Sparkles, href: '/recipes/search', description: 'Genera recetas con ayuda o busca recetas usando tus PDFs.' },
  { label: 'Planificador', icon: CalendarDays, href: '/meal-planner', description: 'Crea menús semanales o mensuales según tu inventario o estilo de cocina.' },
  { label: 'Inventario', icon: Package, href: '/recipes/inventory', description: 'Gestiona tus ingredientes para mejorar recomendaciones y menús.' },
  { label: 'Biblioteca', icon: Library, href: '/library', description: 'Consulta y administra tus libros y recetas en PDF.' },
  { label: 'Tablero Premium', icon: Crown, href: '/app/premium', description: 'Descubrí recetas premium recomendadas con señales inteligentes.' },
  { label: 'Miembros', icon: Users, href: '/members', description: 'Invitá y gestiona miembros de tu tenant con roles y estados.' },
  { label: 'Perfil', icon: User, href: '/profile', description: 'Configura tu cuenta, seguridad y preferencias personales.' },
  { label: 'Facturación', icon: CreditCard, href: '/billing', description: 'Revisa estado de plan, trial y futuras opciones de pago.' },
];

const quickChips = ['Receta rápida', 'Cena familiar', 'Sin gluten', 'Postre', 'Pasta', 'Parrilla'];

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <article className={`rounded-3xl border border-[#E8DDD2] bg-white/75 p-5 premium-shadow ${className}`}>
      {children}
    </article>
  );
}

function daysLeftLabel(iso: string | null): string {
  if (!iso) return 'Trial activo';
  const now = Date.now();
  const end = Date.parse(iso);
  if (Number.isNaN(end)) return 'Trial activo';
  const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return 'Trial vencido';
  return `Te quedan ${diff} días`;
}

function sanitizeFileName(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

type ParsedChunk = { content: string; pageNumber: number };

type PdfPageLike = {
  getViewport: (args: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: Array<{ str?: string } | Record<string, unknown>> }>;
  render: (args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    [key: string]: unknown;
  }) => { promise: Promise<unknown> };
};

async function generateEmbeddingsFromApi(texts: string[]): Promise<number[][]> {
  const response = await fetch('/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: 'Error desconocido.' }))) as { error?: string };
    throw new Error(payload.error ?? 'No se pudieron generar embeddings.');
  }

  const payload = (await response.json()) as { embeddings: number[][] };
  return payload.embeddings;
}

type ErrorPayload = { error?: string };

async function readErrorPayload(response: Response, fallback: string): Promise<ErrorPayload> {
  const payload: unknown = await response.json().catch(() => ({ error: fallback }));
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const maybeError = (payload as { error?: unknown }).error;
    return { error: typeof maybeError === 'string' ? maybeError : fallback };
  }
  return { error: fallback };
}

function getMetadataFullName(user: SupabaseUser): string | null {
  const raw = (user as { user_metadata?: unknown }).user_metadata;
  if (!raw || typeof raw !== 'object' || !('full_name' in raw)) return null;
  const fullName = (raw as { full_name?: unknown }).full_name;
  return typeof fullName === 'string' && fullName.trim().length > 0 ? fullName : null;
}


async function renderPageToPngDataUrl(page: PdfPageLike): Promise<string> {
  const viewport = page.getViewport({ scale: 1.75 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('No se pudo crear contexto de canvas para OCR.');
  }

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png');
}

async function runOcrOnPageImage(dataUrl: string): Promise<string> {
  const { recognize } = await import('tesseract.js');
  const result = await recognize(dataUrl, 'spa+eng');
  return result.data.text?.trim() ?? '';
}

function chunkText(content: string, maxChars = 900, overlap = 120): string[] {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    const slice = normalized.slice(start, end).trim();
    if (slice.length > 40) chunks.push(slice);
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

async function extractPdfChunks(file: File): Promise<{ pageCount: number; chunks: ParsedChunk[]; usedOcr: boolean }> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const chunks: ParsedChunk[] = [];
  let usedOcr = false;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = (await pdf.getPage(pageNumber)) as unknown as PdfPageLike;
    const textContent = await page.getTextContent();
    let pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();

    if (pageText.length < 60) {
      try {
        const imageDataUrl = await renderPageToPngDataUrl(page);
        const ocrText = await runOcrOnPageImage(imageDataUrl);
        if (ocrText.length > pageText.length) {
          pageText = ocrText;
          usedOcr = true;
        }
      } catch {
        // If OCR fails, keep extracted text fallback.
      }
    }

    for (const piece of chunkText(pageText)) {
      chunks.push({ content: piece, pageNumber });
    }
  }

  return { pageCount: pdf.numPages, chunks, usedOcr };
}

export default function AppDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [recipeMode, setRecipeMode] = useState<'pdf' | 'ai'>('pdf');
  const [ingredientName, setIngredientName] = useState('');
  const [ingredientQty, setIngredientQty] = useState('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const [headerQuery, setHeaderQuery] = useState('');

  const [data, setData] = useState<DashboardData>({
    userId: null,
    fullName: 'Chef',
    tenantId: null,
    tenantType: 'home',
    trialEndsAt: null,
    inventory: [],
    recentRecipes: [],
    pdfCount: 0,
    latestPdfOcrUsed: false,
    latestPdfs: [],
    tenantBooks: [],
    culinaryProfile: {
      level: null,
      identity: [],
      preferred: [],
      avoid: [],
      goals: [],
    },
    activity: ['Creaste tu cuenta', 'Completaste onboarding', 'Listo para generar tu primera receta'],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: userData, error: userErr } = await supabase.auth.getUser();

      if (userErr || !userData.user) {
        setError('No hay sesión activa.');
        setLoading(false);
        return;
      }

      const authUser = userData.user;

      const [{ data: profile }, { data: inventoryRows }, { data: recipeRows }, { data: culinaryProfileRow }, { data: profileTermRows }] = await Promise.all([
        supabase.from('users').select('full_name,tenant_id,onboarding_completed').eq('id', authUser.id).maybeSingle(),
        supabase
          .from('recipe_inventory_items')
          .select('ingredient_name,quantity,created_at')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('recipe_ai_history')
          .select('recipe_title,created_at,user_feedback')
          .order('created_at', { ascending: false })
          .limit(8),
        supabase.from('user_culinary_profiles').select('level').eq('user_id', authUser.id).maybeSingle(),
        supabase
          .from('user_culinary_profile_terms')
          .select('preference_type,term_id')
          .eq('user_id', authUser.id),
      ]);


      if (profile && profile.onboarding_completed === false) {
        router.push('/onboarding');
        setLoading(false);
        return;
      }
      const tenantId = profile?.tenant_id ?? null;
      let trialEndsAt: string | null = null;
      let tenantType: 'home' | 'professional' = 'home';
      let pdfCount = 0;
      let latestPdfOcrUsed = false;
      let latestPdfs: DashboardPdfItem[] = [];
      let tenantBooks: Array<{ id: string; title: string }> = [];

      if (tenantId) {
        const [{ data: tenant }, { count }, { data: latestPdf }, { data: pdfRows }, { data: bookRows }] = await Promise.all([
          supabase.from('tenants').select('trial_ends_at,tenant_type').eq('id', tenantId).maybeSingle(),
          supabase.from('tenant_pdf_library').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
          supabase
            .from('tenant_pdf_library')
            .select('ocr_used')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('tenant_pdf_library')
            .select('id,storage_path,created_at,ocr_used,processing_status,processing_error')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(5),
          supabase
            .from('tenant_books')
            .select('id,title')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(20),
        ]);

        trialEndsAt = tenant?.trial_ends_at ?? null;
        tenantType = tenant?.tenant_type === 'professional' ? 'professional' : 'home';
        pdfCount = count ?? 0;
        latestPdfOcrUsed = latestPdf?.ocr_used ?? false;
        latestPdfs = (pdfRows ?? []).map((row) => ({
          id: row.id,
          storagePath: row.storage_path,
          createdAt: row.created_at,
          ocrUsed: row.ocr_used,
          processingStatus: row.processing_status,
          processingError: row.processing_error ?? null,
        }));
        tenantBooks = (bookRows ?? []).map((row) => ({ id: row.id, title: row.title }));
      }

      const profileTerms = (profileTermRows ?? []) as Array<{
        preference_type: 'identity' | 'prefer' | 'avoid' | 'goal';
        term_id: string;
      }>;
      const termIds = Array.from(new Set(profileTerms.map((row) => row.term_id)));
      let termLabelById = new Map<string, string>();
      if (termIds.length > 0) {
        const { data: termRows } = await supabase
          .from('culinary_terms')
          .select('id,label')
          .in('id', termIds);
        termLabelById = new Map((termRows ?? []).map((row) => [row.id, row.label]));
      }
      const labelsByType = (type: 'identity' | 'prefer' | 'avoid' | 'goal') =>
        profileTerms
          .filter((row) => row.preference_type === type)
          .map((row) => termLabelById.get(row.term_id) ?? null)
          .filter((label): label is string => Boolean(label));

      setData({
        userId: authUser.id,
        fullName: profile?.full_name || getMetadataFullName(authUser) || 'Chef',
        tenantId,
        tenantType,
        trialEndsAt,
        inventory: (inventoryRows ?? [])
          .map((row) => ({ name: row.ingredient_name, quantity: row.quantity ?? null }))
          .filter((row) => Boolean(row.name)),
        recentRecipes: (recipeRows ?? [])
          .map((row) => ({
            title: row.recipe_title ?? 'Receta sin título',
            createdAt: row.created_at,
            feedback: row.user_feedback ?? null,
          }))
          .filter((row) => Boolean(row.title)),
        pdfCount,
        latestPdfOcrUsed,
        latestPdfs,
        tenantBooks,
        culinaryProfile: {
          level: culinaryProfileRow?.level ?? null,
          identity: labelsByType('identity'),
          preferred: labelsByType('prefer'),
          avoid: labelsByType('avoid'),
          goals: labelsByType('goal'),
        },
        activity: [
          'Creaste tu cuenta',
          'Completaste onboarding',
          (recipeRows?.length ?? 0) > 0 ? 'Generaste recetas con ayuda' : 'Listo para generar tu primera receta',
        ],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el dashboard.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);


  const prettyPdfName = (storagePath: string): string => {
    const name = storagePath.split('/').pop() ?? storagePath;
    return decodeURIComponent(name).replace(/^[0-9]+-/, '');
  };

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }, []);


  const normalizedSearch = headerQuery.trim().toLowerCase();
  const searchResults = normalizedSearch.length < 2
    ? []
    : [
        ...data.inventory
          .filter((item) => item.name.toLowerCase().includes(normalizedSearch))
          .map((item) => ({ type: 'Ingrediente', label: item.name, href: '/recipes/inventory' })),
        ...data.recentRecipes
          .filter((item) => item.title.toLowerCase().includes(normalizedSearch))
          .map((item) => ({ type: 'Receta', label: item.title, href: '/recipes/history' })),
        ...data.tenantBooks
          .filter((item) => item.title.toLowerCase().includes(normalizedSearch))
          .map((item) => ({ type: 'PDF', label: item.title, href: '/app' })),
      ].slice(0, 8);

  const hasProfile =
    data.culinaryProfile.preferred.length > 0
    || data.culinaryProfile.goals.length > 0
    || data.culinaryProfile.avoid.length > 0
    || Boolean(data.culinaryProfile.level);
  const hasInventory = data.inventory.length > 0;
  const hasRecipes = data.recentRecipes.length > 0;
  const feedbackGiven = data.recentRecipes.filter((recipe) => recipe.feedback !== null).length;
  const positiveFeedback = data.recentRecipes.filter((recipe) => recipe.feedback === 'accepted').length;
  const negativeFeedback = data.recentRecipes.filter((recipe) => recipe.feedback === 'discarded').length;

  const nextAction = !hasProfile
    ? { title: 'Completar perfil culinario', description: 'Definí preferencias y objetivos para recetas más precisas.', href: '/onboarding', cta: 'Completar perfil' }
    : !hasInventory
      ? { title: 'Agregar ingredientes', description: 'Sin inventario activo, las sugerencias pierden contexto real.', href: '/recipes/inventory', cta: 'Gestionar inventario' }
      : !hasRecipes
        ? { title: 'Crear primera receta', description: 'Ya tienes contexto suficiente para generar una receta personalizada.', href: '/recipes/search', cta: 'Crear receta' }
        : feedbackGiven === 0
          ? { title: 'Calificar recetas recientes', description: 'Marca Me gustó / No me gustó para mejorar próximas sugerencias.', href: '/recipes/history', cta: 'Ir al historial' }
          : { title: 'Crear meal plan personalizado', description: 'Con tu feedback activo, ya puedes planificar semana o mes con más precisión.', href: '/meal-planner', cta: 'Planificar menú' };


  const openRecipeAi = (mode: 'pdf' | 'ai' = 'pdf') => {
    setRecipeMode(mode);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => promptInputRef.current?.focus(), 180);
  };

  const createRecipe = async () => {
    if (!data.tenantId || !data.userId) return;
    const basePrompt = prompt.trim() || 'Tengo pollo, arroz y tomate';

    setWorking(true);
    setMessage(null);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const fallbackTitle = `Receta sugerida: ${basePrompt.split(',')[0]?.trim() || 'Personalizada'}`;
      let titleFromModel: string | null = null;
      const ingredientList = basePrompt.split(',').map((v) => v.trim()).filter(Boolean);

      let recipeText = '';
      let citations: Array<{ id: string; similarity: number | string | null; metadata?: { page_number?: number; book_title?: string } }> = [];

      if (recipeMode === 'pdf') {
        const embedRes = await fetch('/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: [basePrompt] }),
        });

        if (!embedRes.ok) {
          const payload = await readErrorPayload(embedRes, 'No se pudo crear embedding.');
          throw new Error(payload.error ?? 'No se pudo crear embedding.');
        }

        const embedPayload = (await embedRes.json()) as { embeddings: number[][] };
        const queryEmbedding = embedPayload.embeddings[0];

        const { data: chunkRows, error: rpcErr } = await supabase.rpc('match_chunks', {
          query_embedding: queryEmbedding,
          match_threshold: 0.35,
          match_count: 8,
          filter_tenant_id: null,
        });

        if (rpcErr) throw rpcErr;

        const safeChunks = ((chunkRows ?? []) as Array<{ id: string; content: string; similarity: number | string | null; metadata?: { page_number?: number; book_title?: string } }>)
          .filter((row) => row.content);

        citations = safeChunks.slice(0, 4);

        const recipeRes = await fetch('/api/recipe-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredients: ingredientList,
            chunks: safeChunks.map((row) => row.content),
            culinaryProfile: data.culinaryProfile,
          }),
        });

        if (!recipeRes.ok) {
          const payload = await readErrorPayload(recipeRes, humanCopy.recipeGenerateError);
          throw new Error(payload.error ?? humanCopy.recipeGenerateError);
        }

        const recipePayload = (await recipeRes.json()) as { recipe: string; title?: string };
        recipeText = recipePayload.recipe;
        if (recipePayload.title) {
          // Override with model-inferred title from source context when available
          titleFromModel = recipePayload.title;
        }
      } else {
        const recipeRes = await fetch('/api/recipe-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ingredients: ingredientList,
            chunks: [],
            culinaryProfile: data.culinaryProfile,
          }),
        });

        if (!recipeRes.ok) {
          const payload = await readErrorPayload(recipeRes, humanCopy.recipeGenerateError);
          throw new Error(payload.error ?? humanCopy.recipeGenerateError);
        }

        const recipePayload = (await recipeRes.json()) as { recipe: string; title?: string };
        recipeText = recipePayload.recipe;
        if (recipePayload.title) {
          // Override with model-inferred title from source context when available
          titleFromModel = recipePayload.title;
        }
      }

      const { error: insertError } = await supabase.from('recipe_ai_history').insert({
        tenant_id: data.tenantId,
        user_id: data.userId,
        source: recipeMode === 'pdf' ? 'pdf_search' : 'ai_generation',
        recipe_title: titleFromModel || fallbackTitle,
        recipe_payload: {
          title: titleFromModel || fallbackTitle,
          prompt: basePrompt,
          full_recipe: recipeText,
          model_used: 'gemini-2.5-flash',
          mode: recipeMode,
          citations,
        },
        restrictions_snapshot: {},
        inventory_snapshot: data.inventory.map((item) => item.name),
      });

      if (insertError) throw insertError;
      setPrompt('');
      setMessage(humanCopy.recipeGeneratedSaved);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : humanCopy.recipeGenerateError);
    } finally {
      setWorking(false);
    }
  };

  const pdfLimit = data.tenantType === 'professional' ? 15 : 5;
  const canUploadMorePdfs = data.pdfCount < pdfLimit;

  const addIngredient = async () => {
    if (!data.tenantId || !data.userId) return;
    const name = ingredientName.trim();
    if (!name) return;

    setWorking(true);
    setMessage(null);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: existingRow, error: existingErr } = await supabase
        .from('recipe_inventory_items')
        .select('id')
        .eq('tenant_id', data.tenantId)
        .eq('user_id', data.userId)
        .ilike('ingredient_name', name)
        .maybeSingle();

      if (existingErr) throw existingErr;

      if (existingRow?.id) {
        const { error: updateErr } = await supabase
          .from('recipe_inventory_items')
          .update({ ingredient_name: name, quantity: ingredientQty.trim() || null })
          .eq('id', existingRow.id);

        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase.from('recipe_inventory_items').insert({
          tenant_id: data.tenantId,
          user_id: data.userId,
          ingredient_name: name,
          quantity: ingredientQty.trim() || null,
        });

        if (insertErr) throw insertErr;
      }
      setIngredientName('');
      setIngredientQty('');
      setMessage('Ingrediente guardado en inventario.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el ingrediente.');
    } finally {
      setWorking(false);
    }
  };


  const applyRecentRecipeAsPrompt = (title: string) => {
    setPrompt(title.replace(/^Receta sugerida:\s*/i, '').trim());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const uploadPdfFromInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file || !data.tenantId || !data.userId) return;

    if (!canUploadMorePdfs) {
      setError(`Límite de PDFs alcanzado para plan ${data.tenantType === 'professional' ? 'Professional' : 'Home'} (${pdfLimit}).`);
      return;
    }

    if (file.type !== 'application/pdf') {
      setError('Solo se permiten archivos PDF.');
      return;
    }

    setWorking(true);
    setMessage(null);
    setError(null);

    let insertedPdfId: string | null = null;
    let insertedBookId: string | null = null;
    try {
      const supabase = getSupabaseBrowserClient();
      const checksum = await sha256Hex(file);
      const safeName = sanitizeFileName(file.name);
      const storagePath = `tenant/${data.tenantId}/${Date.now()}-${safeName}`;
      const { pageCount, chunks, usedOcr } = await extractPdfChunks(file);

      const { error: storageErr } = await supabase.storage.from('tenant-pdfs').upload(storagePath, file, {
        contentType: 'application/pdf',
        upsert: false,
      });

      if (storageErr) throw storageErr;

      const { data: bookRow, error: bookErr } = await supabase
        .from('tenant_books')
        .insert({
          tenant_id: data.tenantId,
          title: safeName.replace('.pdf', ''),
          author: data.fullName,
          description: 'Subido desde dashboard',
        })
        .select('id')
        .single();

      if (bookErr || !bookRow) throw bookErr || new Error('No se pudo crear tenant_book.');
      insertedBookId = bookRow.id;

      const { data: pdfRow, error: pdfErr } = await supabase
        .from('tenant_pdf_library')
        .insert({
          tenant_id: data.tenantId,
          tenant_book_id: bookRow.id,
          storage_path: storagePath,
          file_size_bytes: file.size,
          page_count: Math.max(pageCount, 1),
          checksum_sha256: checksum,
          ocr_used: usedOcr,
          processing_status: 'processing',
          processed_chunks_count: 0,
          uploaded_by: data.userId,
        })
        .select('id')
        .single();

      if (pdfErr || !pdfRow) throw pdfErr || new Error('No se pudo crear tenant_pdf_library.');
      insertedPdfId = pdfRow.id;

      const chunkCandidates = (chunks.length > 0 ? chunks : [{ content: `Documento cargado: ${file.name}`, pageNumber: 1 }]).slice(0, 120);
      const embeddings = await generateEmbeddingsFromApi(chunkCandidates.map((chunk) => chunk.content));

      const rows = chunkCandidates.map((chunk, index) => ({
        tenant_id: data.tenantId,
        tenant_book_id: bookRow.id,
        global_book_id: null,
        source_type: 'tenant_pdf',
        content: chunk.content,
        metadata: {
          book_title: file.name.replace('.pdf', ''),
          page_number: chunk.pageNumber,
          source: 'dashboard_upload',
          storage_path: storagePath,
        },
        embedding: embeddings[index],
      }));

      const { error: chunkErr } = await supabase.from('book_chunks').insert(rows);

      if (chunkErr) throw chunkErr;

      await supabase
        .from('tenant_pdf_library')
        .update({ processing_status: 'ready', processed_chunks_count: rows.length, processing_error: null })
        .eq('tenant_book_id', bookRow.id);

      setMessage(`PDF cargado e indexado con ${rows.length} chunk(s)${usedOcr ? ' (incluyendo OCR)' : ''}.`);
      await load();
    } catch (e) {
      const supabase = getSupabaseBrowserClient();
      if (insertedPdfId) {
        await supabase
          .from('tenant_pdf_library')
          .update({ processing_status: 'failed', processing_error: e instanceof Error ? e.message : 'Error de procesamiento' })
          .eq('id', insertedPdfId);
      } else if (insertedBookId) {
        await supabase.from('tenant_books').delete().eq('id', insertedBookId);
      }
      setError(e instanceof Error ? e.message : 'No se pudo subir PDF.');
      await load();
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] text-[#241A14]">
      <div className="mx-auto flex w-full max-w-[1440px] gap-4 p-4 md:p-6">
        <aside className="dark-panel-shadow sticky top-4 z-40 hidden h-[calc(100vh-2rem)] w-[260px] flex-col rounded-3xl border border-white/10 bg-[#16110D] p-4 text-[#F4EBDD] lg:flex">
          <div>
            <p className="text-xl font-extrabold">Cocina<span className="text-[#E39A5A]">Core</span></p>
            <p className="text-xs text-[#BFAE9F]">Tu cocina inteligente</p>
          </div>
          <nav className="mt-6 space-y-1">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  title={item.description}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                    item.active
                      ? 'bg-[#C56A1A]/20 text-[#FFDDBE] ring-1 ring-[#C56A1A]/45'
                      : 'text-[#D5C5B8] hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon size={16} />
                  {item.label}
                  <span className="pointer-events-none absolute left-full top-1/2 z-[999] ml-3 hidden w-64 -translate-y-1/2 rounded-xl border border-[#E8DDD2]/30 bg-[#221913] px-3 py-2 text-xs text-[#F4EBDD] shadow-xl group-hover:block">
                    {item.description}
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-[#CDB8A6]">Trial activo</p>
            <p className="mt-1 text-sm font-semibold">{daysLeftLabel(data.trialEndsAt)}</p>
            <button className="mt-3 w-full rounded-xl border border-[#E39A5A]/50 px-3 py-2 text-sm font-semibold text-[#F8DCC2] hover:bg-[#C56A1A]/20">
              Ver planes
            </button>
          </div>
        </aside>

        <section className="w-full">
          <header className="glass-soft mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[#E8DDD2] px-4 py-3 md:px-5 md:py-4">
            <div className="flex items-center gap-3">
              <button className="grid h-10 w-10 place-items-center rounded-xl border border-[#E8DDD2] bg-white/70 lg:hidden">
                <Menu size={18} />
              </button>
              <div>
                <h1 className="text-2xl font-semibold">{greeting}, {data.fullName}</h1>
                <p className="text-sm text-[#6B5A50]">¿Qué quieres cocinar hoy?</p>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <div className="relative hidden md:flex">
                <div className="items-center gap-2 rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 flex">
                  <Search size={16} className="text-[#6B5A50]" />
                  <input
                    value={headerQuery}
                    onChange={(e) => setHeaderQuery(e.target.value)}
                    placeholder="Buscar recetas, ingredientes, PDFs..."
                    className="w-56 bg-transparent text-sm outline-none placeholder:text-[#8C7A6D]"
                  />
                </div>
                {searchResults.length > 0 ? (
                  <ul className="absolute right-0 top-12 z-20 w-[360px] rounded-xl border border-[#E8DDD2] bg-white p-2 shadow-lg">
                    {searchResults.map((result, idx) => (
                      <li key={`${result.type}-${result.label}-${idx}`}>
                        <Link
                          href={result.href}
                          onClick={() => setHeaderQuery('')}
                          className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-[#faf2e9]"
                        >
                          <span className="truncate text-[#241A14]">{result.label}</span>
                          <span className="ml-2 rounded-full border border-[#E8DDD2] px-2 py-0.5 text-[10px] font-semibold text-[#6B5A50]">{result.type}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <span className="rounded-full border border-[#567A3B]/30 bg-[#567A3B]/10 px-3 py-1 text-xs font-semibold text-[#567A3B]">Trial activo</span>
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#16110D] text-sm font-bold text-[#F5ECE2]">
                {data.fullName.slice(0, 1).toUpperCase()}
              </div>
            </div>
          </header>

          {error && <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {message && <p className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

          <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4">
            <Card className="relative overflow-hidden bg-[linear-gradient(155deg,#fff,#fff7f0)]">
              <h2 className="text-3xl font-semibold">¿Qué quieres cocinar hoy?</h2>
              <p className="mt-2 max-w-2xl text-[#6B5A50]">
                Genera recetas inteligentes usando tus ingredientes, preferencias y biblioteca culinaria.
              </p>
              <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                <input
                  ref={promptInputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Tengo pollo, arroz y tomate…"
                  className="h-12 flex-1 rounded-2xl border border-[#E8DDD2] bg-white px-4 outline-none transition focus:border-[#6D4AFF] focus:ring-2 focus:ring-[#6D4AFF]/20"
                />
                <button
                  disabled={working || loading}
                  onClick={createRecipe}
                  className="h-12 rounded-2xl bg-[#C56A1A] px-5 font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60"
                >
                  Generar receta
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-[#6B5A50]">Modo:</span>
                <button
                  type="button"
                  onClick={() => setRecipeMode('pdf')}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    recipeMode === 'pdf'
                      ? 'border-[#6D4AFF]/50 bg-[#6D4AFF]/10 text-[#6D4AFF]'
                      : 'border-[#E8DDD2] bg-white/80 text-[#6B5A50]'
                  }`}
                >
                  {humanCopy.searchInPdfs}
                </button>
                <button
                  type="button"
                  onClick={() => setRecipeMode('ai')}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                    recipeMode === 'ai'
                      ? 'border-[#C56A1A]/50 bg-[#C56A1A]/10 text-[#A55412]'
                      : 'border-[#E8DDD2] bg-white/80 text-[#6B5A50]'
                  }`}
                >
                  {humanCopy.createWithMe}
                </button>
                <span className="text-xs text-[#8C7A6D]">
                  {recipeMode === 'pdf' ? 'Usa contexto de tu biblioteca PDF.' : 'Ignora PDFs y genera libre con ayuda.'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {quickChips.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => setPrompt(chip)}
                    className="rounded-full border border-[#E8DDD2] bg-white/85 px-3 py-1.5 text-sm text-[#6B5A50]"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-3">
                  <p className="text-xs font-semibold text-[#6D4AFF]">Tip del chef</p>
                  <p className="mt-1 text-sm text-[#6B5A50]">Sellá las proteínas antes de cocción lenta.</p>
                </div>
                <div className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-3">
                  <p className="text-xs font-semibold text-[#567A3B]">Ingredientes disponibles</p>
                  <p className="mt-1 text-sm text-[#6B5A50]">
                    {data.inventory.length ? data.inventory.slice(0, 5).map((item) => item.name).join(', ') : 'Agrega ingredientes para mejorar tus recetas'}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-3">
                  <p className="text-xs font-semibold text-[#C56A1A]">PDF culinarios</p>
                  <p className="mt-1 text-sm text-[#6B5A50]">
                    {data.pdfCount > 0 ? `${data.pdfCount} PDF cargados` : 'Sube tu primer PDF culinario'}
                  </p>
                </div>
              </div>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card>
                <h3 className="text-xl font-semibold">{humanCopy.assistedCookingTitle}</h3>
                <p className="mt-2 text-[#6B5A50]">Crea recetas personalizadas con ayuda usando tu inventario y preferencias.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openRecipeAi('pdf')}
                    className="inline-flex items-center gap-1 rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#A55412] hover:border-[#6D4AFF]/40"
                  >
                    Buscar en PDFs <ArrowUpRight size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => openRecipeAi('ai')}
                    className="inline-flex items-center gap-1 rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#A55412] hover:border-[#C56A1A]/40"
                  >
                    {humanCopy.createWithMe} <ArrowUpRight size={14} />
                  </button>
                  <Link href="/recipes/search" className="inline-flex items-center gap-1 rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40">
                    Abrir módulo <ArrowUpRight size={14} />
                  </Link>
                  <Link href="/meal-planner" className="inline-flex items-center gap-1 rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#567A3B]/40">
                    Planificar menú <ArrowUpRight size={14} />
                  </Link>
                </div>
              </Card>

              <Card>
                <h3 className="text-xl font-semibold">Inventario</h3>
                <p className="mt-2 text-[#6B5A50]">Gestiona ingredientes disponibles y mejora las recomendaciones.</p>
                <p className="mt-2 text-xs font-semibold text-[#567A3B]">{data.inventory.length} ingrediente(s) activos</p>
                <ul className="mt-3 space-y-1 text-sm text-[#6B5A50]">
                  {data.inventory.length
                    ? data.inventory.slice(0, 5).map((item) => <li key={item.name}>• {item.name}{item.quantity ? ` · ${item.quantity}` : ''}</li>)
                    : <li>Agrega ingredientes para que CocinaCore pueda recomendar recetas más útiles.</li>}
                </ul>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <input
                    value={ingredientName}
                    onChange={(e) => setIngredientName(e.target.value)}
                    placeholder="Ingrediente"
                    className="h-10 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none"
                  />
                  <input
                    value={ingredientQty}
                    onChange={(e) => setIngredientQty(e.target.value)}
                    placeholder="Cantidad"
                    className="h-10 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none"
                  />
                </div>
                <button
                  onClick={addIngredient}
                  disabled={working || loading}
                  className="mt-2 rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50] disabled:opacity-60"
                >
                  Agregar ingrediente
                </button>
                <Link href="/recipes/inventory" className="mt-2 inline-flex text-xs font-semibold text-[#A55412] hover:text-[#C56A1A]">Gestionar inventario</Link>
              </Card>

              <Card>
                <h3 className="text-xl font-semibold">Biblioteca</h3>
                <p className="mt-2 text-[#6B5A50]">Consulta tus libros y recetas PDF con búsqueda inteligente.</p>
                <p className="mt-2 text-sm text-[#6B5A50]">PDFs cargados: {data.pdfCount}</p>
                <p className="mt-1 text-xs text-[#6B5A50]">
                  Plan {data.tenantType === 'professional' ? 'Professional' : 'Home'} · límite {pdfLimit} PDFs
                </p>
                {data.pdfCount > 0 && data.latestPdfOcrUsed ? (
                  <span className="mt-2 inline-flex rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-2 py-1 text-xs font-semibold text-[#6D4AFF]">
                    OCR aplicado en el último PDF
                  </span>
                ) : null}

                {data.latestPdfs.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-xs text-[#6B5A50]">
                    {data.latestPdfs.map((pdf) => (
                      <li key={pdf.id} className="flex items-center justify-between rounded-xl border border-[#E8DDD2] bg-white/70 px-2.5 py-2">
                        <span className="max-w-[70%] truncate" title={prettyPdfName(pdf.storagePath)}>{prettyPdfName(pdf.storagePath)}</span>
                        <div className="flex items-center gap-1">
                          {pdf.processingStatus === 'processing' ? (
                            <span className="rounded-full border border-[#C56A1A]/30 bg-[#C56A1A]/10 px-2 py-0.5 text-[10px] font-semibold text-[#C56A1A]">Proc</span>
                          ) : pdf.processingStatus === 'failed' ? (
                            <span
                              className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                              title={pdf.processingError ?? 'Error de procesamiento no detallado.'}
                            >
                              Error
                            </span>
                          ) : null}
                          {pdf.ocrUsed ? (
                            <span className="rounded-full border border-[#6D4AFF]/30 bg-[#6D4AFF]/10 px-2 py-0.5 text-[10px] font-semibold text-[#6D4AFF]">OCR</span>
                          ) : (
                            <span className="rounded-full border border-[#567A3B]/30 bg-[#567A3B]/10 px-2 py-0.5 text-[10px] font-semibold text-[#567A3B]">Texto</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={uploadPdfFromInput}
                />
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={working || loading || !canUploadMorePdfs}
                  className="mt-4 rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50] disabled:opacity-60"
                >
                  {canUploadMorePdfs ? 'Subir PDF' : 'Límite de PDFs alcanzado'}
                </button>
              </Card>

              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold">Recetas recientes</h3>
                    <p className="mt-2 text-[#6B5A50]">Últimas recetas sugeridas.</p>
                  </div>
                  <Link
                    href="/recipes/history"
                    className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                  >
                    Ver historial
                  </Link>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-[#6B5A50]">
                  {data.recentRecipes.length ? (
                    data.recentRecipes.map((r) => (
                      <li key={`${r.title}-${r.createdAt}`} className="rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2">
                        <p className="font-medium text-[#241A14]">{r.title}</p>
                        <p className="mt-1 text-xs text-[#6B5A50]">{new Date(r.createdAt).toLocaleString()}</p>
                        <p className={`mt-1 text-xs font-semibold ${r.feedback === 'accepted' ? 'text-[#567A3B]' : r.feedback === 'discarded' ? 'text-red-700' : 'text-[#8C7A6D]'}`}>
                          {r.feedback === 'accepted' ? 'Me gustó' : r.feedback === 'discarded' ? 'No me gustó' : 'Sin feedback'}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => applyRecentRecipeAsPrompt(r.title)}
                            className="rounded-lg border border-[#E8DDD2] px-2.5 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#6D4AFF]/40"
                          >
                            Usar como prompt
                          </button>
                          <Link
                            href="/recipes/search"
                            className="rounded-lg border border-[#E8DDD2] px-2.5 py-1 text-xs font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
                          >
                            Abrir Cocina asistida
                          </Link>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2">Aún no tienes recetas generadas</li>
                  )}
                </ul>
              </Card>

              <Card>
                <h3 className="text-xl font-semibold">Señales de aprendizaje</h3>
                {data.recentRecipes.length > 0 ? (
                  <>
                    <p className="mt-2 text-sm text-[#6B5A50]">CocinaCore aprende de tu feedback para mejorar próximas sugerencias.</p>
                    <ul className="mt-3 space-y-1 text-sm text-[#6B5A50]">
                      <li>• Me gustó: <span className="font-semibold text-[#567A3B]">{positiveFeedback}</span></li>
                      <li>• No me gustó: <span className="font-semibold text-red-700">{negativeFeedback}</span></li>
                      <li>• Personalización: <span className="font-semibold">{feedbackGiven > 0 ? 'Activa' : 'Inicial'}</span></li>
                    </ul>
                  </>
                ) : (
                  <p className="mt-2 text-[#6B5A50]">Marca recetas como Me gustó o No me gustó para mejorar tus recomendaciones.</p>
                )}
              </Card>

              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xl font-semibold">Perfil culinario aplicado</h3>
                  <Link href="/onboarding" className="text-xs font-semibold text-[#A55412] hover:text-[#C56A1A]">Actualizar perfil</Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ...data.culinaryProfile.preferred,
                    ...data.culinaryProfile.goals,
                    ...data.culinaryProfile.avoid.map((item) => `Evitar: ${item}`),
                    ...(data.culinaryProfile.level ? [`Nivel: ${data.culinaryProfile.level}`] : []),
                  ].slice(0, 8).map((item) => (
                    <span key={item} className="rounded-full border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs text-[#6B5A50]">{item}</span>
                  ))}
                  {data.culinaryProfile.preferred.length === 0 && data.culinaryProfile.goals.length === 0 && data.culinaryProfile.avoid.length === 0 ? (
                    <span className="text-sm text-[#6B5A50]">Completa tu perfil para recibir recetas más precisas.</span>
                  ) : null}
                </div>
              </Card>

              <Card>
                <h3 className="text-xl font-semibold">Próxima acción recomendada</h3>
                <p className="mt-2 font-semibold text-[#241A14]">{nextAction.title}</p>
                <p className="mt-1 text-sm text-[#6B5A50]">{nextAction.description}</p>
                <Link href={nextAction.href} className="mt-3 inline-flex rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#A55412] hover:border-[#C56A1A]/40">
                  {nextAction.cta}
                </Link>
              </Card>

              <Card>
                <h3 className="text-xl font-semibold">Estado del sistema</h3>
                <ul className="mt-3 space-y-2 text-sm text-[#6B5A50]">
                  <li>• Perfil culinario: <span className={hasProfile ? 'text-[#567A3B] font-semibold' : 'text-[#A55412] font-semibold'}>{hasProfile ? 'Listo' : 'Pendiente'}</span></li>
                  <li>• Inventario: <span className={hasInventory ? 'text-[#567A3B] font-semibold' : 'text-[#A55412] font-semibold'}>{hasInventory ? 'Listo' : 'Pendiente'}</span></li>
                  <li>• Cocina asistida: <span className={hasRecipes ? 'text-[#567A3B] font-semibold' : 'text-[#A55412] font-semibold'}>{hasRecipes ? 'Listo' : 'Recomendado'}</span></li>
                  <li>• Meal Planner: <span className={hasProfile && hasInventory ? 'text-[#567A3B] font-semibold' : 'text-[#A55412] font-semibold'}>{hasProfile && hasInventory ? 'Listo' : 'Recomendado'}</span></li>
                  <li>• Feedback: <span className={feedbackGiven > 0 ? 'text-[#567A3B] font-semibold' : 'text-[#A55412] font-semibold'}>{feedbackGiven > 0 ? 'Listo' : 'Pendiente'}</span></li>
                </ul>
              </Card>

              <Card>
                <h3 className="text-xl font-semibold">Premium Board</h3>
                <p className="mt-2 text-[#6B5A50]">Explora y publica recetas premium de la comunidad.</p>
                <Link href="/app/premium" className="mt-4 inline-flex items-center gap-1 font-semibold text-[#A55412]">
                  Explorar <ArrowUpRight size={14} />
                </Link>
              </Card>
            </div>
          </motion.section>

          {loading && <p className="mt-4 text-sm text-[#6B5A50]">Cargando tu cocina inteligente...</p>}
        </section>
      </div>
    </main>
  );
}
