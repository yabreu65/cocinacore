import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const hookHarness = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  states: [] as unknown[],
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<T>(initial: T): [T, (value: T | ((previous: T) => T)) => void] {
      if (!hookHarness.active) return actual.useState(initial);
      const index = hookHarness.cursor++;
      if (!(index in hookHarness.states)) hookHarness.states[index] = initial;
      return [
        hookHarness.states[index] as T,
        (value) => {
          const previous = hookHarness.states[index] as T;
          hookHarness.states[index] = typeof value === 'function'
            ? (value as (previous: T) => T)(previous)
            : value;
        },
      ];
    },
    useRef<T>(initial: T) {
      if (!hookHarness.active) return actual.useRef(initial);
      const index = hookHarness.cursor++;
      if (!(index in hookHarness.states)) hookHarness.states[index] = { current: initial };
      return hookHarness.states[index] as ReturnType<typeof actual.useRef<T>>;
    },
  };
});
import TodayRecommendations, { getNextSlotIndex, TodayRecommendationResults, type TodayResponse } from './today-recommendations';
import { safeFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({ safeFetch: vi.fn() }));

const option = {
  title: 'Arroz con tomate',
  slot: 'lunch' as const,
  ingredients: ['arroz', 'tomate', 'aceite'],
  prepMinutes: null,
  source: 'history' as const,
  reason: 'Una opción de tu historial reciente.',
  availableIngredients: ['arroz'],
  missingIngredients: ['tomate', 'aceite'],
};

