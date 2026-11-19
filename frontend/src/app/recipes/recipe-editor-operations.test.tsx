import { isValidElement, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RecipeLibraryClient, { RecipeEditor, type Draft } from './RecipeLibraryClient';
import RecipeDetailClient from './[id]/RecipeDetailClient';
import RecipeDetailPage from './[id]/page';
import RecipeHistoryPage from './history/page';
import { safeFetch } from '@/lib/api';
import type { Recipe } from './recipe-ui';

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.values[index] as T, (value) => {
        hooks.values[index] = typeof value === 'function' ? (value as (previous: T) => T)(hooks.values[index] as T) : value;
      }];
    },
    useRef<T>(initial: T) {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = { current: initial };
      return hooks.values[index] as { current: T };
    },
    useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(callback: T) => callback,
  };
});
vi.mock('@/lib/api', () => ({ safeFetch: vi.fn() }));

function render(component: () => ReactNode) {
  hooks.cursor = 0;
  hooks.effects = [];
  return component();
}
function find(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const result = find(child, predicate);
      if (result) return result;
    }
  }
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  return predicate(node) ? node : find(node.props.children as ReactNode, predicate);
}
function button(node: ReactNode, label: string) {
  const result = find(node, (element) => element.type === 'button' && element.props.children === label);
  if (!result) throw new Error('Missing button: ' + label);
  return result;
}
function editor(node: ReactNode) {
  const result = find(node, (element) => element.type === RecipeEditor);
  if (!result) throw new Error('Missing editor');
  return result;
}
const draft: Draft = {
  title: 'Arroz', category: '', tags: '', servings: '4',
  instructions: 'Cocinar.', ingredients: [{ name: 'arroz', quantity: '1/3', unit: 'taza' }],
};
function click(node: ReactElement<Record<string, unknown>>) {
  (node.props.onClick as () => void)();
}
function save(node: ReactElement<Record<string, unknown>>) {
  (node.props.onSave as (draft: Draft) => void)(draft);
}

const persisted: Recipe = {
  id: 'recipe-id', category: null, tags: [], archived_at: null,
  created_at: '', updated_at: '',
  current_version: { id: 'version-id', version_number: 1, title: 'Arroz', instructions: 'Cocinar.', servings: 4, ingredients: draft.ingredients },
};

