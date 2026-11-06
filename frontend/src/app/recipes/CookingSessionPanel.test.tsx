import { describe, expect, it, vi } from 'vitest';
import { executeCookingSessionRequest, stableIngredientRows } from './CookingSessionPanel';

describe('executeCookingSessionRequest', () => {
  it('clears the working state callback when the network operation rejects', async () => {
    const onError = vi.fn();
    const onFinally = vi.fn();

    await executeCookingSessionRequest(
      () => Promise.reject(new Error('network unavailable')),
      vi.fn(),
      onError,
      onFinally,
      'No se pudo completar la operación.'
    );

    expect(onError).toHaveBeenCalledWith('No se pudo completar la operación.');
    expect(onFinally).toHaveBeenCalledOnce();
  });

  it('reports an HTTP error and still runs cleanup', async () => {
    const onError = vi.fn();
    const onFinally = vi.fn();

    await executeCookingSessionRequest(
      () => Promise.resolve({ ok: false as const, error: 'Servicio no disponible', status: 503 }),
      vi.fn(),
      onError,
      onFinally,
      'Fallback'
    );

    expect(onError).toHaveBeenCalledWith('Servicio no disponible');
    expect(onFinally).toHaveBeenCalledOnce();
  });
});

describe('stableIngredientRows', () => {
  it('assigns unique persistent keys to duplicate ingredients', () => {
    const rows = stableIngredientRows([
      { name: 'Arroz', quantity: '100', unit: 'g' },
      { name: 'Arroz', quantity: '100', unit: 'g' },
    ]);

    expect(rows.map((row) => row.key)).toEqual([
      'ingredient:arroz:100:g:0',
      'ingredient:arroz:100:g:1',
    ]);
  });

  it('keeps each row identity when a reorderable collection changes order', () => {
    const first = stableIngredientRows([
      { id: 'ingredient-arroz', name: 'Arroz', quantity: '100', unit: 'g' },
      { id: 'ingredient-tomate', name: 'Tomate', quantity: '2', unit: 'unidad' },
    ]);
    const reordered = stableIngredientRows([
      { id: 'ingredient-tomate', name: 'Tomate', quantity: '2', unit: 'unidad' },
      { id: 'ingredient-arroz', name: 'Arroz', quantity: '100', unit: 'g' },
    ]);

    expect(new Set(first.map((row) => row.key))).toEqual(new Set(reordered.map((row) => row.key)));
  });
});
