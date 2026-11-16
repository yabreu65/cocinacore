import { describe, expect, it } from 'vitest';
import { planInventoryStockChange, type InventoryStockSnapshot } from './inventory-adjustment';
const stock: InventoryStockSnapshot = {
  quantity: '500',
  unit: 'gramos',
  lowStockThreshold: '250.0000',
};
describe('inventory stock adjustment contract', () => {
  it('converts quantity and minimum together without generating a physical movement', () => {
    expect(planInventoryStockChange(stock, { kind: 'convert', unit: 'kg' })).toEqual({
      ok: true,
      quantity: '0.5',
      unit: 'kg',
      lowStockThreshold: '0.25',
      movement: null,
    });
    expect(
      planInventoryStockChange(
        { quantity: '0.5', unit: 'l', lowStockThreshold: null },
        { kind: 'convert', unit: 'ml' }
      )
    ).toEqual({ ok: true, quantity: '500', unit: 'ml', lowStockThreshold: null, movement: null });
  });
  it('rejects incompatible units and precision loss rather than rounding silently', () => {
    for (const unit of ['ml', 'paquete'] as const)
      expect(planInventoryStockChange(stock, { kind: 'convert', unit })).toMatchObject({
        ok: false,
      });
    expect(
      planInventoryStockChange(
        { quantity: '0.001', unit: 'g', lowStockThreshold: null },
        { kind: 'convert', unit: 'kg' }
      )
    ).toMatchObject({ ok: false });
    expect(
      planInventoryStockChange(
        { ...stock, lowStockThreshold: '0.001' },
        { kind: 'convert', unit: 'kg' }
      )
    ).toMatchObject({ ok: false });
    expect(
      planInventoryStockChange(
        { quantity: '99999999', unit: 'kg', lowStockThreshold: null },
        { kind: 'convert', unit: 'g' }
      )
    ).toMatchObject({ ok: false });
  });
  it.each([
    ['300', '-200'],
    ['700', '200'],
    ['0', '-500'],
    ['500.0001', '0.0001'],
    ['500,25', '0.25'],
  ])('records signed delta for observed count %s', (quantity, delta) => {
    const result = planInventoryStockChange(stock, {
      kind: 'count',
      quantity,
      reason: 'Conteo físico',
    });
    expect(result).toMatchObject({
      ok: true,
      unit: 'g',
      lowStockThreshold: '250',
      movement: {
        type: 'manual_adjustment',
        quantity: delta,
        unit: 'g',
        source: 'manual_inventory_count',
      },
    });
  });
  it('does not create a movement when a repeated absolute count is unchanged', () => {
    expect(
      planInventoryStockChange(stock, { kind: 'count', quantity: '500', reason: 'Conteo' })
    ).toMatchObject({ ok: true, movement: null });
  });
  it.each(['-1', '0.00001', '1e3', '500 g', ''])('rejects invalid count %s', (quantity) => {
    expect(
      planInventoryStockChange(stock, { kind: 'count', quantity, reason: 'Conteo' })
    ).toMatchObject({ ok: false });
  });
  it('requires a nonblank bounded reason', () => {
    for (const reason of ['   ', 'x'.repeat(301)])
      expect(
        planInventoryStockChange(stock, { kind: 'count', quantity: '300', reason })
      ).toMatchObject({ ok: false });
  });
  it('never treats unknown or ambiguous legacy stock as zero', () => {
    for (const snapshot of [
      { quantity: null, unit: null, lowStockThreshold: null },
      { quantity: '1', unit: '500 gramos', lowStockThreshold: null },
    ]) {
      expect(
        planInventoryStockChange(snapshot, { kind: 'count', quantity: '500', reason: 'Conteo' })
      ).toMatchObject({ ok: false });
      expect(planInventoryStockChange(snapshot, { kind: 'convert', unit: 'kg' })).toMatchObject({
        ok: false,
      });
      const result = planInventoryStockChange(snapshot, {
        kind: 'correct',
        quantity: '500',
        unit: 'g',
        lowStockThreshold: '100',
        reason: 'Verificado físicamente',
      });
      expect(result).toMatchObject({
        ok: true,
        quantity: '500',
        unit: 'g',
        lowStockThreshold: '100',
        movement: {
          type: 'correction',
          quantity: '500',
          source: 'manual_inventory_baseline_correction',
        },
      });
      if (result.ok && result.movement)
        expect(JSON.parse(result.movement.notes)).toMatchObject({
          previous: snapshot,
          semantics: 'new_confirmed_baseline_not_delta',
        });
    }
  });
  it('does not confuse an invalid threshold with an unknown physical baseline', () => {
    const invalidThreshold = { ...stock, lowStockThreshold: '-1' };
    expect(
      planInventoryStockChange(invalidThreshold, {
        kind: 'correct',
        quantity: '300',
        unit: 'g',
        lowStockThreshold: null,
        reason: 'Conteo',
      })
    ).toMatchObject({ ok: false });
    expect(
      planInventoryStockChange(invalidThreshold, {
        kind: 'count',
        quantity: '300',
        reason: 'Conteo',
      })
    ).toMatchObject({
      ok: false,
      error: 'Corrige el stock mínimo antes de ajustar las existencias.',
    });
  });
  it('rejects a baseline correction for valid stock rather than bypassing the delta audit', () => {
    expect(
      planInventoryStockChange(stock, {
        kind: 'correct',
        quantity: '300',
        unit: 'g',
        lowStockThreshold: null,
        reason: 'Conteo',
      })
    ).toMatchObject({ ok: false });
  });
  it('permits explicitly confirmed zero baseline with no inferred negative or positive movement', () => {
    expect(
      planInventoryStockChange(
        { quantity: null, unit: null, lowStockThreshold: null },
        {
          kind: 'correct',
          quantity: '0',
          unit: 'g',
          lowStockThreshold: null,
          reason: 'No queda stock',
        }
      )
    ).toMatchObject({
      ok: true,
      quantity: '0',
      movement: {
        type: 'correction',
        quantity: '0',
        source: 'manual_inventory_baseline_correction',
      },
    });
  });
});
