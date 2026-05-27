import { describe, expect, it } from 'vitest';

import { buildInventorySuggestion } from './inventorySuggestion';

describe('buildInventorySuggestion', () => {
  it('normaliza equivalencias tomate/jitomate y suma cantidades', () => {
    const rows = buildInventorySuggestion(
      [
        { ingredient: 'tomate', quantity: 2, unit: 'unidad', source: 'Lunes almuerzo' },
        { ingredient: 'jitomate', quantity: 1, unit: 'unidad', source: 'Martes cena' },
      ],
      2,
    );

    const tomate = rows.find((item) => item.canonical_name === 'tomate');
    expect(tomate).toBeDefined();
    expect(tomate?.quantity).toBe(6);
    expect(tomate?.unit).toBe('unidad');
    expect(tomate?.sources.length).toBe(2);
  });

  it('convierte kg->g y l->ml antes de sumar', () => {
    const rows = buildInventorySuggestion(
      [
        { ingredient: 'pollo', quantity: 1, unit: 'kg' },
        { ingredient: 'leche', quantity: 0.5, unit: 'l' },
      ],
      1,
    );

    const pollo = rows.find((item) => item.canonical_name === 'pollo');
    const leche = rows.find((item) => item.canonical_name === 'leche');

    expect(pollo?.quantity).toBe(1000);
    expect(pollo?.unit).toBe('g');
    expect(leche?.quantity).toBe(500);
    expect(leche?.unit).toBe('ml');
  });

  it('escala por cantidad de personas con fallback a 4', () => {
    const rows = buildInventorySuggestion([{ ingredient: 'arroz', quantity: 100, unit: 'g' }], 0);
    const arroz = rows.find((item) => item.canonical_name === 'arroz');
    expect(arroz?.quantity).toBe(400);
  });

  it('marca estimados y conserva confianza mínima', () => {
    const rows = buildInventorySuggestion(
      [
        { ingredient: 'ajo', quantity: null, unit: 'unidad', estimated: true, confidence: 0.4 },
        { ingredient: 'ajo', quantity: 2, unit: 'unidad', estimated: false, confidence: 1 },
      ],
      1,
    );

    const ajo = rows.find((item) => item.canonical_name === 'ajo');
    expect(ajo?.estimated).toBe(true);
    expect(ajo?.confidence).toBe(0.4);
  });
});
