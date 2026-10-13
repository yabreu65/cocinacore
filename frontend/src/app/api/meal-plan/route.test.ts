import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type {
  RecipeInventoryItemRow,
  UserCulinaryProfileRow,
  UserMealPlanRow,
} from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';
import {
  parseStructuredMealPlanResponse,
  parseStructuredMealPlanValue,
  type StructuredMealPlan,
} from '@/lib/meal-planner/structured-plan';

const requireUserMock = vi.fn();
const listInventoryItemsByTenantMock = vi.fn();
const findCulinaryProfileByUserIdMock = vi.fn();
const findCulinaryProfileTermsByUserIdMock = vi.fn();
const createMealPlanMock = vi.fn();
const findLatestMealPlanByUserAndTenantMock = vi.fn();
const checkRateLimitMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listInventoryItemsByTenant: listInventoryItemsByTenantMock,
}));

vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: findCulinaryProfileByUserIdMock,
  findCulinaryProfileTermsByUserId: findCulinaryProfileTermsByUserIdMock,
}));

vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  createMealPlan: createMealPlanMock,
  findLatestMealPlanByUserAndTenant: findLatestMealPlanByUserAndTenantMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

vi.mock('@/lib/ai/gemini-config', () => ({
  getGeminiApiKey: () => 'gemini-test-key',
  getGeminiBaseUrl: () => 'https://generativelanguage.googleapis.com/v1beta',
  getGeminiModel: () => 'gemini-test-model',
}));

