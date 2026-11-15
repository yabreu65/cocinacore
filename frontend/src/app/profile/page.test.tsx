import { isValidElement, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProfilePage from './page';
import { safeFetch } from '@/lib/api';
import { EMPTY_CULINARY_SELECTIONS } from '@/lib/profile/culinary-profile-contract';

const hooks = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  states: [] as unknown[],
  effect: null as (() => void | (() => void)) | null,
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void] {
      if (!hooks.active) return actual.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.states)) {
        hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      return [hooks.states[index] as T, (value) => {
        hooks.states[index] = typeof value === 'function'
          ? (value as (previous: T) => T)(hooks.states[index] as T)
          : value;
      }];
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      if (!hooks.active) return actual.useEffect(effect, deps);
      hooks.effect = effect;
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
      return hooks.active ? factory() : actual.useMemo(factory, deps);
    },
  };
});

vi.mock('@/lib/api', () => ({ safeFetch: vi.fn() }));

function renderProfile() {
  hooks.cursor = 0;
  return ProfilePage();
}

function findForm(node: ReactNode): ReactElement<{ onSubmit: (event: FormEvent) => Promise<void> }> | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === 'form') {
    return node as ReactElement<{ onSubmit: (event: FormEvent) => Promise<void> }>;
  }
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children as ReactNode[] : [children]) {
    const form = findForm(child);
    if (form) return form;
  }
  return undefined;
}

