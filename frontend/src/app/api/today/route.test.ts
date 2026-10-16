import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireUserMock = vi.fn();
const rateLimitMock = vi.fn();
const profileMock = vi.fn();
const termsMock = vi.fn();
const inventoryMock = vi.fn();
const historyMock = vi.fn();
const planMock = vi.fn();
const ragMock = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const serverLoggerInfoMock = vi.fn();
const geminiModelMock = vi.fn(() => 'gemini-test');

vi.mock('@/lib/auth/server', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: profileMock,
  findCulinaryProfileTermsByUserId: termsMock,
}));
vi.mock('@/lib/db/repositories/inventoryRepository', () => ({
  listTodayInventoryContextByTenant: inventoryMock,
}));
vi.mock('@/lib/db/repositories/recipeRepository', () => ({
  listTodayRecipeHistoryByUserAndTenant: historyMock,
}));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({
  findLatestMealPlanByUserAndTenant: planMock,
}));
vi.mock('@/lib/recipes/server-rag-context', () => ({ retrieveServerRagContext: ragMock }));
vi.mock('@/lib/serverLogger', () => ({ serverLogger: { info: serverLoggerInfoMock } }));
vi.mock('@/lib/ai/gemini-config', () => ({
  getGeminiApiKey: () => 'test-server-key',
  getGeminiBaseUrl: () => 'https://gemini.test/v1beta',
  getGeminiModel: geminiModelMock,
}));

const profile = {
  user_id: 'user-1',
  tenant_id: 'tenant-1',
  level: 'casual',
  available_time_minutes: 30,
  disliked_ingredients: [],
  allergies: ['peanuts'],
  household_members: [],
  created_at: '',
  updated_at: '',
};

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/today', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

type TodayOptionPayload = {
  title: string;
  slot: string;
  source: string;
  ingredients: string[];
  reason: string;
  availableIngredients: string[];
  missingIngredients: string[];
};

type TodayPayload = { status?: string; options: TodayOptionPayload[]; warnings?: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTodayPayload(value: unknown): TodayPayload {
  if (!isRecord(value) || (value.status !== undefined && typeof value.status !== 'string')) {
    throw new Error('Invalid today response');
  }
  const rawOptions = value.options ?? [];
  if (!Array.isArray(rawOptions)) throw new Error('Invalid today options');
  const parsedOptions = rawOptions.map((option): TodayOptionPayload => {
    if (
      !isRecord(option) ||
      typeof option.title !== 'string' ||
      typeof option.slot !== 'string' ||
      typeof option.source !== 'string' ||
      typeof option.reason !== 'string'
    ) {
      throw new Error('Invalid today option');
    }
    const parseStringArray = (field: unknown): string[] => {
      if (
        !Array.isArray(field) ||
        !field.every((item): item is string => typeof item === 'string')
      ) {
        throw new Error('Invalid today option ingredients');
      }
      return field;
    };
    return {
      title: option.title,
      slot: option.slot,
      source: option.source,
      reason: option.reason,
      ingredients: parseStringArray(option.ingredients),
      availableIngredients: parseStringArray(option.availableIngredients),
      missingIngredients: parseStringArray(option.missingIngredients),
    };
  });
  if (
    value.warnings !== undefined &&
    (!Array.isArray(value.warnings) ||
      !value.warnings.every((warning) => typeof warning === 'string'))
  ) {
    throw new Error('Invalid today warnings');
  }
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
    : undefined;
  return {
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
    options: parsedOptions,
    ...(warnings ? { warnings } : {}),
  };
}

async function readTodayPayload(response: Response): Promise<TodayPayload> {
  const payload: unknown = await response.json();
  return parseTodayPayload(payload);
}

function diagnosticText(): string {
  return JSON.stringify(serverLoggerInfoMock.mock.calls);
}

function fetchInit(): RequestInit {
  const init = fetchMock.mock.calls[0]?.[1];
  if (!init) throw new Error('Expected provider request init');
  return init;
}

function fetchBody(): string {
  const body = fetchInit().body;
  if (typeof body !== 'string') throw new Error('Expected serialized provider request body');
  return body;
}

function providerResponse(options: unknown[]): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ options }) }] } }],
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }
  );
}