const response: TodayResponse = { status: 'success', options: [option], warnings: ['PROFILE_NOT_CONFIGURED'] };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('TodayRecommendations', () => {
  it('requires an explicit slot and presents the four accessible choices without a default', () => {
    const markup = renderToStaticMarkup(<TodayRecommendations onChoose={vi.fn()} />);

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Elegí el momento de comida"');
    for (const label of ['Desayuno', 'Almuerzo', 'Merienda', 'Cena']) expect(markup).toContain(label);
    expect(markup.match(/aria-checked="false"/g)).toHaveLength(4);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toContain('aria-checked="false" tabindex="0"');
    expect(markup).toContain('disabled=""');
  });

  it('wires arrow navigation to focus and the roving radio selection', () => {
    hookHarness.states = [];
    hookHarness.active = true;
    const render = () => {
      hookHarness.cursor = 0;
      return TodayRecommendations({ onChoose: vi.fn() });
    };
    const findRadios = (tree: unknown): Array<{ props: Record<string, unknown> }> => {
      if (!tree || typeof tree !== 'object') return [];
      const element = tree as { type?: unknown; props?: Record<string, unknown> };
      const radios = element.type === 'button' && element.props?.role === 'radio'
        ? [element as { props: Record<string, unknown> }]
        : [];
      const children = element.props?.children;
      return [...radios, ...(Array.isArray(children) ? children : [children]).flatMap(findRadios)];
    };

    try {
      const radios = findRadios(render());
      const focusTargets = Array.from({ length: radios.length }, () => ({ focus: vi.fn() }));
      radios.forEach((radio, index) => {
        const registerRef = radio.props.ref as (target: { focus: () => void } | null) => void;
        registerRef(focusTargets[index]);
      });
      const preventDefault = vi.fn();
      const onKeyDown = radios[0].props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void;
      onKeyDown({ key: 'ArrowRight', preventDefault });

      expect(preventDefault).toHaveBeenCalledOnce();
      expect(focusTargets[1].focus).toHaveBeenCalledOnce();
      const updatedRadios = findRadios(render());
      expect(updatedRadios[1].props['aria-checked']).toBe(true);
      expect(updatedRadios[1].props.tabIndex).toBe(0);
      expect(updatedRadios[0].props.tabIndex).toBe(-1);
    } finally {
      hookHarness.active = false;
      hookHarness.states = [];
    }
  });

  it('moves selection with radio arrow keys and wraps at either end', () => {
    expect(getNextSlotIndex(0, 'ArrowRight', 4)).toBe(1);
    expect(getNextSlotIndex(1, 'ArrowDown', 4)).toBe(2);
    expect(getNextSlotIndex(2, 'ArrowLeft', 4)).toBe(1);
    expect(getNextSlotIndex(1, 'ArrowUp', 4)).toBe(0);
    expect(getNextSlotIndex(3, 'ArrowRight', 4)).toBe(0);
    expect(getNextSlotIndex(0, 'ArrowLeft', 4)).toBe(3);
    expect(getNextSlotIndex(1, 'Enter', 4)).toBeNull();
  });

  it('renders selected-slot cards with honest details, unknown time, and accessible recipe actions', () => {
    const markup = renderToStaticMarkup(
      <TodayRecommendationResults response={response} slot="lunch" onChoose={vi.fn()} />,
    );

    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain('Almuerzo');
    expect(markup).toContain('Una opción de tu historial reciente.');
    expect(markup).toContain('Origen: historial reciente');
    expect(markup).toContain('Disponible: </dt><dd class="inline text-[#6B5A50]">arroz</dd>');
    expect(markup).toContain('Falta: </dt><dd class="inline text-[#6B5A50]">tomate, aceite</dd>');
    expect(markup).toContain('Tiempo no estimado');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Solo se aplican las restricciones guardadas. No se han verificado alergias ni preferencias desconocidas.');
    expect(markup).toContain('aria-label="Ver receta: Arroz con tomate"');
    expect(markup).not.toMatch(/allerg(y|ies).{0,20}(safe|checked)/i);
  });

  it('fails closed when a response option does not match the selected slot', () => {
    const mismatched: TodayResponse = { status: 'success', options: [{ ...option, slot: 'dinner' }], warnings: [] };
    const onChoose = vi.fn();
    const markup = renderToStaticMarkup(
      <TodayRecommendationResults response={mismatched} slot="lunch" onChoose={onChoose} />,
    );

    expect(markup).toContain('No encontramos opciones para este momento.');
    expect(markup).not.toContain('Arroz con tomate');
    expect(markup).not.toContain('Ver receta');
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('discards a pending lunch response after dinner is selected and keeps the loading slot truthful', async () => {
    const deferred = createDeferred<{ ok: true; data: TodayResponse }>();
    vi.mocked(safeFetch).mockReturnValueOnce(deferred.promise);
    hookHarness.states = [];
    hookHarness.active = true;

    const render = () => {
      hookHarness.cursor = 0;
      return TodayRecommendations({ onChoose: vi.fn() });
    };
    const findButton = (tree: unknown, name: string): { props: Record<string, unknown> } => {
      if (!tree || typeof tree !== 'object') throw new Error(`Button not found: ${name}`);
      const element = tree as { type?: unknown; props?: Record<string, unknown> };
      if (element.type === 'button' && element.props?.children === name) return element as { props: Record<string, unknown> };
      const children = element.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        try { return findButton(child, name); } catch { /* Continue through the element tree. */ }
      }
      throw new Error(`Button not found: ${name}`);
    };
    const textContent = (tree: unknown): string => {
      if (typeof tree === 'string') return tree;
      if (!tree || typeof tree !== 'object') return '';
      const props = (tree as { props?: { children?: unknown } }).props;
      return (Array.isArray(props?.children) ? props.children : [props?.children]).map(textContent).join('');
    };

    try {
      let tree = render();
      (findButton(tree, 'Almuerzo').props.onClick as () => void)();
      tree = render();
      (findButton(tree, 'Ver opciones').props.onClick as () => void)();
      await Promise.resolve();
      tree = render();
      expect(textContent(tree)).toContain('Buscando opciones para Almuerzo');
      (findButton(tree, 'Cena').props.onClick as () => void)();
      tree = render();
      expect(textContent(tree)).toContain('Buscando opciones para Almuerzo');

      deferred.resolve({ ok: true, data: { status: 'success', options: [{ ...option, slot: 'dinner', title: 'Cena vieja' }] } });
      await deferred.promise;
      tree = render();
      expect(textContent(tree)).not.toContain('Cena vieja');
      expect(textContent(tree)).not.toContain('Buscando opciones');
    } finally {
      hookHarness.active = false;
      hookHarness.states = [];
      vi.mocked(safeFetch).mockReset();
    }
  });

  it('does not show a stale request error under a newly selected slot', async () => {
    const deferred = createDeferred<{ ok: true; data: TodayResponse }>();
    vi.mocked(safeFetch).mockReturnValueOnce(deferred.promise);
    hookHarness.states = [];
    hookHarness.active = true;
    const render = () => {
      hookHarness.cursor = 0;
      return TodayRecommendations({ onChoose: vi.fn() });
    };
    const findButton = (tree: unknown, name: string): { props: Record<string, unknown> } => {
      if (!tree || typeof tree !== 'object') throw new Error(`Button not found: ${name}`);
      const element = tree as { type?: unknown; props?: Record<string, unknown> };
      if (element.type === 'button' && element.props?.children === name) return element as { props: Record<string, unknown> };
      const children = element.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        try { return findButton(child, name); } catch { /* Continue through the element tree. */ }
      }
      throw new Error(`Button not found: ${name}`);
    };

    try {
      let tree = render();
      (findButton(tree, 'Almuerzo').props.onClick as () => void)();
      tree = render();
      (findButton(tree, 'Ver opciones').props.onClick as () => void)();
      await Promise.resolve();
      tree = render();
      (findButton(tree, 'Cena').props.onClick as () => void)();
      deferred.reject(new Error('Lunch request failed'));
      await deferred.promise.catch(() => undefined);
      tree = render();
      expect(JSON.stringify(tree)).not.toContain('No pudimos cargar');
      expect(JSON.stringify(tree)).not.toContain('Arroz con tomate');
    } finally {
      hookHarness.active = false;
      hookHarness.states = [];
      vi.mocked(safeFetch).mockReset();
    }
  });

  it('shows same-slot asynchronous success and error outcomes', async () => {
    const success = createDeferred<{ ok: true; data: TodayResponse }>();
    const failure = createDeferred<{ ok: true; data: TodayResponse }>();
    vi.mocked(safeFetch).mockReturnValueOnce(success.promise).mockReturnValueOnce(failure.promise);
    hookHarness.states = [];
    hookHarness.active = true;
    const render = () => {
      hookHarness.cursor = 0;
      return TodayRecommendations({ onChoose: vi.fn() });
    };
    const findButton = (tree: unknown, name: string): { props: Record<string, unknown> } => {
      if (!tree || typeof tree !== 'object') throw new Error(`Button not found: ${name}`);
      const element = tree as { type?: unknown; props?: Record<string, unknown> };
      if (element.type === 'button' && element.props?.children === name) return element as { props: Record<string, unknown> };
      const children = element.props?.children;
      for (const child of Array.isArray(children) ? children : [children]) {
        try { return findButton(child, name); } catch { /* Continue through the element tree. */ }
      }
      throw new Error(`Button not found: ${name}`);
    };
    const textContent = (tree: unknown): string => {
      if (typeof tree === 'string') return tree;
      if (!tree || typeof tree !== 'object') return '';
      const props = (tree as { props?: { children?: unknown } }).props;
      return (Array.isArray(props?.children) ? props.children : [props?.children]).map(textContent).join('');
    };

    try {
      let tree = render();
      (findButton(tree, 'Almuerzo').props.onClick as () => void)();
      tree = render();
      (findButton(tree, 'Ver opciones').props.onClick as () => void)();
      await Promise.resolve();
      success.resolve({ ok: true, data: { status: 'success', options: [{ ...option, title: 'Almuerzo actual' }] } });
      await success.promise;
      tree = render();
      expect(renderToStaticMarkup(tree)).toContain('Almuerzo actual');
      expect(textContent(tree)).not.toContain('No pudimos cargar');

      (findButton(tree, 'Ver opciones').props.onClick as () => void)();
      await Promise.resolve();
      failure.reject(new Error('Lunch request failed'));
      await failure.promise.catch(() => undefined);
      tree = render();
      expect(textContent(tree)).toContain('Lunch request failed');
      expect(textContent(tree)).not.toContain('Buscando opciones');
    } finally {
      hookHarness.active = false;
      hookHarness.states = [];
      vi.mocked(safeFetch).mockReset();
    }
  });

  it('keeps numeric preparation estimates in minutes and announces degraded and empty outcomes', () => {
    const timed = { ...option, prepMinutes: 25 };
    const degraded: TodayResponse = { status: 'degraded', reason: 'provider-unavailable', options: [timed] };
    const degradedMarkup = renderToStaticMarkup(
      <TodayRecommendationResults response={degraded} slot="lunch" onChoose={vi.fn()} />,
    );
    expect(degradedMarkup).toContain('role="status"');
    expect(degradedMarkup).toContain('No pudimos obtener suficientes sugerencias; mostramos las opciones disponibles.');
    expect(degradedMarkup).toContain('25 minutos');

    const empty = renderToStaticMarkup(
      <TodayRecommendationResults response={{ status: 'degraded', reason: 'provider-unavailable', options: [] }} slot="lunch" onChoose={vi.fn()} />,
    );
    expect(empty).toContain('No encontramos opciones para este momento.');
    expect(empty).toContain('role="status"');
  });
});