vi.mock('@/lib/serverLogger', () => ({
  serverLogger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const { GET, POST } = await import('./route');

function inventoryItem(overrides: Partial<RecipeInventoryItemRow> = {}): RecipeInventoryItemRow {
  return {
    id: 'item-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    ingredient_name: 'Arroz real',
    quantity: '2',
    unit: 'kg',
    category: null,
    expiration_date: null,
    estimated_unit_price: null,
    purchase_location: null,
    low_stock_threshold: null,
    normalized_name: null,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function profile(overrides: Partial<UserCulinaryProfileRow> = {}): UserCulinaryProfileRow {
  return {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    level: 'Intermedio',
    available_time_minutes: null,
    disliked_ingredients: [],
    allergies: [],
    household_members: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function profileTerm(
  preference_type: UserCulinaryProfileTermWithLabel['preference_type'],
  term_label: string,
  overrides: Partial<UserCulinaryProfileTermWithLabel> = {}
): UserCulinaryProfileTermWithLabel {
  return {
    user_id: 'user-1',
    term_id: `${preference_type}-${term_label}`,
    preference_type,
    term_label,
    weight: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/meal-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify(body),
  });
}

function getRequest(): Request {
  return new Request('https://app.example.test/api/meal-plan', { method: 'GET' });
}

function structuredPlanJson(period: 'week' | 'fortnight' | 'month' = 'week'): string {
  const dayCount = period === 'week' ? 7 : period === 'fortnight' ? 14 : 30;
  return JSON.stringify({
    period,
    dayCount,
    days: Array.from({ length: dayCount }, (_, index) => ({
      dayIndex: index + 1,
      meals: [
        {
          mealType: 'breakfast',
          title: 'Avena con fruta',
          prepMinutes: 20,
          description: null,
          ingredients: [{ name: 'Avena', quantity: 1, unit: 'taza' }],
        },
        {
          mealType: 'lunch',
          title: 'Arroz con verduras',
          prepMinutes: 30,
          description: 'Plato principal',
          ingredients: [{ name: 'Arroz real', quantity: null, unit: null }],
        },
        {
          mealType: 'dinner',
          title: 'Sopa liviana',
          prepMinutes: 25,
          description: null,
          ingredients: [{ name: 'Calabaza', quantity: null, unit: null }],
        },
      ],
    })),
  });
}

function structuredPlanWithIngredient(name: string): string {
  const plan = JSON.parse(structuredPlanJson()) as {
    days: Array<{ meals: Array<{ ingredients: Array<{ name: string }> }> }>;
  };
  plan.days[0].meals[0].ingredients[0].name = name;
  return JSON.stringify(plan);
}

function canonicalStructuredPlan(period: 'week' | 'fortnight' | 'month' = 'week'): StructuredMealPlan {
  const parsed = parseStructuredMealPlanResponse(structuredPlanJson(period), period);
  if (!parsed.success) throw new Error('Expected structured plan fixture to be valid');
  return parsed.plan;
}

function mealPlanRow(overrides: Partial<UserMealPlanRow> = {}): UserMealPlanRow {
  return {
    id: 'meal-plan-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    people_count: 4,
    period: 'week',
    mode: 'inventory_to_menu',
    base_cuisine: 'Latinoamericana',
    fusion_cuisines: [],
    fusion_intensity: 'media',
    goal: null,
    restrictions: [],
    inventory_snapshot: {},
    calendar_payload: canonicalStructuredPlan(),
    consumption_payload: {},
    ai_content: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function geminiRequest(): {
  contents: Array<{ parts: Array<{ text: string }> }>;
  generationConfig: { responseMimeType: string; responseJsonSchema: unknown };
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as {
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: { responseMimeType: string; responseJsonSchema: unknown };
  };
}

function geminiPrompt(): string {
  return geminiRequest().contents[0].parts[0].text;
}

describe('POST /api/meal-plan', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    listInventoryItemsByTenantMock.mockReset();
    findCulinaryProfileByUserIdMock.mockReset();
    findCulinaryProfileTermsByUserIdMock.mockReset();
    createMealPlanMock.mockReset();
    findLatestMealPlanByUserAndTenantMock.mockReset();
    checkRateLimitMock.mockReset();
    fetchMock.mockReset();

    requireUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.test',
      fullName: null,
      tenant: {
        tenantId: 'tenant-1',
        role: 'owner',
        tenantType: 'home',
        onboardingCompleted: true,
      },
      termsAcceptedAt: null,
      termsVersion: null,
      onboardingCompleted: true,
    });
    listInventoryItemsByTenantMock.mockResolvedValue([inventoryItem()]);
    findCulinaryProfileByUserIdMock.mockResolvedValue(null);
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([]);
    createMealPlanMock.mockResolvedValue(mealPlanRow());
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(null);
    checkRateLimitMock.mockResolvedValue({ success: true, limit: 10, remaining: 9, resetAt: 1 });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: structuredPlanJson() }] } }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('loads authenticated inventory and persisted profile, ignoring browser-controlled values', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile());
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([
      profileTerm('identity', 'Cocina andina'),
      profileTerm('prefer', 'Legumbres'),
      profileTerm('avoid', 'Maní'),
      profileTerm('goal', 'Comidas rápidas'),
    ]);

    const response = await POST(
      request({
        mode: 'inventory_to_menu',
        inventory: ['ingrediente-controlado-por-el-navegador'],
        culinaryProfile: {
          preferred: ['perfil-controlado-por-el-navegador'],
          avoid: ['dato-no-confiable'],
          goals: ['meta-no-confiable'],
          level: 'Nivel no confiable',
        },
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    const responseBody = (await response.json()) as { id: string; content: string; plan: StructuredMealPlan };
    expect(responseBody.id).toBe('meal-plan-1');
    expect(responseBody.content).toEqual(expect.any(String));
    expect(responseBody.plan).toMatchObject({ period: 'week', dayCount: 7 });
    expect(responseBody.plan.days).toHaveLength(7);
    expect(responseBody.plan.days[0]).toMatchObject({
      dayIndex: 1,
      label: 'Lunes',
      meals: [
        { mealType: 'breakfast', title: 'Avena con fruta' },
        { mealType: 'lunch', title: 'Arroz con verduras' },
        { mealType: 'dinner', title: 'Sopa liviana' },
      ],
    });
    expect(geminiRequest().generationConfig.responseMimeType).toBe('application/json');
    expect(requireUserMock).toHaveBeenCalledTimes(1);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(findCulinaryProfileByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(findCulinaryProfileTermsByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(geminiPrompt()).toContain(
      'Inventario real disponible del hogar (base de datos, tenant autenticado):\n- arroz real: 2 kg'
    );
    expect(geminiPrompt()).toContain(
      'Perfil culinario persistido del usuario autenticado:\n' +
        'Identidad/contexto: Cocina andina\n' +
        'Preferencias: Legumbres\n' +
        'Evitar: Maní\n' +
        'Objetivos: Comidas rápidas\n' +
        'Nivel: Intermedio'
    );
    expect(geminiPrompt()).not.toContain('controlado-por-el-navegador');
    expect(geminiPrompt()).not.toContain('dato-no-confiable');
    expect(geminiPrompt()).not.toContain('meta-no-confiable');
    expect(geminiPrompt()).not.toContain('Nivel no confiable');
    expect(geminiPrompt().indexOf('Inventario real disponible')).toBeLessThan(
      geminiPrompt().indexOf('Perfil culinario persistido')
    );
  });

  it('uses the persisted profile cap as prompt context and snapshots it without accepting a request override', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ available_time_minutes: 30 }));

    const response = await POST(
      request({ mode: 'balanced_ai', availableTimeMinutes: 240 }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(geminiPrompt()).toContain('Cada comida individual debe estimarse en no más de 30 minutos');
    expect(geminiPrompt()).not.toContain('240 minutos');
    expect(JSON.stringify(geminiRequest().generationConfig.responseJsonSchema)).toContain('prepMinutes');
    expect(JSON.stringify(geminiRequest().generationConfig.responseJsonSchema)).toContain('"minimum":1');
    expect(createMealPlanMock.mock.calls[0]?.[0]).toMatchObject({
      structuredPlan: { availableTimeMinutesSnapshot: 30 },
    });
  });

  it.each([
    { label: 'over-cap individual meal', change: (plan: StructuredMealPlan) => { plan.days[0].meals[0].prepMinutes = 31; } },
    { label: 'mixed valid and over-cap meals', change: (plan: StructuredMealPlan) => { plan.days[6].meals[2].prepMinutes = 31; } },
  ])('rejects a $label before persistence', async ({ change }) => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ available_time_minutes: 30 }));
    const plan = canonicalStructuredPlan();
    change(plan);
    const candidate = {
      period: plan.period,
      dayCount: plan.dayCount,
      days: plan.days.map(({ dayIndex, meals }) => ({ dayIndex, meals })),
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(candidate) }] } }] }), { status: 200 })
    );

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createMealPlanMock).not.toHaveBeenCalled();
  });

  it('persists the canonical plan once with authenticated user and tenant scope', async () => {
    const response = await POST(
      request({
        mode: 'balanced_ai',
        period: 'week',
        peopleCount: 2,
        baseCuisine: 'Italiana',
        fusionCuisines: ['Japonesa'],
        fusionIntensity: 'alta',
        userId: 'browser-user',
        tenantId: 'browser-tenant',
      }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(createMealPlanMock).toHaveBeenCalledTimes(1);
    expect(createMealPlanMock).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'user-1',
      peopleCount: 2,
      period: 'week',
      mode: 'balanced_ai',
      baseCuisine: 'Italiana',
      fusionCuisines: ['Japonesa'],
      fusionIntensity: 'alta',
      restrictions: [],
      inventorySnapshot: { inventoryLines: ['- arroz real: 2 kg'] },
      structuredPlan: { ...canonicalStructuredPlan(), availableTimeMinutesSnapshot: null },
    });
  });

  it('keeps explicit request restrictions separate from persisted profile avoidance and snapshots trusted inventory', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile());
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([profileTerm('avoid', 'Maní')]);

    const response = await POST(
      request({ mode: 'balanced_ai', restrictions: [' Gluten ', 'gluten', 'Lácteos'] }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(geminiPrompt()).toContain('Evitar: Maní');
    expect(geminiPrompt()).toContain(
      'Restricciones explícitas de esta solicitud (no reemplazan el perfil persistido):\n- Gluten\n- Lácteos'
    );
    expect(createMealPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        restrictions: ['Gluten', 'Lácteos'],
        inventorySnapshot: { inventoryLines: ['- arroz real: 2 kg'] },
        structuredPlan: { ...canonicalStructuredPlan(), availableTimeMinutesSnapshot: null },
      })
    );
  });

  it('excludes another user profile and terms while allowing a missing profile to generate normally', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ user_id: 'user-2' }));
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([
      profileTerm('avoid', 'Término de otro usuario', { user_id: 'user-2' }),
    ]);

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(geminiPrompt()).toContain(
      'Perfil culinario persistido del usuario autenticado:\nSin perfil culinario configurado.'
    );
    expect(geminiPrompt()).not.toContain('Término de otro usuario');
  });

  it('adds the empty persisted inventory marker to non-inventory modes before proposing purchases', async () => {
    listInventoryItemsByTenantMock.mockResolvedValue([]);

    const response = await POST(
      request({ mode: 'balanced_ai', inventory: ['ingrediente-controlado-por-el-navegador'] }) as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(listInventoryItemsByTenantMock).toHaveBeenCalledWith('tenant-1');
    expect(geminiPrompt()).toContain(
      'Inventario real disponible del hogar (base de datos, tenant autenticado):\nSin inventario persistido para este hogar.'
    );
    expect(geminiPrompt()).toContain('Sin perfil culinario configurado.');
    expect(geminiPrompt()).not.toContain('ingrediente-controlado-por-el-navegador');
  });

  it('rejects over-bounded explicit restrictions before calling Gemini or persistence', async () => {
    const response = await POST(
      request({ restrictions: Array.from({ length: 21 }, (_, index) => `restriction-${index}`) }) as unknown as NextRequest
    );

    expect(response.status).toBe(400);
    const tooLongResponse = await POST(
      request({ restrictions: ['x'.repeat(101)] }) as unknown as NextRequest
    );
    expect(tooLongResponse.status).toBe(400);
    expect(createMealPlanMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'persisted allergy',
      setup: () => findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ allergies: ['Lácteos'] })),
      restrictions: undefined,
      ingredient: 'LACTEOS',
    },
    {
      label: 'canonical persisted allergy alias',
      setup: () => findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ allergies: ['jitomates'] })),
      restrictions: undefined,
      ingredient: 'Tomates',
    },
    {
      label: 'singular persisted allergy against plural ingredient',
      setup: () => findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ allergies: ['nuez'] })),
      restrictions: undefined,
      ingredient: 'nueces',
    },
    {
      label: 'persisted avoid term',
      setup: () => {
        findCulinaryProfileByUserIdMock.mockResolvedValue(profile());
        findCulinaryProfileTermsByUserIdMock.mockResolvedValue([profileTerm('avoid', 'Maní')]);
      },
      restrictions: undefined,
      ingredient: 'mani tostado',
    },
    {
      label: 'explicit request restriction',
      setup: () => undefined,
      restrictions: ['Sésamo'],
      ingredient: 'sesamo negro',
    },
  ])('rejects a generated plan containing a $label before persistence', async ({ setup, restrictions, ingredient }) => {
    setup();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: structuredPlanWithIngredient(ingredient) }] } }] }),
        { status: 200 }
      )
    );

    const response = await POST(
      request({ mode: 'balanced_ai', ...(restrictions ? { restrictions } : {}) }) as unknown as NextRequest
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'El proveedor IA devolvió un plan inválido.' });
    expect(createMealPlanMock).not.toHaveBeenCalled();
  });

  it.each([
    { allergy: 'cacahuate', ingredient: 'maní' },
    { allergy: 'cacahuete', ingredient: 'peanut' },
    { allergy: 'maní', ingredient: 'cacahuates' },
  ])('rejects generated peanut synonym $ingredient for hard allergy $allergy', async ({ allergy, ingredient }) => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ allergies: [allergy] }));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: structuredPlanWithIngredient(ingredient) }] } }] }),
        { status: 200 }
      )
    );

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createMealPlanMock).not.toHaveBeenCalled();
  });

  it('does not treat disliked ingredients as hard restrictions', async () => {
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ disliked_ingredients: ['Cilantro'] }));
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: structuredPlanWithIngredient('cilantro') }] } }] }),
        { status: 200 }
      )
    );

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(createMealPlanMock).toHaveBeenCalledTimes(1);
  });

  it('does not persist malformed Gemini output', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not valid JSON' }] } }] }),
        { status: 200 }
      )
    );

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'El proveedor IA devolvió un plan inválido.' });
    expect(createMealPlanMock).not.toHaveBeenCalled();
  });

  it('does not persist semantic-invalid Gemini output', async () => {
    const invalidPlan = JSON.parse(structuredPlanJson()) as {
      days: Array<{ meals: Array<{ mealType: string }> }>;
    };
    invalidPlan.days[0].meals[2].mealType = 'lunch';
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(invalidPlan) }] } }] }),
        { status: 200 }
      )
    );

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createMealPlanMock).not.toHaveBeenCalled();
  });

  it('does not persist a plan with the wrong period day count', async () => {
    const invalidPlan = JSON.parse(structuredPlanJson()) as {
      dayCount: number;
      days: unknown[];
    };
    invalidPlan.dayCount = 6;
    invalidPlan.days = invalidPlan.days.slice(0, 6);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(invalidPlan) }] } }] }),
        { status: 200 }
      )
    );

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(502);
    expect(createMealPlanMock).not.toHaveBeenCalled();
  });

  it('returns a controlled 500 when persistence fails', async () => {
    createMealPlanMock.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request({ mode: 'balanced_ai' }) as unknown as NextRequest);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo guardar el menú generado.' });
  });

  it('returns a safe unauthorized response without loading persisted context or calling Gemini', async () => {
    requireUserMock.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(request({ mode: 'inventory_to_menu' }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
    expect(findCulinaryProfileByUserIdMock).not.toHaveBeenCalled();
    expect(findCulinaryProfileTermsByUserIdMock).not.toHaveBeenCalled();
    expect(createMealPlanMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe unauthorized response when the authenticated user lacks tenant context', async () => {
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: null });

    const response = await POST(request({ mode: 'inventory_to_menu' }) as unknown as NextRequest);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(listInventoryItemsByTenantMock).not.toHaveBeenCalled();
    expect(createMealPlanMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/meal-plan', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    findLatestMealPlanByUserAndTenantMock.mockReset();
    findCulinaryProfileByUserIdMock.mockReset();
    findCulinaryProfileTermsByUserIdMock.mockReset();
    findCulinaryProfileByUserIdMock.mockResolvedValue(null);
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([]);
    requireUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.test',
      fullName: null,
      tenant: {
        tenantId: 'tenant-1',
        role: 'owner',
        tenantType: 'home',
        onboardingCompleted: true,
      },
      termsAcceptedAt: null,
      termsVersion: null,
      onboardingCompleted: true,
    });
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(null);
  });

  it('returns the latest validated canonical plan and rendered content', async () => {
    const storedPlan = canonicalStructuredPlan();
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(
      mealPlanRow({ calendar_payload: storedPlan })
    );

    const response = await GET(getRequest() as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(findLatestMealPlanByUserAndTenantMock).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(await response.json()).toEqual({
      plan: storedPlan,
      content:
        'Lunes\nDesayuno: Avena con fruta (20 min estimados) (1 taza Avena)\nAlmuerzo: Arroz con verduras (30 min estimados) — Plato principal (Arroz real)\nCena: Sopa liviana (25 min estimados) (Calabaza)\n\n' +
        'Martes\nDesayuno: Avena con fruta (20 min estimados) (1 taza Avena)\nAlmuerzo: Arroz con verduras (30 min estimados) — Plato principal (Arroz real)\nCena: Sopa liviana (25 min estimados) (Calabaza)\n\n' +
        'Miércoles\nDesayuno: Avena con fruta (20 min estimados) (1 taza Avena)\nAlmuerzo: Arroz con verduras (30 min estimados) — Plato principal (Arroz real)\nCena: Sopa liviana (25 min estimados) (Calabaza)\n\n' +
        'Jueves\nDesayuno: Avena con fruta (20 min estimados) (1 taza Avena)\nAlmuerzo: Arroz con verduras (30 min estimados) — Plato principal (Arroz real)\nCena: Sopa liviana (25 min estimados) (Calabaza)\n\n' +
        'Viernes\nDesayuno: Avena con fruta (20 min estimados) (1 taza Avena)\nAlmuerzo: Arroz con verduras (30 min estimados) — Plato principal (Arroz real)\nCena: Sopa liviana (25 min estimados) (Calabaza)\n\n' +
        'Sábado\nDesayuno: Avena con fruta (20 min estimados) (1 taza Avena)\nAlmuerzo: Arroz con verduras (30 min estimados) — Plato principal (Arroz real)\nCena: Sopa liviana (25 min estimados) (Calabaza)\n\n' +
        'Domingo\nDesayuno: Avena con fruta (20 min estimados) (1 taza Avena)\nAlmuerzo: Arroz con verduras (30 min estimados) — Plato principal (Arroz real)\nCena: Sopa liviana (25 min estimados) (Calabaza)',
      id: 'meal-plan-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      peopleCount: 4,
      period: 'week',
      mode: 'inventory_to_menu',
      baseCuisine: 'Latinoamericana',
      fusionCuisines: [],
      fusionIntensity: 'media',
      restrictions: [],
    });
  });

  it('keeps historical plans without estimates readable despite a changed current time cap', async () => {
    const legacy = JSON.parse(structuredPlanJson()) as {
      days: Array<{ meals: Array<{ prepMinutes?: number }> }>;
    };
    for (const day of legacy.days) {
      for (const meal of day.meals) delete meal.prepMinutes;
    }
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ available_time_minutes: 1 }));
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(mealPlanRow({ calendar_payload: legacy }));

    const response = await GET(getRequest() as unknown as NextRequest);
    const body = (await response.json()) as { content: string; plan: StructuredMealPlan };

    expect(response.status).toBe(200);
    expect(body.plan.days[0].meals[0].prepMinutes).toBeNull();
    expect(body.content).toContain('tiempo no estimado');
  });

  it('does not invalidate a saved plan when only taste preferences change', async () => {
    const storedPlan = canonicalStructuredPlan();
    const saved = mealPlanRow({ calendar_payload: storedPlan });
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([profileTerm('prefer', 'Picante')]);
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(saved);

    const response = await GET(getRequest() as unknown as NextRequest);
    const body = (await response.json()) as { plan: StructuredMealPlan };

    expect(response.status).toBe(200);
    expect(body.plan).toEqual(storedPlan);
    expect(saved.calendar_payload).toEqual(storedPlan);
    expect(createMealPlanMock).not.toHaveBeenCalled();
    expect(findLatestMealPlanByUserAndTenantMock).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate an estimated saved plan when available time decreases', async () => {
    const storedPlan = canonicalStructuredPlan();
    const saved = mealPlanRow({ calendar_payload: storedPlan });
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ available_time_minutes: 1 }));
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(saved);

    const response = await GET(getRequest() as unknown as NextRequest);
    const body = (await response.json()) as { plan: StructuredMealPlan };

    expect(response.status).toBe(200);
    expect(body.plan).toEqual(storedPlan);
    expect(body.plan.days[0].meals[0].prepMinutes).toBe(storedPlan.days[0].meals[0].prepMinutes);
    expect(saved.calendar_payload).toEqual(storedPlan);
    expect(createMealPlanMock).not.toHaveBeenCalled();
    expect(findLatestMealPlanByUserAndTenantMock).toHaveBeenCalledTimes(1);
  });

  it('uses safe defaults for missing legacy metadata without exposing the database row', async () => {
    const storedPlan = canonicalStructuredPlan();
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(
      mealPlanRow({
        calendar_payload: storedPlan,
        people_count: 0,
        base_cuisine: '',
        fusion_cuisines: null as unknown as string[],
        fusion_intensity: null as unknown as 'media',
        restrictions: null as unknown as string[],
      })
    );

    const response = await GET(getRequest() as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      peopleCount: 4,
      period: 'week',
      mode: 'inventory_to_menu',
      baseCuisine: 'Latinoamericana',
      fusionCuisines: [],
      fusionIntensity: 'media',
      restrictions: [],
    });
  });

  it.each([
    {
      label: 'current profile allergy',
      setup: () => findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ allergies: ['Maní'] })),
      ingredient: 'Manis tostados',
    },
    {
      label: 'current profile avoid term',
      setup: () => {
        findCulinaryProfileByUserIdMock.mockResolvedValue(profile());
        findCulinaryProfileTermsByUserIdMock.mockResolvedValue([profileTerm('avoid', 'Sésamo')]);
      },
      ingredient: 'Sésamo negro',
    },
  ])('rejects a saved plan conflicting with $label without exposing or mutating history', async ({ setup, ingredient }) => {
    setup();
    const storedPlan = parseStructuredMealPlanValue(
      JSON.parse(structuredPlanWithIngredient(ingredient)) as unknown,
      'week'
    );
    if (!storedPlan.success) throw new Error('Expected valid stored plan fixture');
    const saved = mealPlanRow({ calendar_payload: storedPlan.plan });
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(saved);

    const response = await GET(getRequest() as unknown as NextRequest);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'MEAL_PLAN_RESTRICTIONS_CHANGED',
      code: 'MEAL_PLAN_RESTRICTIONS_CHANGED',
    });
    expect(findLatestMealPlanByUserAndTenantMock).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(findCulinaryProfileByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(findCulinaryProfileTermsByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(createMealPlanMock).not.toHaveBeenCalled();
    expect(findLatestMealPlanByUserAndTenantMock).toHaveBeenCalledTimes(1);
    expect(saved.calendar_payload).toEqual(storedPlan.plan);
  });

  it('returns a saved plan that does not conflict with current profile restrictions', async () => {
    const storedPlan = canonicalStructuredPlan();
    findCulinaryProfileByUserIdMock.mockResolvedValue(profile({ allergies: ['Maní'] }));
    findCulinaryProfileTermsByUserIdMock.mockResolvedValue([profileTerm('avoid', 'Sésamo')]);
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(mealPlanRow({ calendar_payload: storedPlan }));

    const response = await GET(getRequest() as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ plan: storedPlan }));
    expect(findCulinaryProfileByUserIdMock).toHaveBeenCalledWith('user-1');
    expect(findCulinaryProfileTermsByUserIdMock).toHaveBeenCalledWith('user-1');
  });

  it('returns null content and plan when no persisted meal plan exists', async () => {
    const response = await GET(getRequest() as unknown as NextRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: null, content: null });
  });

  it('returns a controlled 500 for a corrupted persisted plan', async () => {
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(
      mealPlanRow({ calendar_payload: { period: 'week', dayCount: 7, days: [] } })
    );

    const response = await GET(getRequest() as unknown as NextRequest);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo recuperar el menú guardado.' });
  });

  it('returns a controlled 500 when querying the persisted plan fails', async () => {
    findLatestMealPlanByUserAndTenantMock.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(getRequest() as unknown as NextRequest);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo recuperar el menú guardado.' });
  });

  it('does not retrieve another user plan in the authenticated tenant', async () => {
    requireUserMock.mockResolvedValue({
      id: 'user-2',
      tenant: {
        tenantId: 'tenant-1',
        role: 'member',
        tenantType: 'home',
        onboardingCompleted: true,
      },
    });
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(null);

    const response = await GET(
      new Request('https://app.example.test/api/meal-plan?userId=user-1') as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(findLatestMealPlanByUserAndTenantMock).toHaveBeenCalledWith('user-2', 'tenant-1');
    expect(await response.json()).toEqual({ plan: null, content: null });
  });

  it('does not retrieve a plan from another tenant', async () => {
    requireUserMock.mockResolvedValue({
      id: 'user-1',
      tenant: {
        tenantId: 'tenant-2',
        role: 'member',
        tenantType: 'home',
        onboardingCompleted: true,
      },
    });
    findLatestMealPlanByUserAndTenantMock.mockResolvedValue(null);

    const response = await GET(
      new Request('https://app.example.test/api/meal-plan?tenantId=tenant-1') as unknown as NextRequest
    );

    expect(response.status).toBe(200);
    expect(findLatestMealPlanByUserAndTenantMock).toHaveBeenCalledWith('user-1', 'tenant-2');
    expect(await response.json()).toEqual({ plan: null, content: null });
  });
});