describe('ProfilePage', () => {
  it('disables all profile form controls during the initial loading render', () => {
    const markup = renderToStaticMarkup(<ProfilePage />);
    const fieldsetStart = markup.indexOf('<fieldset disabled="" class="contents">');
    const fieldsetEnd = markup.lastIndexOf('</fieldset>');

    expect(markup).toContain('Cargando perfil...');
    expect(fieldsetStart).toBeGreaterThanOrEqual(0);
    expect(fieldsetEnd).toBeGreaterThan(fieldsetStart);

    const controlsMarkup = markup.slice(fieldsetStart, fieldsetEnd);
    expect(controlsMarkup).toContain('Nombre completo');
    expect(controlsMarkup).toContain('Nivel culinario');
    expect(controlsMarkup).toContain('Guardar perfil culinario');
  });
  it('keeps the form disabled and rejects submission after GET fails', async () => {
    hooks.active = true;
    hooks.states = [];
    vi.mocked(safeFetch).mockReset();
    vi.mocked(safeFetch).mockResolvedValueOnce({ ok: false, error: 'No disponible', status: 503 });
    try {
      renderProfile();
      hooks.effect?.();
      await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
      const page = renderProfile();
      hooks.active = false;
      const markup = renderToStaticMarkup(page);
      expect(markup).toContain('No disponible');
      expect(markup).toContain('No puedes modificar el perfil hasta que se cargue correctamente.');
      expect(markup).toContain('<fieldset disabled="" class="contents">');
      expect(markup).toMatch(/<button type="submit" disabled=""/);
      const form = findForm(page);
      expect(form).toBeDefined();
      await form?.props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent);
      expect(safeFetch).toHaveBeenCalledTimes(1);
      expect(safeFetch).toHaveBeenCalledWith('/api/profile', { credentials: 'same-origin' });
    } finally {
      hooks.active = false;
    }
  });

  it('allows a successfully loaded empty profile to be initialized', async () => {
    hooks.active = true;
    hooks.states = [];
    vi.mocked(safeFetch).mockReset();
    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true,
      data: {
        user: { id: 'user-1', email: 'test@example.com', fullName: null, tenant: null },
        profile: null,
        taxonomy: { dimensions: [], terms: [] },
        selections: EMPTY_CULINARY_SELECTIONS,
      },
    });
    try {
      renderProfile();
      hooks.effect?.();
      await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
      const page = renderProfile();
      hooks.active = false;
      const markup = renderToStaticMarkup(page);
      expect(markup).toContain('<fieldset class="contents">');
      expect(markup).not.toMatch(/<button type="submit" disabled=""/);
      expect(markup).not.toContain('No puedes modificar el perfil');
    } finally {
      hooks.active = false;
    }
  });

  it('preserves a saved non-multiple-of-five minute value when saving the profile', async () => {
    hooks.active = true;
    hooks.states = [];
    vi.mocked(safeFetch).mockReset();
    const user = { id: 'user-1', email: 'test@example.com', fullName: 'Ana', tenant: null };
    const profile = {
      level: 'Intermedio', availableTimeMinutes: 37,
      dislikedIngredients: [], allergies: ['Huevo'], householdMembers: [],
    };
    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true, data: { user, profile, taxonomy: { dimensions: [], terms: [] },
        selections: EMPTY_CULINARY_SELECTIONS },
    });
    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true, data: { user, profile, selections: EMPTY_CULINARY_SELECTIONS },
    });
    try {
      renderProfile();
      hooks.effect?.();
      await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
      const page = renderProfile();
      hooks.active = false;
      const markup = renderToStaticMarkup(page);
      expect(markup).toMatch(/<input[^>]*type="number"[^>]*min="5"[^>]*max="240"[^>]*step="1"[^>]*value="37"/);
      const form = findForm(page);
      expect(form).toBeDefined();
      await form?.props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent);
      expect(safeFetch).toHaveBeenCalledTimes(2);
      const [url, init] = vi.mocked(safeFetch).mock.calls[1] ?? [];
      expect(url).toBe('/api/profile');
      expect(init?.method).toBe('PUT');
      expect(init?.body).toContain('"availableTimeMinutes":37');
      expect(init?.body).toContain('"allergies":["Huevo"]');
    } finally {
      hooks.active = false;
    }
  });

  it.each([
    { field: 'dislikedIngredients', label: 'Ingredientes que no te gustan', errorId: 'disliked-ingredients-error' },
    { field: 'allergies', label: 'Alergias', errorId: 'allergies-error' },
  ] as const)('blocks invalid $field and keeps the original entries for correction', async ({ field, label, errorId }) => {
    for (const invalid of [
      { entries: Array.from({ length: 21 }, (_, index) => 'Ingrediente ' + (index + 1)), message: 'escribe como máximo 20 ingredientes.' },
      { entries: ['Huevo', 'a'.repeat(81)], message: 'el ingrediente 2 supera los 80 caracteres.' },
    ]) {
      hooks.active = true;
      hooks.states = [];
      vi.mocked(safeFetch).mockReset();
      const user = { id: 'user-1', email: 'test@example.com', fullName: 'Ana', tenant: null };
      const profile = {
        level: 'Intermedio', availableTimeMinutes: 37,
        dislikedIngredients: ['Tomate'], allergies: ['Huevo'], householdMembers: [],
        [field]: invalid.entries,
      };
      vi.mocked(safeFetch).mockResolvedValueOnce({
        ok: true, data: { user, profile, taxonomy: { dimensions: [], terms: [] },
          selections: EMPTY_CULINARY_SELECTIONS },
      });
      try {
        renderProfile();
        hooks.effect?.();
        await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
        const page = renderProfile();
        hooks.active = false;
        const markup = renderToStaticMarkup(page);
        expect(markup).toContain('id="' + errorId + '"');
        expect(markup).toContain(label + ': ' + invalid.message);
        expect(markup).toContain('aria-invalid="true"');
        expect(markup).toContain(invalid.entries[invalid.entries.length - 1]);
        const form = findForm(page);
        expect(form).toBeDefined();
        await form?.props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent);
        expect(safeFetch).toHaveBeenCalledTimes(1);
        hooks.active = true;
        const rejected = renderProfile();
        hooks.active = false;
        expect(renderToStaticMarkup(rejected)).toContain('Corrige los campos indicados antes de guardar el perfil.');
      } finally {
        hooks.active = false;
      }
    }
  });

  it('accepts exactly 20 entries of up to 80 characters without counting blank lines', async () => {
    hooks.active = true;
    hooks.states = [];
    vi.mocked(safeFetch).mockReset();
    const user = { id: 'user-1', email: 'test@example.com', fullName: 'Ana', tenant: null };
    const entries = ['a'.repeat(80), ...Array.from({ length: 19 }, (_, index) => 'Ingrediente ' + (index + 1))];
    const profile = {
      level: 'Intermedio', availableTimeMinutes: 37,
      dislikedIngredients: ['', ...entries, ' '], allergies: ['', ...entries, ' '], householdMembers: [],
    };
    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true, data: { user, profile, taxonomy: { dimensions: [], terms: [] },
        selections: EMPTY_CULINARY_SELECTIONS },
    });
    vi.mocked(safeFetch).mockResolvedValueOnce({
      ok: true, data: { user, profile: { ...profile, dislikedIngredients: entries, allergies: entries }, selections: EMPTY_CULINARY_SELECTIONS },
    });
    try {
      renderProfile();
      hooks.effect?.();
      await vi.waitFor(() => expect(hooks.states[1]).toBe(false));
      const page = renderProfile();
      hooks.active = false;
      const markup = renderToStaticMarkup(page);
      expect(markup).not.toContain('id="allergies-error"');
      expect(markup).not.toContain('id="disliked-ingredients-error"');
      expect(markup.match(/aria-invalid="false"/g)).toHaveLength(2);
      const form = findForm(page);
      expect(form).toBeDefined();
      await form?.props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent);
      expect(safeFetch).toHaveBeenCalledTimes(2);
      const [, init] = vi.mocked(safeFetch).mock.calls[1] ?? [];
      expect(init?.method).toBe('PUT');
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      expect(body).toMatchObject({ allergies: entries, dislikedIngredients: entries });
    } finally {
      hooks.active = false;
    }
  });

});