const options = ['Rice bowl', 'Bean soup', 'Tomato pasta'].map((title) => ({
  title,
  slot: 'lunch',
  ingredients: ['rice', 'tomato'],
  prepMinutes: 20,
}));

describe('POST /api/today', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    requireUserMock.mockResolvedValue({ id: 'user-1', tenant: { tenantId: 'tenant-1' } });
    rateLimitMock.mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      resetAt: 1_800_000_060,
    });
    geminiModelMock.mockReturnValue('gemini-test');
    profileMock.mockResolvedValue(profile);
    termsMock.mockResolvedValue([]);
    inventoryMock.mockResolvedValue([
      {
        tenant_id: 'tenant-1',
        ingredient_name: 'rice',
        quantity: '2',
        unit: 'cups',
        expiration_date: null,
      },
    ]);
    historyMock.mockResolvedValue([]);
    planMock.mockResolvedValue(null);
    ragMock.mockResolvedValue({ context: '', citations: [], ragContextUsed: false });
    fetchMock.mockResolvedValue(providerResponse(options));
  });

  it('sends a supported responseSchema without additionalProperties constraints', async () => {
    const { POST } = await import('./route');

    await POST(request({ slot: 'lunch' }));

    const requestPayload = JSON.parse(fetchBody()) as {
      generationConfig: { responseSchema: Record<string, unknown> };
    };
    const schema = requestPayload.generationConfig.responseSchema;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const optionsSchema = properties.options;
    const itemSchema = optionsSchema.items as Record<string, unknown>;
    const itemProperties = itemSchema.properties as Record<string, Record<string, unknown>>;

    expect(schema).not.toHaveProperty('additionalProperties');
    expect(itemSchema).not.toHaveProperty('additionalProperties');
    expect(optionsSchema).toMatchObject({ minItems: 3, maxItems: 5 });
    expect(itemProperties.ingredients).toMatchObject({ minItems: 1, maxItems: 30 });
    expect(itemProperties.prepMinutes).toMatchObject({ minimum: 1, maximum: 240 });
  });

  it('rejects provider output with an extra root property', async () => {
    const { POST } = await import('./route');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify({ options, extra: true }) }] } },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const response = await POST(request({ slot: 'lunch' }));

    expect(await readTodayPayload(response)).toMatchObject({ status: 'degraded', options: [] });
    expect(diagnosticText()).toContain('local_validation_failed');
  });

  it('generates options with empty inventory and an unconfigured profile and emits only safe diagnostics', async () => {
    const { POST } = await import('./route');
    profileMock.mockResolvedValueOnce(null);
    inventoryMock.mockResolvedValueOnce([]);
    const sensitiveSentinels = ['user-1', 'tenant-1', 'test-server-key', 'Rice bowl', 'rice'];

    const response = await POST(request({ slot: 'lunch' }));
    const result = await readTodayPayload(response);
    const diagnostic = diagnosticText();

    expect(result).toMatchObject({ status: 'success', warnings: ['PROFILE_NOT_CONFIGURED'] });
    expect(result.options).toHaveLength(3);
    expect(inventoryMock).toHaveBeenCalled();
    expect(diagnostic).toContain('today_pipeline');
    expect(diagnostic).toContain('"generationOutcome":"success"');
    expect(diagnostic).toMatch(/"requestId":"[0-9a-f-]{36}"/i);
    expect(diagnostic).toContain('"slot":"lunch"');
    expect(diagnostic).toContain('"safeProviderCount":3');
    expect(diagnostic).toContain('"inventoryCount":0');
    expect(diagnostic).toContain('"profileConfigured":false');
    expect(diagnostic).toContain('"model":"gemini-test"');
    expect(diagnostic).toContain('"schemaId":"today_options"');
    expect(diagnostic).toContain('"schemaVersion":1');
    const [event, fields] = serverLoggerInfoMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('today_pipeline');
    expect(Object.keys(fields).sort()).toEqual([
      'fallbackOptionCount',
      'generationOutcome',
      'httpStatus',
      'httpStatusClass',
      'inventoryCount',
      'model',
      'profileConfigured',
      'providerOptionCount',
      'ragOutcome',
      'rankingOutcome',
      'requestId',
      'safeProviderCount',
      'schemaId',
      'schemaVersion',
      'slot',
    ]);
    expect(diagnostic).not.toContain('PROFILE_NOT_CONFIGURED');
    for (const sentinel of sensitiveSentinels) expect(diagnostic).not.toContain(sentinel);
  });

  it('logs custom for an invalid configured model identifier without exposing its value', async () => {
    const { POST } = await import('./route');
    geminiModelMock.mockReturnValueOnce('custom model secret sentinel');

    await POST(request({ slot: 'lunch' }));

    const diagnostic = diagnosticText();
    expect(diagnostic).toContain('"model":"custom"');
    expect(diagnostic).not.toContain('custom model secret sentinel');
  });

  it.each([
    ['http non-2xx', new Response('private body sentinel', { status: 429 }), 'http_non_2xx', '429'],
    ['empty HTTP 200 body', new Response(null, { status: 200 }), 'empty_response', '200'],
    [
      'invalid top-level JSON',
      new Response('private invalid JSON sentinel', { status: 200 }),
      'response_json_parse_error',
      '200',
    ],
    [
      'empty envelope',
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      'empty_envelope',
      '200',
    ],
    [
      'malformed envelope',
      new Response(JSON.stringify({ candidates: [{ content: {} }] }), { status: 200 }),
      'malformed_envelope',
      '200',
    ],
    [
      'empty parts',
      new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 }),
      'empty_parts',
      '200',
    ],
    [
      'malformed parts',
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 42 }] } }] }), {
        status: 200,
      }),
      'malformed_parts',
      '200',
    ],
    [
      'JSON parse',
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'private JSON sentinel' }] } }],
        }),
        { status: 200 }
      ),
      'json_parse_error',
      '200',
    ],
    [
      'local validation',
      providerResponse([{ ...options[0], title: '' }, ...options.slice(1)]),
      'local_validation_failed',
      '200',
    ],
  ])(
    'reports safe generation classification for %s',
    async (_label, providerReply, classification, status) => {
      const { POST } = await import('./route');
      fetchMock.mockResolvedValueOnce(providerReply);

      await POST(request({ slot: 'lunch' }));

      const diagnostic = diagnosticText();
      expect(diagnostic).toContain(classification);
      expect(diagnostic).toContain(status);
      if (classification === 'http_non_2xx')
        expect(diagnostic).toContain('"httpStatusClass":"4xx"');
      expect(diagnostic).not.toContain('private body sentinel');
      expect(diagnostic).not.toContain('private JSON sentinel');
      expect(diagnostic).not.toContain('private invalid JSON sentinel');
      expect(diagnostic).not.toContain('test-server-key');
    }
  );

  it('classifies external RAG AbortError and generation network failure without logging error details', async () => {
    const { POST } = await import('./route');
    ragMock.mockRejectedValueOnce(new DOMException('private RAG abort sentinel', 'AbortError'));
    fetchMock.mockRejectedValueOnce(new TypeError('private network sentinel'));

    await POST(request({ slot: 'lunch' }));

    const diagnostic = diagnosticText();
    expect(diagnostic).toContain('"ragOutcome":"unavailable_network"');
    expect(diagnostic).toContain('"generationOutcome":"network_error"');
    expect(diagnostic).not.toContain('private RAG abort sentinel');
    expect(diagnostic).not.toContain('private network sentinel');
  });

  it('returns rate-limit headers and short-circuits all Today data and provider work when limited', async () => {
    const { POST } = await import('./route');
    rateLimitMock.mockResolvedValueOnce({
      success: false,
      limit: 5,
      remaining: 0,
      resetAt: 1_800_000_060,
    });
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_055_000);

    try {
      const response = await POST(request({ slot: 'lunch' }));

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('5');
      expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(response.headers.get('X-RateLimit-Reset')).toBe('1800000060');
      expect(await response.json()).toMatchObject({ retryAfter: 5 });
      expect(rateLimitMock).toHaveBeenCalledWith('today', 'authenticated-user', 'user-1');
      expect(profileMock).not.toHaveBeenCalled();
      expect(termsMock).not.toHaveBeenCalled();
      expect(inventoryMock).not.toHaveBeenCalled();
      expect(historyMock).not.toHaveBeenCalled();
      expect(planMock).not.toHaveBeenCalled();
      expect(ragMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('keys the rate limit by authenticated user rather than forwarded client addresses', async () => {
    const { POST } = await import('./route');

    expect(
      (await POST(request({ slot: 'lunch' }, { 'x-forwarded-for': '198.51.100.10' }))).status
    ).toBe(200);
    expect(
      (await POST(request({ slot: 'lunch' }, { 'x-forwarded-for': '203.0.113.77, 10.0.0.2' })))
        .status
    ).toBe(200);

    expect(rateLimitMock).toHaveBeenCalledTimes(2);
    expect(rateLimitMock).toHaveBeenNthCalledWith(1, 'today', 'authenticated-user', 'user-1');
    expect(rateLimitMock).toHaveBeenNthCalledWith(2, 'today', 'authenticated-user', 'user-1');
  });

  it('authenticates before reads and requires a tenant', async () => {
    const { POST } = await import('./route');
    requireUserMock.mockRejectedValueOnce(new Error('no auth'));
    expect((await POST(request({ slot: 'lunch' }))).status).toBe(401);
    expect(profileMock).not.toHaveBeenCalled();
    requireUserMock.mockResolvedValueOnce({ id: 'user-1', tenant: null });
    expect((await POST(request({ slot: 'lunch' }))).status).toBe(401);
    expect(profileMock).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { slot: 'brunch' },
    { slot: 'lunch', userId: 'attacker' },
    { slot: 'lunch', tenantId: 'attacker' },
    { slot: 'lunch', profile: {} },
    { slot: 'lunch', extra: true },
  ])('rejects malformed or non-allowlisted body %j before reads', async (body) => {
    const { POST } = await import('./route');
    expect((await POST(request(body))).status).toBe(400);
    expect(profileMock).not.toHaveBeenCalled();
  });

  it.each(['breakfast', 'lunch', 'snack', 'dinner'] as const)(
    'accepts %s and only returns options for the selected slot',
    async (slot) => {
      const { POST } = await import('./route');
      const mealOptions = options.map((option) => ({ ...option, slot }));
      fetchMock.mockResolvedValueOnce(providerResponse(mealOptions));
      const response = await POST(request({ slot }));
      expect(response.status).toBe(200);
      const result = await readTodayPayload(response);
      expect(result.options).toHaveLength(3);
      expect(result.options.every((option: { slot: string }) => option.slot === slot)).toBe(true);
    }
  );

  it('returns safe provider options when the persisted profile maximum is 240 minutes', async () => {
    const { POST } = await import('./route');
    profileMock.mockResolvedValueOnce({ ...profile, available_time_minutes: 240 });

    const response = await POST(request({ slot: 'lunch' }));
    const result = await readTodayPayload(response);

    expect(response.status).toBe(200);
    expect(result).toMatchObject({ status: 'success' });
    expect(result.options).toHaveLength(3);
    expect(result.options.every((option) => !option.ingredients.includes('peanuts'))).toBe(true);
  });

  it('fails closed for an out-of-contract persisted profile maximum', async () => {
    const { POST } = await import('./route');
    profileMock.mockResolvedValueOnce({ ...profile, available_time_minutes: 241 });

    const response = await POST(request({ slot: 'lunch' }));

    expect(response.status).toBe(200);
    expect(await readTodayPayload(response)).toMatchObject({ status: 'degraded', options: [] });
  });

  it('fails closed when profile or terms cannot load and warns without a missing profile only when terms are empty', async () => {
    const { POST } = await import('./route');
    profileMock.mockResolvedValueOnce(null);
    const response = await POST(request({ slot: 'lunch' }));
    expect(response.status).toBe(200);
    expect(await readTodayPayload(response)).toMatchObject({
      warnings: ['PROFILE_NOT_CONFIGURED'],
    });
    profileMock.mockRejectedValueOnce(new Error('database detail'));
    expect((await POST(request({ slot: 'lunch' }))).status).toBe(503);
    profileMock.mockResolvedValueOnce(null);
    termsMock.mockResolvedValueOnce([
      { user_id: 'user-1', preference_type: 'avoid', term_label: 'peanuts' },
    ]);
    expect((await POST(request({ slot: 'lunch' }))).status).toBe(503);
    profileMock.mockResolvedValueOnce({ ...profile, user_id: 'other-user' });
    expect((await POST(request({ slot: 'lunch' }))).status).toBe(503);
  });

  it('scopes every repository read to authenticated user and tenant and keeps private context out of prompt', async () => {
    const { POST } = await import('./route');
    await POST(request({ slot: 'lunch' }));
    expect(profileMock).toHaveBeenCalledWith('user-1');
    expect(termsMock).toHaveBeenCalledWith('user-1');
    expect(inventoryMock).toHaveBeenCalledWith('tenant-1', expect.any(String), expect.any(Number));
    expect(historyMock).toHaveBeenCalledWith(
      'user-1',
      'tenant-1',
      expect.any(String),
      expect.any(Number)
    );
    expect(planMock).toHaveBeenCalledWith('user-1', 'tenant-1');
    const prompt = fetchBody();
    expect(prompt).not.toContain('user-1');
    expect(prompt).not.toContain('tenant-1');
    expect(prompt).not.toContain('citations');
    expect(new Headers(fetchInit().headers).get('x-goog-api-key')).toBe('test-server-key');
  });

  it.each([
    ['same tenant', 'tenant-1'],
    ['different tenant', 'tenant-2'],
  ])(
    'scopes every Today read for user B in the %s to session identity and tenant',
    async (_case, tenantId) => {
      const { POST } = await import('./route');
      const userB = { id: 'user-2', tenant: { tenantId } };
      const profileB = { ...profile, user_id: 'user-2', tenant_id: tenantId };
      requireUserMock.mockResolvedValueOnce(userB);
      profileMock.mockResolvedValueOnce(profileB);

      const response = await POST(request({ slot: 'lunch' }));

      expect(response.status).toBe(200);
      expect(profileMock).toHaveBeenCalledWith('user-2');
      expect(termsMock).toHaveBeenCalledWith('user-2');
      expect(inventoryMock).toHaveBeenCalledWith(tenantId, expect.any(String), expect.any(Number));
      expect(historyMock).toHaveBeenCalledWith(
        'user-2',
        tenantId,
        expect.any(String),
        expect.any(Number)
      );
      expect(planMock).toHaveBeenCalledWith('user-2', tenantId);
    }
  );

  it('ranks validated persisted fallback candidates and computes truthful source/reason/ingredient details', async () => {
    const { POST } = await import('./route');
    historyMock.mockResolvedValueOnce([
      {
        recipe_title: 'Saved safe lunch',
        created_at: '2026-01-01T00:00:00Z',
        recipe_payload: {
          slot: 'lunch',
          structuredIngredients: [
            { name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true },
            { name: 'beans', normalized_name: 'beans', quantity: 1, unit: 'cup', structured: true },
          ],
        },
      },
    ]);
    fetchMock.mockResolvedValueOnce(
      providerResponse([...options.slice(0, 2), { ...options[2], ingredients: ['peanuts'] }])
    );
    const result = await readTodayPayload(await POST(request({ slot: 'lunch' })));
    expect(result.status).toBe('degraded');
    expect(result.options).toHaveLength(3);
    const persisted = result.options.find(
      (option: { source: string }) => option.source === 'history'
    );
    expect(persisted).toMatchObject({
      title: 'Saved safe lunch',
      reason: 'Una opción de tu historial reciente.',
      availableIngredients: ['rice'],
      missingIngredients: ['beans'],
    });
    expect(
      result.options.every(
        (option: { ingredients: string[] }) => !option.ingredients.includes('peanuts')
      )
    ).toBe(true);
  });

  it('does not count a partial inventory-name match as available', async () => {
    const { POST } = await import('./route');
    const vinegarOptions = options.map((option) => ({ ...option, ingredients: ['rice vinegar'] }));
    fetchMock.mockResolvedValueOnce(providerResponse(vinegarOptions));

    const result = await readTodayPayload(await POST(request({ slot: 'lunch' })));

    expect(result.options).toHaveLength(3);
    expect(result.options[0]).toMatchObject({
      availableIngredients: [],
      missingIngredients: ['rice vinegar'],
      reason: 'Una opción para el horario elegido.',
    });
    expect(result.options[0].reason).not.toMatch(/inventario|disponibles/i);
  });

  it('matches normalized exact inventory names including supported plurals', async () => {
    const { POST } = await import('./route');
    inventoryMock.mockResolvedValueOnce([
      {
        tenant_id: 'tenant-1',
        ingredient_name: 'tomates',
        quantity: '2',
        unit: 'units',
        expiration_date: null,
      },
    ]);
    const tomatoOptions = options.map((option) => ({ ...option, ingredients: ['tomate'] }));
    fetchMock.mockResolvedValueOnce(providerResponse(tomatoOptions));

    const result = await readTodayPayload(await POST(request({ slot: 'lunch' })));

    expect(result.options).toHaveLength(3);
    expect(result.options[0]).toMatchObject({
      availableIngredients: ['tomate'],
      missingIngredients: [],
      reason: 'Aprovecha ingredientes disponibles en tu inventario.',
    });
  });

  it('uses plain RAG prose without metadata or citations and ignores provider-authored reasons', async () => {
    const { POST } = await import('./route');
    ragMock.mockResolvedValueOnce({
      context:
        '--- CONTEXTO DE RECETARIO CONFIABLE 1 (Libro: Private book · Página: 2) ---\\nRoast the vegetables.',
      citations: [{ id: 'private-citation-id' }],
      ragContextUsed: true,
    });
    fetchMock.mockResolvedValueOnce(providerResponse(options));
    const result = await readTodayPayload(await POST(request({ slot: 'lunch' })));
    expect(result.options.every((option) => option.reason !== 'I checked every allergy!')).toBe(
      true
    );
    const prompt: unknown = JSON.parse(fetchBody());
    if (
      !isRecord(prompt) ||
      !Array.isArray(prompt.contents) ||
      !isRecord(prompt.contents[0]) ||
      !Array.isArray(prompt.contents[0].parts) ||
      !isRecord(prompt.contents[0].parts[0]) ||
      typeof prompt.contents[0].parts[0].text !== 'string'
    )
      throw new Error('Invalid provider prompt');
    const promptText = prompt.contents[0].parts[0].text;
    expect(promptText).toContain('Roast the vegetables.');
    expect(promptText).not.toContain('Private book');
    expect(promptText).not.toContain('Página');
    expect(promptText).not.toContain('private-citation-id');
  });

  it('aborts a stalled optional RAG lookup after 60 seconds and still generates provider options', async () => {
    vi.useFakeTimers();
    try {
      const { POST } = await import('./route');
      ragMock.mockImplementationOnce(
        (input: { signal?: AbortSignal }) =>
          new Promise<never>((_, reject) => {
            const timeout = setTimeout(() => reject(new Error('mock RAG safety timeout')), 60_000);
            input.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timeout);
                reject(new DOMException('RAG request aborted', 'AbortError'));
              },
              { once: true }
            );
          })
      );

      const pending = POST(request({ slot: 'lunch' }));
      await vi.advanceTimersByTimeAsync(60_000);
      const response = await pending;
      const ragInput = ragMock.mock.calls[0]?.[0] as { signal?: AbortSignal } | undefined;

      expect(ragInput?.signal).toBeInstanceOf(AbortSignal);
      expect(ragInput?.signal?.aborted).toBe(true);
      expect(response.status).toBe(200);
      const payload = await readTodayPayload(response);
      expect(payload.status).toBe('success');
      expect(Array.isArray(payload.options)).toBe(true);
      expect(diagnosticText()).toContain('"ragOutcome":"unavailable_timeout"');
      expect(diagnosticText()).toContain('"generationOutcome":"success"');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts stalled Gemini generation after 60 seconds and falls back to safe history', async () => {
    vi.useFakeTimers();
    try {
      const { POST } = await import('./route');
      historyMock.mockResolvedValueOnce([
        {
          recipe_title: 'Safe timeout fallback',
          created_at: '2026-01-01T00:00:00Z',
          recipe_payload: {
            slot: 'lunch',
            structuredIngredients: [
              { name: 'rice', normalized_name: 'rice', quantity: 1, unit: 'cup', structured: true },
              {
                name: 'beans',
                normalized_name: 'beans',
                quantity: 1,
                unit: 'cup',
                structured: true,
              },
            ],
          },
        },
      ]);
      let providerSignal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce(
        (_input, init) =>
          new Promise((resolve, reject) => {
            providerSignal = init?.signal as AbortSignal | undefined;
            const timeout = setTimeout(() => resolve(providerResponse(options)), 60_000);
            providerSignal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timeout);
                reject(new DOMException('Gemini request aborted', 'AbortError'));
              },
              { once: true }
            );
          })
      );

      const pending = POST(request({ slot: 'lunch' }));
      await vi.advanceTimersByTimeAsync(60_000);
      const response = await pending;
      const payload = await readTodayPayload(response);

      expect(providerSignal).toBeInstanceOf(AbortSignal);
      expect(providerSignal?.aborted).toBe(true);
      expect(response.status).toBe(200);
      expect(payload).toMatchObject({ status: 'degraded' });
      expect(payload.options.map((option) => option.title)).toContain('Safe timeout fallback');
      expect(diagnosticText()).toContain('"generationOutcome":"timeout"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats RAG failure as optional and never claims unknown allergies were checked', async () => {
    const { POST } = await import('./route');
    profileMock.mockResolvedValueOnce(null);
    ragMock.mockRejectedValueOnce(new Error('private rag failure'));
    fetchMock.mockResolvedValueOnce(providerResponse(options));
    const response = await POST(request({ slot: 'lunch' }));
    const payload = await readTodayPayload(response);
    expect(response.status).toBe(200);
    expect(JSON.stringify(payload)).not.toMatch(/allerg(y|ies).{0,20}checked/i);
    expect(JSON.stringify(payload)).not.toContain('private rag failure');
  });

  it('degrades honestly for provider failures, malformed output, and fewer than three safe options without fabrication', async () => {
    const { POST } = await import('./route');
    fetchMock.mockResolvedValueOnce(new Response('private failure', { status: 500 }));
    let response = await POST(request({ slot: 'lunch' }));
    expect(await readTodayPayload(response)).toMatchObject({ status: 'degraded', options: [] });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 })
    );
    response = await POST(request({ slot: 'lunch' }));
    expect(await readTodayPayload(response)).toMatchObject({ status: 'degraded', options: [] });
    fetchMock.mockResolvedValueOnce(
      providerResponse([...options.slice(0, 2), { ...options[2], ingredients: ['peanuts'] }])
    );
    response = await POST(request({ slot: 'lunch' }));
    expect((await readTodayPayload(response)).status).toBe('degraded');
    expect(diagnosticText()).toContain('"safeProviderCount":2');
  });
});
