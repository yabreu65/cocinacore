import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { safeFetch } from '@/lib/api';
import { RecipeEditor, type Draft } from '../recipes/RecipeLibraryClient';
import { renderRecipeDisplay } from '@/lib/recipes/recipe-import';
import type { StructuredMeal } from '@/lib/meal-planner/structured-plan';
import MealPreparationAction from './MealPreparationAction';

const { hooks } = vi.hoisted(() => ({ hooks: { active: false, cursor: 0, values: [] as unknown[] } }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)): [T, (value: T | ((old: T) => T)) => void] {
      if (!hooks.active) return actual.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.values[index] as T, (value) => {
        hooks.values[index] = typeof value === 'function' ? (value as (old: T) => T)(hooks.values[index] as T) : value;
      }];
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
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

const meal: StructuredMeal = {
  mealType: 'lunch',
  title: 'Pabellón criollo',
  description: 'Plato tradicional',
  prepMinutes: 55,
  ingredients: [
    { name: 'Carne de res', quantity: 400, unit: 'g' },
    { name: 'Arroz', quantity: 200, unit: 'g' },
    { name: 'Caraotas negras', quantity: null, unit: null },
  ],
};

function renderAction(overrides: Partial<Parameters<typeof MealPreparationAction>[0]> = {}): ReactNode {
  hooks.cursor = 0;
  return MealPreparationAction({ meal, peopleCount: 4, hardRestrictions: [], ...overrides });
}

function findNode(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (predicate(node)) return node;
  const children = node.props.children as ReactNode;
  for (const child of Array.isArray(children) ? children as ReactNode[] : [children]) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return undefined;
}

beforeEach(() => {
  vi.mocked(safeFetch).mockReset();
  hooks.values = [];
  hooks.active = false;
});