describe('recipe editor operation guards', () => {
  beforeEach(() => {
    hooks.values = [];
    hooks.effects = [];
    vi.mocked(safeFetch).mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers direct access to generated recipe history beside manual creation', () => {
    const page = render(RecipeLibraryClient);
    const history = find(page, (element) => element.props.href === '/recipes/history');
    expect(history?.props.children).toBe('Historial');
    expect(button(page, 'Crear receta')).toBeDefined();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('keeps manual creation mounted through failed saves and blocks duplicate submission or closing', async () => {
    const page = () => render(RecipeLibraryClient);
    click(button(page(), 'Crear receta'));
    const current = editor(page());
    let rejectSave: ((reason: Error) => void) | undefined;
    vi.mocked(safeFetch).mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }));
    save(current);
    save(current);
    const toggle = button(page(), 'Crear receta');
    expect(toggle.props.disabled).toBe(true);
    click(toggle);
    (current.props.onCancel as () => void)();
    expect(editor(page()).props.saving).toBe(true);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    rejectSave?.(new Error('Red no disponible'));
    await vi.waitFor(() => expect(editor(page()).props.saving).toBe(false));
    expect(find(page(), (element) => element.props.role === 'alert')).toBeDefined();
    expect(button(page(), 'Crear receta').props.disabled).toBe(false);
  });

  it('unlocks detail editing after a network rejection without closing the editor', async () => {
    const page = () => render(() => RecipeDetailClient({ id: persisted.id }));
    page();
    // Seed the loaded result (effects are not executed by this hook harness).
    hooks.values[0] = persisted;
    hooks.values[2] = false;
    click(button(page(), 'Editar'));
    const current = editor(page());
    let rejectSave: ((reason: Error) => void) | undefined;
    vi.mocked(safeFetch).mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject; }));
    save(current);
    save(current);
    const pending = page();
    expect(button(pending, 'Cerrar edición').props.disabled).toBe(true);
    expect(button(pending, 'Archivar').props.disabled).toBe(true);
    click(button(pending, 'Cerrar edición'));
    expect(editor(page()).props.saving).toBe(true);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    rejectSave?.(new Error('Red no disponible'));
    await vi.waitFor(() => expect(editor(page()).props.saving).toBe(false));
    expect(button(page(), 'Cerrar edición').props.disabled).toBe(false);
    expect(find(page(), (element) => element.props.role === 'alert')).toBeDefined();
  });

  it('keeps the history review draft mounted after a failed import rather than reloading rows', async () => {
    const page = () => render(RecipeHistoryPage);
    page();
    hooks.values[0] = [{
      id: 'f1e2d3c4-a5b6-47c8-9012-3456789abcde',
      recipe_title: 'Arroz', recipe_payload: {
        full_recipe: 'Arroz\n\nINGREDIENTES\n- 1/3 taza arroz\n\nPREPARACIÓN\nCocinar.', preparation: 'Cocinar.',
        peopleCount: 4, structuredIngredients: [{ name: 'arroz', quantity: null, exact_quantity_text: '1/3', unit: 'taza' }],
      },
      user_feedback: null, created_at: '2026-11-15T00:00:00.000Z', is_saved: false,
    }];
    hooks.values[4] = false;
    (hooks.values[12] as { current: boolean }).current = false;
    click(button(page(), 'Importar a Mi recetario'));
    const current = editor(page());
    expect((current.props.initial as Draft).instructions).toBe('Cocinar.');
    vi.mocked(safeFetch).mockRejectedValueOnce(new Error('Red no disponible'));
    save(current);
    await vi.waitFor(() => expect(editor(page()).props.saving).toBe(false));
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(hooks.values[14]).toBe(0);
    expect(hooks.values[4]).toBe(false);
    expect((editor(page()).props.initial as Draft).ingredients).toEqual(draft.ingredients);
  });
  it.each([
    { ...draft, servings: '101' },
    { ...draft, tags: Array.from({ length: 21 }, (_, i) => 'tag' + i).join(',') },
    { ...draft, ingredients: [{ name: ' ', quantity: '1', unit: 'g' }] },
  ])('rejects invalid editor drafts before calling persistence and retains their values', (invalid) => {
    const onSave = vi.fn();
    const page = () => render(() => RecipeEditor({ initial: invalid, onSave }));
    const node = page();
    const form = find(node, (element) => element.type === 'form');
    if (!form) throw new Error('Missing form');
    (form.props.onSubmit as (event: FormEvent) => void)({ preventDefault: vi.fn() } as unknown as FormEvent);
    expect(onSave).not.toHaveBeenCalled();
    expect(hooks.values[0]).toEqual(invalid);
    expect(find(page(), (element) => element.props.role === 'alert')).toBeDefined();
  });

  it('submits a valid reviewed draft through the shared editor', () => {
    const onSave = vi.fn();
    const node = render(() => RecipeEditor({ initial: draft, onSave }));
    const form = find(node, (element) => element.type === 'form');
    if (!form) throw new Error('Missing form');
    (form.props.onSubmit as (event: FormEvent) => void)({ preventDefault: vi.fn() } as unknown as FormEvent);
    expect(onSave).toHaveBeenCalledExactlyOnceWith(draft);
  });

  it.each(['failure', 'success'])('resumes the deferred history load after popstate during an import (%s)', async (outcome) => {
    const page = () => render(RecipeHistoryPage);
    page();
    const row = {
      id: 'f1e2d3c4-a5b6-47c8-9012-3456789abcde',
      recipe_title: 'Arroz', recipe_payload: {
        full_recipe: 'Arroz\n\nINGREDIENTES\n- 1/3 taza arroz\n\nPREPARACIÓN\nCocinar.',
        preparation: 'Cocinar.', peopleCount: 4,
        structuredIngredients: [{ name: 'arroz', quantity: null, exact_quantity_text: '1/3', unit: 'taza' }],
      },
      user_feedback: null, created_at: '2026-11-15T00:00:00.000Z', is_saved: false,
    };
    hooks.values[0] = [row];
    hooks.values[2] = true;
    hooks.values[4] = false;
    (hooks.values[12] as { current: boolean }).current = false;
    let popstate: (() => void) | undefined;
    const fakeWindow = {
      location: { search: '' },
      addEventListener: (_event: string, listener: () => void) => { popstate = listener; },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('window', fakeWindow);
    page();
    const cleanup = hooks.effects[0]?.();
    click(button(page(), 'Importar a Mi recetario'));
    const current = editor(page());
    let rejectImport: ((reason: Error) => void) | undefined;
    let resolveImport: ((value: { ok: true; data: { recipe: { id: string } } }) => void) | undefined;
    vi.mocked(safeFetch).mockReturnValueOnce(new Promise((resolve, reject) => {
      rejectImport = reject;
      resolveImport = resolve;
    }));
    save(current);
    fakeWindow.location.search = '?saved=true';
    popstate?.();
    page();
    // The navigation effect sees the occupied operation gate and defers loading.
    hooks.effects[1]?.();
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(hooks.values[4]).toBe(true);
    if (outcome === 'failure') rejectImport?.(new Error('Red no disponible'));
    else resolveImport?.({ ok: true, data: { recipe: { id: 'saved-recipe' } } });
    await vi.waitFor(() => expect(hooks.values[14]).toBe(1));
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: { items: [] } });
    page();
    const cleanupLoad = hooks.effects[1]?.();
    await vi.waitFor(() => expect(hooks.values[4]).toBe(false));
    expect(safeFetch).toHaveBeenLastCalledWith('/api/recipe-history?saved=true', expect.objectContaining({ credentials: 'same-origin' }));
    if (typeof cleanupLoad === 'function') cleanupLoad();
    if (typeof cleanup === 'function') cleanup();
  });

  it('prevents adding a 101st ingredient, including two stale clicks at the limit', () => {
    const initial = { ...draft, ingredients: Array.from({ length: 99 }, () => ({ name: 'arroz', quantity: '1', unit: 'g' })) };
    const page = () => render(() => RecipeEditor({ initial, onSave: vi.fn() }));
    const add = button(page(), 'Agregar ingrediente');
    click(add);
    click(add);
    expect((hooks.values[0] as Draft).ingredients).toHaveLength(100);
    expect(button(page(), 'Agregar ingrediente').props.disabled).toBe(true);
  });

  it.each(['old-first', 'new-first', 'old-error'])('only the current library request can change results and loading (%s)', async (order) => {
    const page = () => render(RecipeLibraryClient);
    const change = (value: string) => {
      const select = find(page(), (element) => element.props['aria-label'] === 'Estado de recetas');
      if (!select) throw new Error('Missing archive filter');
      (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    };
    const archived = { ...persisted, id: 'archived-id', archived_at: '2026-11-15' };
    type Result = { ok: true; data: { items: Recipe[] } };
    let oldResolve: ((value: Result) => void) | undefined;
    let oldReject: ((error: Error) => void) | undefined;
    let newResolve: ((value: Result) => void) | undefined;
    vi.mocked(safeFetch)
      .mockReturnValueOnce(new Promise((resolve, reject) => { oldResolve = resolve; oldReject = reject; }))
      .mockReturnValueOnce(new Promise((resolve) => { newResolve = resolve; }));
    page();
    const cleanup = hooks.effects[0]?.();
    change('archived');
    expect(hooks.values[0]).toEqual([]);
    expect(safeFetch).toHaveBeenNthCalledWith(2, '/api/recipes?archived=archived&limit=100&offset=0', expect.anything());
    if (order === 'old-first' || order === 'old-error') {
      if (order === 'old-error') oldReject?.(new Error('Stale request failed'));
      else oldResolve?.({ ok: true, data: { items: [persisted] } });
      await Promise.resolve();
      expect(hooks.values[1]).toBe(true);
      expect(hooks.values[2]).toBe('');
      expect(hooks.values[0]).toEqual([]);
    }
    newResolve?.({ ok: true, data: { items: [archived] } });
    await vi.waitFor(() => expect(hooks.values[0]).toEqual([archived]));
    if (order === 'new-first') {
      oldResolve?.({ ok: true, data: { items: [persisted] } });
      await Promise.resolve();
    }
    expect(hooks.values[0]).toEqual([archived]);
    expect(hooks.values[1]).toBe(false);
    expect(hooks.values[2]).toBe('');
    if (typeof cleanup === 'function') cleanup();
  });

  it('reloads the current library filter when a creation resolves after a filter change', async () => {
    const page = () => render(RecipeLibraryClient);
    click(button(page(), 'Crear receta'));
    let finish: ((result: { ok: true; data: { recipe: Recipe; warnings: { duplicates: [] } } }) => void) | undefined;
    vi.mocked(safeFetch).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    save(editor(page()));
    const select = find(page(), (element) => element.props['aria-label'] === 'Estado de recetas');
    if (!select) throw new Error('Missing archive filter');
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: { items: [] } });
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'archived' } });
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: { items: [] } });
    finish?.({ ok: true, data: { recipe: persisted, warnings: { duplicates: [] } } });
    await vi.waitFor(() => expect(safeFetch).toHaveBeenCalledTimes(3));
    expect(safeFetch).toHaveBeenLastCalledWith('/api/recipes?archived=archived&limit=100&offset=0', expect.anything());
  });

  it('requests the final archive filter even if two changes occur before React renders', async () => {
    const page = () => render(RecipeLibraryClient);
    const select = find(page(), (element) => element.props['aria-label'] === 'Estado de recetas');
    if (!select) throw new Error('Missing archive filter');
    const change = select.props.onChange as (event: { target: { value: string } }) => void;
    vi.mocked(safeFetch)
      .mockResolvedValueOnce({ ok: true, data: { items: [] } })
      .mockResolvedValueOnce({ ok: true, data: { items: [persisted] } });
    change({ target: { value: 'archived' } });
    change({ target: { value: 'active' } });
    await vi.waitFor(() => expect(hooks.values[0]).toEqual([persisted]));
    expect(hooks.values[1]).toBe(false);
    expect(safeFetch).toHaveBeenLastCalledWith('/api/recipes?archived=active&limit=100&offset=0', expect.anything());
  });

  it('isolates detail state by recipe identity when navigation changes the route', async () => {
    const a = await RecipeDetailPage({ params: Promise.resolve({ id: 'recipe-a' }) });
    const b = await RecipeDetailPage({ params: Promise.resolve({ id: 'recipe-b' }) });
    expect(a.key).toBe('recipe-a');
    expect(b.key).toBe('recipe-b');
    expect(a.type).toBe(RecipeDetailClient);
    expect(b.type).toBe(RecipeDetailClient);
  });

  it('clears only the history load error when retry succeeds and preserves a distinct operation error', async () => {
    const page = () => render(RecipeHistoryPage);
    page();
    hooks.values[2] = true;
    const row = {
      id: 'f1e2d3c4-a5b6-47c8-9012-3456789abcde',
      recipe_title: 'Arroz', recipe_payload: { full_recipe: 'Cocinar.' },
      user_feedback: null, created_at: '2026-11-15T00:00:00.000Z', is_saved: false,
    };
    vi.mocked(safeFetch).mockRejectedValueOnce(new Error('Red no disponible'));
    page();
    const cleanup = hooks.effects[1]?.();
    await vi.waitFor(() => expect(hooks.values[4]).toBe(false));
    expect(hooks.values[15]).toBe('Red no disponible');
    expect(hooks.values[3]).toBeNull();
    const failed = page();
    expect(find(failed, (element) => element.props.children === 'Red no disponible')).toBeDefined();
    expect(find(failed, (element) => element.props.children === 'Aún no tienes recetas en el historial.')).toBeUndefined();
    click(button(failed, 'Reintentar carga del historial'));
    expect(hooks.values[14]).toBe(1);
    if (typeof cleanup === 'function') cleanup();
    // An operation failure must not be hidden by a successful read.
    hooks.values[3] = 'No se pudo guardar feedback.';
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: true, data: { items: [row] } });
    page();
    const retryCleanup = hooks.effects[1]?.();
    await vi.waitFor(() => expect(hooks.values[0]).toEqual([row]));
    expect(hooks.values[4]).toBe(false);
    expect(hooks.values[15]).toBeNull();
    expect(hooks.values[3]).toBe('No se pudo guardar feedback.');
    expect(find(page(), (element) => element.props.children === 'Red no disponible')).toBeUndefined();
    if (typeof retryCleanup === 'function') retryCleanup();
  });

  it('shows the ingredient limit instead of offering a partial history import', () => {
    const page = () => render(RecipeHistoryPage);
    page();
    const original = 'Ingredientes completos, incluido el ingrediente 105.';
    hooks.values[0] = [{
      id: 'f1e2d3c4-a5b6-47c8-9012-3456789abcde',
      recipe_title: 'Receta antigua',
      recipe_payload: {
        full_recipe: original,
        structuredIngredients: Array.from({ length: 105 }, (_, index) => ({
          name: 'Ingrediente ' + (index + 1), quantity: 1, unit: 'g',
        })),
      },
      user_feedback: null, created_at: '2026-11-15T00:00:00.000Z', is_saved: false,
    }];
    hooks.values[4] = false;
    (hooks.values[12] as { current: boolean }).current = false;
    const node = page();
    expect(find(node, (element) => element.type === 'button' && element.props.children === 'Importar a Mi recetario')).toBeUndefined();
    expect(find(node, (element) => element.type === 'p' && Array.isArray(element.props.children) &&
      element.props.children.some((child) => typeof child === 'string' && child.includes('límite de 100 ingredientes')))).toBeDefined();
    click(button(node, 'Ver detalle'));
    expect(find(page(), (element) => element.type === 'pre' && element.props.children === original)).toBeDefined();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('explains why a legacy row with an unrepresentable field cannot be imported', () => {
    const page = () => render(RecipeHistoryPage);
    page();
    const original = 'Receta original completa.';
    hooks.values[0] = [{
      id: 'f1e2d3c4-a5b6-47c8-9012-3456789abcde',
      recipe_title: 'Receta antigua',
      recipe_payload: { full_recipe: original, structuredIngredients: [
        { name: 'arroz', quantity: 1, unit: 'g' }, { name: 'sal', quantity: 1, unit: 'u'.repeat(51) },
      ] },
      user_feedback: null, created_at: '2026-11-15T00:00:00.000Z', is_saved: false,
    }];
    hooks.values[4] = false;
    const node = page();
    expect(find(node, (element) => element.type === 'button' && element.props.children === 'Importar a Mi recetario')).toBeUndefined();
    expect(find(node, (element) => element.type === 'p' && Array.isArray(element.props.children) &&
      element.props.children.some((child) => typeof child === 'string' && child.includes('sin alterar sus datos')))).toBeDefined();
    click(button(node, 'Ver detalle'));
    expect(find(page(), (element) => element.type === 'pre' && element.props.children === original)).toBeDefined();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it('retains a successful edit response when the subsequent detail refresh fails', async () => {
    const page = () => render(() => RecipeDetailClient({ id: persisted.id }));
    page();
    hooks.values[0] = persisted;
    hooks.values[1] = [persisted.current_version];
    hooks.values[2] = false;
    click(button(page(), 'Editar'));
    const updated = { ...persisted, current_version: {
      ...persisted.current_version, id: 'version-2', version_number: 2, title: 'Arroz actualizado',
    } };
    vi.mocked(safeFetch)
      .mockResolvedValueOnce({ ok: true, data: { recipe: updated, version: updated.current_version } })
      .mockRejectedValueOnce(new Error('Error de recarga'))
      .mockResolvedValueOnce({ ok: true, data: { versions: [updated.current_version] } });
    save(editor(page()));
    await vi.waitFor(() => expect(hooks.values[5]).toBe(false));
    expect(hooks.values[0]).toEqual(updated);
    expect(hooks.values[1]).toEqual([updated.current_version, persisted.current_version]);
    expect(hooks.values[4]).toBe(false);
    expect(hooks.values[3]).toBe('Error de recarga');
    expect(find(page(), (element) => element.type === 'h1' && element.props.children === 'Arroz actualizado')).toBeDefined();
    expect(button(page(), 'Reintentar carga')).toBeDefined();
  });

  it('retains a successful archive response when the subsequent refresh fails', async () => {
    const page = () => render(() => RecipeDetailClient({ id: persisted.id }));
    page();
    hooks.values[0] = persisted;
    hooks.values[1] = [persisted.current_version];
    hooks.values[2] = false;
    const updated = { ...persisted, archived_at: '2026-11-15T00:00:00.000Z' };
    vi.mocked(safeFetch)
      .mockResolvedValueOnce({ ok: true, data: { recipe: updated } })
      .mockResolvedValueOnce({ ok: true, data: { recipe: updated } })
      .mockRejectedValueOnce(new Error('Error de versiones'));
    click(button(page(), 'Archivar'));
    await vi.waitFor(() => expect(hooks.values[5]).toBe(false));
    expect(hooks.values[0]).toEqual(updated);
    expect(button(page(), 'Desarchivar')).toBeDefined();
    expect(hooks.values[3]).toBe('Error de versiones');
  });

});
