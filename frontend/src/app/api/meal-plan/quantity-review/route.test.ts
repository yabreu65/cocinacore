import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, PUT } from './route';
import type { QuantityReviewItem } from '@/lib/meal-planner/quantity-review';
type Proposal = { expectedUpdatedAt: string; fingerprint: string; items: QuantityReviewItem[]; unavailableDays: number[] };
type Action = (client: { query: typeof query }, planRow: PlanRow, restrictions: string[]) => Promise<unknown>;

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), source: vi.fn(), limit: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/mealPlanRepository', () => ({ withQuantityReviewSource: mocks.source }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.limit }));
vi.mock('@/lib/ai/gemini-config', () => ({ getGeminiApiKey: () => 'test', getGeminiModel: () => 'model', getGeminiBaseUrl: () => 'https://example.test' }));
const id = '11111111-1111-4111-8111-111111111111';
const calendar = () => ({ period: 'week', dayCount: 7, schedule: { startDate: '2026-11-21', timeZone: 'UTC', confirmedAt: '2026-11-20T00:00:00.000Z', portionConfirmation: { peopleCount: 4, confirmedAt: '2026-11-20T00:00:00.000Z' } }, days: Array.from({ length: 7 }, (_, i) => ({ dayIndex: i + 1, meals: ['breakfast', 'lunch', 'dinner'].map(mealType => ({ mealType, title: 'Dish', description: null, prepMinutes: 10, ingredients: [{ name: 'Rice', quantity: null as number | null, unit: null as string | null }] })) })) });
const request = (method: string, body: unknown) => new NextRequest('http://localhost/api/meal-plan/quantity-review', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
type PlanRow = { id: string; user_id: string; tenant_id: string; updated_at: string; period: string; people_count: number; restrictions: string[]; calendar_payload: ReturnType<typeof calendar> };
let row: PlanRow;
let query: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  row = { id, user_id: 'user', tenant_id: 'tenant', updated_at: '2026-11-20T00:00:00.000Z', period: 'week', people_count: 4, restrictions: [], calendar_payload: calendar() };
  query = vi.fn().mockResolvedValue({ rows: [row] });
  mocks.requireUser.mockResolvedValue({ id: 'user', tenant: { tenantId: 'tenant' } });
  mocks.source.mockImplementation(async (_scope: unknown, _id: unknown, action: Action) => action({ query }, row, []));
  mocks.limit.mockResolvedValue({ success: true });
  mocks.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    const input = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const prompt = input.contents[0].parts[0].text;
    const missing = JSON.parse(prompt.slice(prompt.indexOf('Pendientes: ') + 'Pendientes: '.length)) as Array<{ dayIndex: number; mealType: string; ingredientIndex: number; name: string }>;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: missing.map(item => ({ ...item, quantity: 100, unit: 'g' })) }) }] } }] }));
  });
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('quantity review route', () => {
  it('requires authentication and does not call the provider', async () => {
    mocks.requireUser.mockRejectedValue(new Error());
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('requires confirmed schedule and handles missing scoped plan', async () => {
    row.calendar_payload.schedule.portionConfirmation.peopleCount = 3;
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(409);
    mocks.source.mockResolvedValue(null);
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('proposes totals for stored people and saves only explicitly selected entries', async () => {
    const response = await POST(request('POST', { mealPlanId: id }));
    expect(response.status).toBe(200);
    const proposal = await response.json() as Proposal;
    expect(proposal.items).toHaveLength(21);
    expect(mocks.fetch).toHaveBeenCalledTimes(7);
    expect((mocks.fetch.mock.calls[0][1] as RequestInit).body).toContain('TOTALES para 4 personas');
    expect(query).not.toHaveBeenCalled();
    const confirmation = await PUT(request('PUT', { mealPlanId: id, expectedUpdatedAt: proposal.expectedUpdatedAt, fingerprint: proposal.fingerprint, items: [proposal.items[0]] }));
    expect(confirmation.status).toBe(200);
    const payload = JSON.parse((query.mock.calls[0][1] as string[])[0]) as ReturnType<typeof calendar>;
    expect(payload.days[0].meals[0].ingredients[0]).toEqual({ name: 'Rice', quantity: 100, unit: 'g' });
    expect(payload.days[0].meals[1].ingredients[0].quantity).toBeNull();
    expect(payload.schedule).toEqual(row.calendar_payload.schedule);
  });
  it('retains partial known quantity and original unit spelling', async () => {
    row.calendar_payload.days[0].meals[0].ingredients[0] = { name: 'Rice', quantity: 100, unit: null };
    row.calendar_payload.days[0].meals[1].ingredients[0] = { name: 'Rice', quantity: null, unit: 'gramos' };
    const response = await POST(request('POST', { mealPlanId: id }));
    const proposal = await response.json() as Proposal;
    const confirmation = await PUT(request('PUT', { mealPlanId: id, expectedUpdatedAt: proposal.expectedUpdatedAt, fingerprint: proposal.fingerprint, items: proposal.items.slice(0, 2) }));
    expect(confirmation.status).toBe(200);
    const payload = JSON.parse((query.mock.calls[0][1] as string[])[0]) as ReturnType<typeof calendar>;
    expect(payload.days[0].meals[0].ingredients[0]).toEqual({ name: 'Rice', quantity: 100, unit: 'g' });
    expect(payload.days[0].meals[1].ingredients[0]).toEqual({ name: 'Rice', quantity: 100, unit: 'gramos' });
  });
  it('estimates 223 missing entries in bounded day batches without changing saved data', async () => {
    let ingredientCounter = 0;
    for (const day of row.calendar_payload.days) {
      for (const meal of day.meals) {
        const count = ingredientCounter < 13 * 11 ? 11 : 10;
        meal.ingredients = Array.from({ length: count }, () => {
          const ingredient = { name: `Synthetic ingredient ${++ingredientCounter}`, quantity: null, unit: null };
          return ingredient;
        });
      }
    }
    // 13 meals with 11 ingredients, 8 meals with 10 => 223.
    expect(ingredientCounter).toBe(223);
    const result = await POST(request('POST', { mealPlanId: id }));
    expect(result.status).toBe(200);
    const proposal = await result.json() as Proposal;
    expect(proposal.items).toHaveLength(223);
    expect(mocks.fetch).toHaveBeenCalledTimes(7);
    const groups = mocks.fetch.mock.calls.map((call) => {
      const init = call[1] as RequestInit;
      const payload = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = payload.contents[0].parts[0].text;
      const missing = JSON.parse(prompt.slice(prompt.indexOf('Pendientes: ') + 'Pendientes: '.length)) as Array<{ dayIndex: number }>;
      expect(prompt).toContain('TOTALES para 4 personas');
      expect(missing.length).toBeLessThanOrEqual(33);
      expect(new Set(missing.map(item => item.dayIndex)).size).toBe(1);
      return missing[0].dayIndex;
    });
    expect([...groups].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps unsupported Gemini units unconfirmed while preserving other day entries', async () => {
    const original = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const response = await original(url, init) as Response;
      const envelope = await response.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      const content = JSON.parse(envelope.candidates[0].content.parts[0].text) as { items: Array<{ unit: string | null; quantity: number | null }> };
      content.items[0].unit = 'pizca-no-normalizable';
      envelope.candidates[0].content.parts[0].text = JSON.stringify(content);
      return new Response(JSON.stringify(envelope));
    });
    const response = await POST(request('POST', { mealPlanId: id }));
    expect(response.status).toBe(200);
    const proposal = await response.json() as Proposal;
    expect(proposal.items).toHaveLength(21);
    expect(proposal.items.filter(item => item.quantity === null && item.unit === null)).toHaveLength(7);
    expect(proposal.items.filter(item => item.quantity === 100 && item.unit === 'g')).toHaveLength(14);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps other days after Gemini returns 503 and unreadable JSON for two batches', async () => {
    const defaultProvider = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = payload.contents[0].parts[0].text;
      const missing = JSON.parse(prompt.slice(prompt.indexOf('Pendientes: ') + 'Pendientes: '.length)) as Array<{ dayIndex: number }>;
      if (missing[0].dayIndex === 3) return new Response('', { status: 503 });
      if (missing[0].dayIndex === 4) return new Response('{malformed');
      return defaultProvider(url, init) as Promise<Response>;
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await POST(request('POST', { mealPlanId: id }));
      expect(response.status).toBe(200);
      const proposal = await response.json() as Proposal;
      expect(proposal.unavailableDays).toEqual([3, 4]);
      expect(proposal.items).toHaveLength(21);
      expect(proposal.items.filter(item => [3, 4].includes(item.dayIndex))).toHaveLength(6);
      expect(proposal.items.filter(item => [3, 4].includes(item.dayIndex)).every(item => item.quantity === null && item.unit === null)).toBe(true);
      expect(proposal.items.filter(item => ![3, 4].includes(item.dayIndex)).every(item => item.quantity === 100 && item.unit === 'g')).toBe(true);
      expect(mocks.fetch).toHaveBeenCalledTimes(7);
      expect(warning).toHaveBeenCalledWith('quantity_review.provider_failed', expect.objectContaining({ code: 'provider_http', upstreamStatus: 503, batch: 3 }));
      expect(warning).toHaveBeenCalledWith('quantity_review.provider_failed', expect.objectContaining({ code: 'provider_invalid_response', batch: 4 }));
      expect(query).not.toHaveBeenCalled();
      const valid = proposal.items.filter(item => item.quantity !== null);
      const confirmation = await PUT(request('PUT', { mealPlanId: id, expectedUpdatedAt: proposal.expectedUpdatedAt, fingerprint: proposal.fingerprint, items: valid }));
      expect(confirmation.status).toBe(200);
      const payload = JSON.parse((query.mock.calls[0][1] as string[])[0]) as ReturnType<typeof calendar>;
      expect(payload.days[2].meals[0].ingredients[0].quantity).toBeNull();
      expect(payload.days[3].meals[0].ingredients[0].quantity).toBeNull();
      expect(payload.days[0].meals[0].ingredients[0].quantity).toBe(100);
      expect(payload.days[6].meals[2].ingredients[0].quantity).toBe(100);
    } finally { warning.mockRestore(); }
  });
  it('reports provider outage when all seven days are unavailable; no fake complete proposal', async () => {
    mocks.fetch.mockResolvedValue(new Response('', { status: 503 }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await POST(request('POST', { mealPlanId: id }));
      expect(response.status).toBe(503);
      expect((await response.json() as { error: string }).error).toMatch(/no está disponible/);
      expect(mocks.fetch).toHaveBeenCalledTimes(7);
      expect(query).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it('rejects invalid day identities without returning partial estimates or writing data', async () => {
    const defaultProvider = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = payload.contents[0].parts[0].text;
      if (prompt.includes('"dayIndex":3')) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ dayIndex: 3, mealType: 'breakfast', ingredientIndex: 0, name: 'FORGED INGREDIENT', quantity: 100, unit: 'g' }] }) }] } }] }));
      }
      return (await defaultProvider(url, init)) as Response;
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await POST(request('POST', { mealPlanId: id }));
      expect(response.status).toBe(502);
      expect(mocks.fetch.mock.calls.length).toBeLessThanOrEqual(7);
      expect(query).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith('quantity_review.provider_failed', expect.objectContaining({ code: 'provider_invalid_items' }));
    } finally { warning.mockRestore(); }
  });

  it('returns an explicit 504 for a slow provider without writing anything', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(() => new Promise<Response>(() => {}));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = POST(request('POST', { mealPlanId: id }));
      await vi.advanceTimersByTimeAsync(45001);
      const response = await result;
      expect(response.status).toBe(504);
      expect((await response.json() as { error: string }).error).toMatch(/tardó demasiado/);
      expect(query).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith('quantity_review.provider_failed', expect.objectContaining({ code: 'provider_timeout' }));
    } finally {
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not retry a batch when the provider returns 429', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 429 }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await POST(request('POST', { mealPlanId: id }));
      expect(response.status).toBe(429);
      const payload = await response.json() as { error: string };
      expect(payload.error).toMatch(/límite de solicitudes/);
      expect(mocks.fetch.mock.calls.length).toBeLessThanOrEqual(2);
      expect(query).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it('bounds request and provider response bodies even without Content-Length', async () => {
    expect((await POST(request('POST', { mealPlanId: id, oversized: 'x'.repeat(100001) }))).status).toBe(400);
    mocks.fetch.mockResolvedValue(new Response('x'.repeat(150001)));
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(502);
  });
  it('preserves 429 as fatal, degrades a 503 day without retry and rejects changed restrictions', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 429 }));
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(429);
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
    const response = await POST(request('POST', { mealPlanId: id }));
    expect(response.status).toBe(200);
    const proposal = await response.json() as Proposal;
    expect(proposal.unavailableDays).toHaveLength(1);
    expect(mocks.fetch.mock.calls.length).toBeLessThanOrEqual(9);
    expect(query).not.toHaveBeenCalled();
    mocks.source.mockImplementation(async (_scope: unknown, _id: unknown, action: Action) => action({ query }, row, ['peanuts']));
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(409);
  });
  it('rejects an old provider result when the plan changes during the call', async () => {
    mocks.fetch.mockImplementationOnce(async () => {
      row.updated_at = '2026-11-20T00:01:00.000Z';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: row.calendar_payload.days[0].meals.map(meal => ({ dayIndex: 1, mealType: meal.mealType, ingredientIndex: 0, name: 'Rice', quantity: 100, unit: 'g' })) }) }] } }] }));
    });
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(409);
  });
  it('accepts equivalent timestamp representations and rejects different instants', async () => {
    mocks.fetch.mockImplementationOnce(async () => {
      row.updated_at = '2026-11-19 20:00:00-04';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: row.calendar_payload.days[0].meals.map(meal => ({ dayIndex: 1, mealType: meal.mealType, ingredientIndex: 0, name: 'Rice', quantity: 100, unit: 'g' })) }) }] } }] }));
    });
    const response = await POST(request('POST', { mealPlanId: id }));
    expect(response.status).toBe(200);
    const proposal = await response.json() as Proposal;
    const body = { mealPlanId: id, expectedUpdatedAt: proposal.expectedUpdatedAt, fingerprint: proposal.fingerprint, items: [proposal.items[0]] };
    expect((await PUT(request('PUT', body))).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect((query.mock.calls[0][0] as string)).toContain('updated_at = $5::timestamptz and calendar_payload = $6::jsonb');
    row.updated_at = '2026-11-20T00:00:00.000001Z';
    expect((await PUT(request('PUT', body))).status).toBe(409);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('returns conflict if conditional update loses a race', async () => {
    const response = await POST(request('POST', { mealPlanId: id }));
    const proposal = await response.json() as Proposal;
    query.mockResolvedValueOnce({ rows: [] });
    expect((await PUT(request('PUT', { mealPlanId: id, expectedUpdatedAt: proposal.expectedUpdatedAt, fingerprint: proposal.fingerprint, items: [proposal.items[0]] }))).status).toBe(409);
  });
  it('rejects stale confirmation and forged provider identities', async () => {
    const response = await POST(request('POST', { mealPlanId: id }));
    const proposal = await response.json() as Proposal;
    row.people_count = 3;
    expect((await PUT(request('PUT', { mealPlanId: id, expectedUpdatedAt: proposal.expectedUpdatedAt, fingerprint: proposal.fingerprint, items: [proposal.items[0]] }))).status).toBe(409);
    expect(query).not.toHaveBeenCalled();
    row.people_count = 4;
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ ...proposal.items[0], name: 'Fake' }] }) }] } }] })));
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(502);
  });
});
