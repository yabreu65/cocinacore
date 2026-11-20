import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '@/lib/api';
import type { StructuredMealPlan } from '@/lib/meal-planner/structured-plan';
import ScheduleConfirmation from './ScheduleConfirmation';

const { hooks } = vi.hoisted(() => ({ hooks: { active: false, cursor: 0, values: [] as unknown[] } }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: ((...args: Parameters<typeof actual.useEffect>) => { if (!hooks.active) actual.useEffect(...args); else args[0](); }) as typeof actual.useEffect,
    useState<T>(initial: T | (() => T)): [T, (value: T | ((old: T) => T)) => void] {
      if (!hooks.active) return actual.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.values[index] as T, (value) => { hooks.values[index] = typeof value === 'function' ? (value as (old: T) => T)(hooks.values[index] as T) : value; }];
    },
    useRef<T>(initial: T) {
      if (!hooks.active) return actual.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = { current: initial };
      return hooks.values[index] as { current: T };
    },
  };
});
vi.mock('@/lib/api', () => ({ safeFetch: vi.fn() }));

const plan: StructuredMealPlan = { period: 'week', dayCount: 7, days: [{ dayIndex: 1, label: 'Lunes', meals: [{ mealType: 'lunch', title: 'Almuerzo', description: null, ingredients: [{ name: 'arroz', quantity: null, unit: null }] }] }] };
const schedule = { startDate: '2999-01-01', timeZone: 'UTC', confirmedAt: '2026-01-01T00:00:00Z', portionConfirmation: { peopleCount: 3, confirmedAt: '2026-01-01T00:00:00Z' } };
const onConfirmed = vi.fn();
function render(overrides: Partial<Parameters<typeof ScheduleConfirmation>[0]> = {}) {
  hooks.cursor = 0;
  return ScheduleConfirmation({ plan, mealPlanId: 'old', peopleCount: 3, disabled: false, onConfirmed, ...overrides });
}
function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (predicate(node)) return node;
  const children = node.props.children as ReactNode;
  for (const child of Array.isArray(children) ? children as ReactNode[] : [children]) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
function input(tree: ReactNode, type: string) { return find(tree, (n) => n.type === 'input' && n.props.type === type)!; }
function change(node: ReactElement<Record<string, unknown>>, target: object) { (node.props.onChange as (e: object) => void)({ target }); }
async function submit(tree: ReactNode) { await (find(tree, (n) => n.type === 'form')!.props.onSubmit as (e: object) => Promise<void>)({ preventDefault() {} }); }

beforeEach(() => { hooks.active = true; hooks.values = []; vi.mocked(safeFetch).mockReset(); onConfirmed.mockReset(); });
describe('ScheduleConfirmation', () => {
  it('requires an explicit checkbox and date; warns about unknown ingredients and uses persisted people', async () => {
    const tree = render();
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain('1. Confirmar fecha y porciones');
    expect(markup).toContain('3 comensales');
    const checkboxLabel = find(tree, (node) => node.type === 'label' && Boolean(input(node, 'checkbox')));
    expect(checkboxLabel).toBeDefined();
    expect(renderToStaticMarkup(checkboxLabel)).not.toMatch(/comensales/i);
    expect(markup).toContain('no se puede calcular su compra exacta');
    expect(markup).toContain('Zona horaria:');
    await submit(tree);
    expect(safeFetch).not.toHaveBeenCalled();
    change(input(tree, 'date'), { value: '2000-01-01' });
    change(input(tree, 'checkbox'), { checked: true });
    await submit(render());
    expect(renderToStaticMarkup(render())).toContain('hoy o futura');
    expect(safeFetch).not.toHaveBeenCalled();
  });
  it('shows the confirmed state without another form', () => {
    const markup = renderToStaticMarkup(render({ plan: { ...plan, schedule } }));
    expect(markup).toContain('Agenda confirmada');
    expect(markup).not.toContain('<form');
  });
  it('posts once on explicit confirmation, and propagates the server schedule', async () => {
    const initial = render();
    change(input(initial, 'date'), { value: '2999-01-01' });
    change(input(initial, 'checkbox'), { checked: true });
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: { mealPlanId: 'old', schedule } });
    await submit(render());
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((vi.mocked(safeFetch).mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ mealPlanId: 'old', confirmed: true, portionBasisConfirmed: true });
    expect(onConfirmed).toHaveBeenCalledWith('old', plan, schedule);
  });
  it('shows a 409 without reporting success', async () => {
    const initial = render();
    change(input(initial, 'date'), { value: '2999-01-01' });
    change(input(initial, 'checkbox'), { checked: true });
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: false, status: 409, error: 'El menú cambió.' });
    await submit(render());
    expect(renderToStaticMarkup(render())).toContain('El menú cambió.');
    expect(onConfirmed).not.toHaveBeenCalled();
  });
  it('ignores a late response after the displayed plan changes and blocks double submit', async () => {
    const initial = render();
    change(input(initial, 'date'), { value: '2999-01-01' });
    change(input(initial, 'checkbox'), { checked: true });
    let resolve!: (value: { ok: true; data: { mealPlanId: string; schedule: typeof schedule } }) => void;
    vi.mocked(safeFetch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const tree = render();
    const first = submit(tree);
    await submit(tree);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    render({ mealPlanId: 'new', plan: { ...plan } });
    resolve({ ok: true, data: { mealPlanId: 'old', schedule } });
    await first;
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});


it('places schedule confirmation inside the saved plan before adaptation, meals and shopping', () => {
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  const heading = page.indexOf('>Menú generado</h2>');
  const schedule = page.indexOf('<ScheduleConfirmation', heading);
  const adaptation = page.indexOf('>Adaptar menú con evidencia</h3>', heading);
  const meals = page.indexOf('{plan.days.map(', heading);
  const shopping = page.indexOf('>Compras anticipadas</h2>', heading);
  expect(heading).toBeGreaterThan(-1);
  expect(schedule).toBeGreaterThan(heading);
  expect(adaptation).toBeGreaterThan(schedule);
  expect(meals).toBeGreaterThan(adaptation);
  expect(shopping).toBeGreaterThan(meals);
  expect(page.slice(heading, schedule)).not.toContain(') : null}');
});
