import { createElement, isValidElement, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecipeSearchPage from './page';
import { RecipeEditor, type Draft } from '../RecipeLibraryClient';
import { safeFetch } from '@/lib/api';
import { buildTodayRecipeRequestFields } from '@/lib/recipes/today-handoff';

const { searchParams, hooks } = vi.hoisted(() => ({
  searchParams: { current: '' },
  hooks: { active: false, cursor: 0, values: [] as unknown[] },
}));

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

function renderContent(): ReactNode {
  const page: ReactNode = RecipeSearchPage();
  if (!isValidElement<{ children: ReactNode }>(page)) throw new Error('Expected search page');
  const child: unknown = page.props.children;
  if (!isValidElement(child) || typeof child.type !== 'function') throw new Error('Expected search content');
  hooks.cursor = 0;
  return (child.type as () => ReactNode)();
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


vi.mock('@/lib/api', () => ({ safeFetch: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(searchParams.current) }));

beforeEach(() => {
  searchParams.current = '';
  hooks.active = false;
  hooks.values = [];
  vi.mocked(safeFetch).mockReset();
});

describe('RecipeSearchPage Today handoff', () => {
  it('offers direct access to generated recipe history without generating a recipe', () => {
    const markup = renderToStaticMarkup(createElement(RecipeSearchPage));
    expect(markup).toMatch(/href="\/recipes\/history"[^>]*>Historial<\/a>/);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps citations in the history workflow, not under the generated recipe (context=%s)', async (hasContext) => {
    hooks.active = true;
    try {
      const initial = renderContent();
      const select = findNode(initial, (item) => item.type === 'select');
      expect(select).toBeDefined();
      (select?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'rag' } });
      const name = findNode(initial, (item) => item.props.name === 'recipeName');
      (name?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Arroz' } });
      vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: {
        title: 'Arroz', recipe: 'Cocinar arroz.', recipeHistoryId: 'history-1',
        ragContextUsed: hasContext,
        sources: hasContext ? [{ sourceType: 'global_pdf', globalBookId: 'book-1', title: 'Libro de prueba', pageNumber: 111, chunkId: 'chunk-1' }] : [],
      } });
      const form = findNode(renderContent(), (item) => item.type === 'form');
      await (form?.props.onSubmit as (event: FormEvent) => Promise<void>)({ preventDefault: vi.fn() } as unknown as FormEvent);
      const result = renderContent();
      expect(findNode(result, (item) => item.props.children === 'Cocinar arroz.')).toBeDefined();
      expect(findNode(result, (item) => item.props.children === 'Importar al recetario')).toBeDefined();
      expect(findNode(result, (item) => item.props.href === '/recipes/history')).toBeDefined();
      expect(findNode(result, (item) => item.props.children === 'Fuentes del recetario')).toBeUndefined();
      expect(findNode(result, (item) => item.props.children === 'Libro de prueba')).toBeUndefined();
      expect(Boolean(findNode(result, (item) => item.props.children === 'No se encontró contexto documental relevante para esta receta.'))).toBe(!hasContext);
    } finally {
      hooks.active = false;
    }
  });

  it('prefills valid URL intent, maps it into the canonical request body fields, and keeps explicit submit', () => {
    searchParams.current = 'slot=snack&title=Tostadas+con+tomate&ingredient=pan&ingredient=tomate';
    const markup = renderToStaticMarkup(createElement(RecipeSearchPage));

    expect(markup).toContain('name="recipeName"');
    expect(markup).toContain('value="Tostadas con tomate"');
    expect(markup).toContain('pan\ntomate');
    expect(markup).toContain('type="submit"');
    expect(buildTodayRecipeRequestFields(new URLSearchParams(searchParams.current))).toEqual({
      recipeName: 'Tostadas con tomate',
      mealType: 'Merienda',
      ingredients: ['pan', 'tomate'],
    });
  });

  it('preserves the empty search form for an invalid Today slot', () => {
    searchParams.current = 'slot=brunch&title=Desayuno&ingredient=avena';
    const markup = renderToStaticMarkup(createElement(RecipeSearchPage));
    expect(markup).not.toContain('Desayuno</');
    expect(markup).not.toContain('avena');
    expect(buildTodayRecipeRequestFields(new URLSearchParams(searchParams.current))).toBeNull();
  });
  it('requires a reviewed editable draft before import and blocks a competing generation', async () => {
    hooks.active = true;
    const id = 'f1e2d3c4-a5b6-47c8-9012-3456789abcde';
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: {
      title: 'Arroz', recipe: 'Arroz\n\nINGREDIENTES\n- 1/3 taza arroz\n\nPREPARACIÓN\nMezclar con huevo.', preparation: 'Mezclar con huevo.',
      servings: 4, recipeHistoryId: id, recipeReviewRequired: true,
      structuredIngredients: [{
        name: 'arroz', normalized_name: 'arroz', quantity: null, exact_quantity_text: '1/3',
        unit: 'taza', optional_quantity_text: null, category: null, estimated_cost_optional: null, structured: false,
      }],
    } });
    const event = { preventDefault: vi.fn() } as unknown as FormEvent;
    const submit = (node: ReactNode) => {
      const form = findNode(node, (item) => item.type === 'form');
      if (!form) throw new Error('Missing form');
      return (form.props.onSubmit as (event: FormEvent) => Promise<void>)(event);
    };
    try {
      await submit(renderContent());
      const result = renderContent();
      const button = findNode(result, (item) => item.type === 'button' && item.props.children === 'Importar al recetario');
      if (!button) throw new Error('Missing import action');
      (button.props.onClick as () => void)();
      expect(safeFetch).toHaveBeenCalledTimes(1);
      const reviewing = renderContent();
      const editor = findNode(reviewing, (item) => item.type === RecipeEditor);
      if (!editor) throw new Error('Missing review editor');
      const draft = editor.props.initial as Draft;
      expect(draft.ingredients).toEqual([{ name: 'arroz', quantity: '1/3', unit: 'taza' }]);
      expect(draft.instructions).toBe('Mezclar con huevo.');
      await submit(reviewing);
      expect(safeFetch).toHaveBeenCalledTimes(1);
      type ImportResult = { ok: true; data: { recipe: { id: string }; warnings: { duplicates: [] } } };
      let resolveImport: ((result: ImportResult) => void) | undefined;
      const pending = new Promise<ImportResult>((resolve) => { resolveImport = resolve; });
      vi.mocked(safeFetch).mockReturnValueOnce(pending);
      (editor.props.onSave as (draft: Draft) => void)({
        ...draft,
        ingredients: [...draft.ingredients, { name: 'huevo', quantity: '1', unit: 'unidad' }],
      });
      await submit(renderContent());
      expect(safeFetch).toHaveBeenCalledTimes(2);
      const [url, init] = vi.mocked(safeFetch).mock.calls[1] ?? [];
      expect(url).toBe('/api/recipes');
      const body: unknown = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ sourceRecipeHistoryId: id, instructions: 'Mezclar con huevo.', ingredients: [
        { name: 'arroz', quantity: '1/3' }, { name: 'huevo', quantity: '1' },
      ] });
      resolveImport?.({ ok: true, data: { recipe: { id: 'saved-1' }, warnings: { duplicates: [] } } });
      await vi.waitFor(() => {
        expect(findNode(renderContent(), (item) => item.props.href === '/recipes/saved-1')).toBeDefined();
      });
    } finally {
      hooks.active = false;
    }
  });

  it('submits the ordinary recipe name and validates restrictions before network access', async () => {
    hooks.active = true;
    try {
      const node = renderContent();
      const name = findNode(node, (item) => item.type === 'input' && item.props.name === 'recipeName');
      expect(name).toBeDefined();
      (name?.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Risotto' } });
      const restriction = findNode(node, (item) => item.type === 'input' && item.props['aria-describedby'] === 'recipe-restrictions-hint');
      const change = restriction?.props.onChange as (event: { target: { value: string } }) => void;
      change({ target: { value: Array.from({ length: 11 }, (_, i) => 'evitar ' + i).join(',') } });
      const submit = async () => {
        const form = findNode(renderContent(), (item) => item.type === 'form');
        if (!form) throw new Error('Missing form');
        await (form.props.onSubmit as (event: FormEvent) => Promise<void>)({ preventDefault: vi.fn() } as unknown as FormEvent);
      };
      await submit();
      expect(safeFetch).not.toHaveBeenCalled();
      change({ target: { value: 'sin huevo' } });
      vi.mocked(safeFetch).mockResolvedValueOnce({ ok: false, status: 502, error: 'provider error' });
      await submit();
      const [url, init] = vi.mocked(safeFetch).mock.calls[0] ?? [];
      expect(url).toBe('/api/recipe-generate');
      expect(JSON.parse(String(init?.body)) as unknown).toMatchObject({ recipeName: 'Risotto', culinaryProfile: { avoid: ['sin huevo'] } });
    } finally { hooks.active = false; }
  });

});
