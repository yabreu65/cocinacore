import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, PUT } from './route';
import type { QuantityReviewItem } from '@/lib/meal-planner/quantity-review';
type Proposal = { expectedUpdatedAt: string; fingerprint: string; items: QuantityReviewItem[] };
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
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: row.calendar_payload.days.filter(day => day.dayIndex === 1).flatMap(day => day.meals.map(meal => ({ dayIndex: day.dayIndex, mealType: meal.mealType, ingredientIndex: 0, name: 'Rice', quantity: 100, unit: 'g' }))) }) }] } }] })));
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
    expect(proposal.items).toHaveLength(3);
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
  it('prepares only the selected day and rejects cross-day or duplicate output', async () => {
    mocks.fetch.mockImplementationOnce(async (_url: string, options: RequestInit) => {
      const payload = JSON.parse(options.body as string) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = payload.contents[0].parts[0].text;
      expect(prompt).toContain('TOTALES para 4 personas');
      const menuJson = prompt.split('Menú: ')[1]?.split('. Pendientes: ')[0];
      expect(menuJson).toBeDefined();
      const days = JSON.parse(menuJson!) as Array<{ dayIndex: number }>;
      expect(days.map(day => day.dayIndex)).toEqual([2]);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: row.calendar_payload.days[1].meals.map(meal => ({ dayIndex: 2, mealType: meal.mealType, ingredientIndex: 0, name: 'Rice', quantity: 70, unit: 'g' })) }) }] } }] }));
    });
    const response = await POST(request('POST', { mealPlanId: id, dayIndex: 2 }));
    expect(response.status).toBe(200);
    const proposal = await response.json() as Proposal;
    expect(proposal.items).toHaveLength(3);
    expect(proposal.items.every(item => item.dayIndex === 2)).toBe(true);
    expect((await POST(request('POST', { mealPlanId: id, dayIndex: 8 }))).status).toBe(400);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: row.calendar_payload.days[0].meals.map(meal => ({ dayIndex: 1, mealType: meal.mealType, ingredientIndex: 0, name: 'Rice', quantity: 70, unit: 'g' })) }) }] } }] })));
    expect((await POST(request('POST', { mealPlanId: id, dayIndex: 2 }))).status).toBe(502);
    row.calendar_payload.days[1].meals.forEach(meal => { meal.ingredients[0] = { name: 'Rice', quantity: 5, unit: 'kg' }; });
    expect((await POST(request('POST', { mealPlanId: id, dayIndex: 2 }))).status).toBe(409);
  });
  it('returns distinct errors when the shared limiter or Gemini is unavailable', async () => {
    mocks.limit.mockResolvedValueOnce({ success: false, storage: 'unavailable' });
    const limiter = await POST(request('POST', { mealPlanId: id }));
    expect(limiter.status).toBe(503);
    expect(((await limiter.json()) as { error: string }).error).toContain('servicio de solicitudes');
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
    const gemini = await POST(request('POST', { mealPlanId: id }));
    expect(gemini.status).toBe(503);
    expect(((await gemini.json()) as { error: string }).error).toContain('Gemini');
    mocks.source.mockRejectedValueOnce(new Error('internal database error'));
    const source = await POST(request('POST', { mealPlanId: id }));
    expect(source.status).toBe(503);
    expect(((await source.json()) as { error: string }).error).toContain('menú guardado');
  });
  it('bounds request and provider response bodies even without Content-Length', async () => {
    expect((await POST(request('POST', { mealPlanId: id, oversized: 'x'.repeat(100001) }))).status).toBe(400);
    mocks.fetch.mockResolvedValue(new Response('x'.repeat(150001)));
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(502);
  });
  it('does not retry provider overload and rejects a changed restriction', async () => {
    for (const status of [429, 503]) {
      mocks.fetch.mockResolvedValueOnce(new Response('', { status }));
      expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(status);
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    mocks.source.mockImplementation(async (_scope: unknown, _id: unknown, action: Action) => action({ query }, row, ['peanuts']));
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(409);
  });
  it('rejects an old provider result when the plan changes during the call', async () => {
    mocks.fetch.mockImplementationOnce(async () => {
      row.updated_at = '2026-11-20T00:01:00.000Z';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: row.calendar_payload.days.filter(day => day.dayIndex === 1).flatMap(day => day.meals.map(meal => ({ dayIndex: day.dayIndex, mealType: meal.mealType, ingredientIndex: 0, name: 'Rice', quantity: 100, unit: 'g' }))) }) }] } }] }));
    });
    expect((await POST(request('POST', { mealPlanId: id }))).status).toBe(409);
  });
  it('accepts equivalent timestamp representations and rejects different instants', async () => {
    mocks.fetch.mockImplementationOnce(async () => {
      row.updated_at = '2026-11-19 20:00:00-04';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: row.calendar_payload.days.filter(day => day.dayIndex === 1).flatMap(day => day.meals.map(meal => ({ dayIndex: day.dayIndex, mealType: meal.mealType, ingredientIndex: 0, name: 'Rice', quantity: 100, unit: 'g' }))) }) }] } }] }));
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