describe('MealPreparationAction', () => {
  it('does not spend AI calls, mark meals cooked or save recipes when displayed', () => {
    const html = renderToStaticMarkup(createElement(MealPreparationAction, { meal, peopleCount: 4, hardRestrictions: [] }));
    expect(html).toContain('Ver preparación');
    expect(html).not.toContain('PREPARACIÓN');
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('uses the already linked recipe without generating another one', () => {
    const linked: StructuredMeal = {
      ...meal,
      recipeRef: { recipeId: '00000000-0000-4000-8000-000000000001', versionId: '00000000-0000-4000-8000-000000000002' },
    };
    const html = renderToStaticMarkup(createElement(MealPreparationAction, { meal: linked, peopleCount: 4, hardRestrictions: [] }));
    expect(html).toContain('href="/recipes/00000000-0000-4000-8000-000000000001"');
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('requests only the selected dish with plan portions and hard restrictions, then shows steps inline', async () => {
    hooks.active = true;
    try {
      vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: {
        title: 'Pabellón criollo', recipe: 'Pabellón criollo\nPREPARACIÓN\nCocer caraotas.',
        preparation: '1. Cocer las caraotas.\n2. Preparar el arroz.',
        recipeHistoryId: 'history-1', servings: 6, structuredIngredients: [],
      } });
      const initial = renderAction({ peopleCount: 6, hardRestrictions: ['Sin gluten'] });
      const button = findNode(initial, (node) => node.type === 'button' && node.props.children === 'Ver preparación');
      expect(button).toBeDefined();
      await (button?.props.onClick as () => Promise<void>)();
      expect(safeFetch).toHaveBeenCalledTimes(1);
      const [url, init] = vi.mocked(safeFetch).mock.calls[0];
      expect(url).toBe('/api/recipe-generate');
      expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
      expect(JSON.parse(String(init?.body)) as unknown).toMatchObject({
        mode: 'free', recipeName: 'Pabellón criollo', peopleCount: 6, mealType: 'Almuerzo',
        ingredients: ['Carne de res', 'Arroz', 'Caraotas negras'],
        culinaryProfile: { avoid: ['Sin gluten'] },
      });
      const loaded = renderAction({ peopleCount: 6, hardRestrictions: ['Sin gluten'] });
      expect(findNode(loaded, (node) => node.props['aria-label'] === 'Preparación de Pabellón criollo')).toBeDefined();
      expect(findNode(loaded, (node) => node.props.children === '1. Cocer las caraotas.\n2. Preparar el arroz.')).toBeDefined();
      const toggle = findNode(loaded, (node) => node.type === 'button' && node.props.children === 'Ocultar preparación');
      (toggle?.props.onClick as () => void)();
      renderAction({ peopleCount: 6, hardRestrictions: ['Sin gluten'] });
      const reopen = findNode(renderAction({ peopleCount: 6, hardRestrictions: ['Sin gluten'] }), (node) => node.type === 'button' && node.props.children === 'Ver preparación');
      (reopen?.props.onClick as () => void)();
      expect(safeFetch).toHaveBeenCalledTimes(1);
    } finally { hooks.active = false; }
  });

  it('requires reviewed editing before saving and reuses the existing recipe import endpoint', async () => {
    hooks.active = true;
    try {
      vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: {
        title: 'Pabellón criollo', recipe: renderRecipeDisplay('Pabellón criollo', [{ name: 'Arroz', quantity: '200', unit: 'g' }], 'Cocinar arroz.'), preparation: 'Cocinar arroz.',
        recipeHistoryId: 'history-1', servings: 4,
        structuredIngredients: [{ name: 'Arroz', normalized_name: 'arroz', quantity: 200, unit: 'g', optional_quantity_text: null, category: null, estimated_cost_optional: null, structured: true }],
      } });
      const start = findNode(renderAction(), (node) => node.type === 'button' && node.props.children === 'Ver preparación');
      await (start?.props.onClick as () => Promise<void>)();
      const open = findNode(renderAction(), (node) => node.type === 'button' && node.props.children === 'Guardar en Mis recetas');
      (open?.props.onClick as () => void)();
      const review = findNode(renderAction(), (node) => node.type === RecipeEditor);
      expect(review).toBeDefined();
      const draft = review?.props.initial as Draft;
      expect(draft.instructions).toBe('Cocinar arroz.');
      expect(draft.ingredients).toEqual([{ name: 'Arroz', quantity: '200', unit: 'g' }]);
      vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: { recipe: { id: 'saved-1' } } });
      (review?.props.onSave as (draft: Draft) => void)(draft);
      await vi.waitFor(() => expect(safeFetch).toHaveBeenCalledTimes(2));
      const [url, init] = vi.mocked(safeFetch).mock.calls[1];
      expect(url).toBe('/api/recipes');
      expect(JSON.parse(String(init?.body)) as unknown).toMatchObject({
        sourceRecipeHistoryId: 'history-1', instructions: 'Cocinar arroz.', ingredients: [{ name: 'Arroz', quantity: '200' }],
      });
      await vi.waitFor(() => expect(findNode(renderAction(), (node) => node.props.href === '/recipes/saved-1')).toBeDefined());
      expect(safeFetch).toHaveBeenCalledTimes(2);
    } finally { hooks.active = false; }
  });

  it('refuses oversized restriction snapshots without calling Gemini or dropping exclusions', async () => {
    hooks.active = true;
    try {
      const button = findNode(renderAction({ hardRestrictions: Array.from({ length: 11 }, (_, i) => `Evitar ${i}`) }), (node) => node.type === 'button');
      await (button?.props.onClick as () => Promise<void>)();
      const invalid = renderAction({ hardRestrictions: Array.from({ length: 11 }, (_, i) => `Evitar ${i}`) });
      expect(findNode(invalid, (node) => node.props.role === 'alert')).toBeDefined();
      expect(safeFetch).not.toHaveBeenCalled();
    } finally { hooks.active = false; }
  });

  it('renders provider errors in the card without marking the meal cooked', async () => {
    hooks.active = true;
    try {
      vi.mocked(safeFetch).mockResolvedValueOnce({ ok: false, status: 503, error: 'Proveedor temporalmente ocupado.' });
      const button = findNode(renderAction(), (node) => node.type === 'button');
      await (button?.props.onClick as () => Promise<void>)();
      const failed = renderAction();
      expect(findNode(failed, (node) => node.props.children === 'Proveedor temporalmente ocupado.')).toBeDefined();
      expect(safeFetch).toHaveBeenCalledTimes(1);
    } finally { hooks.active = false; }
  });
});
