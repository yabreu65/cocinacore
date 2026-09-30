import { describe, expect, it } from 'vitest';
import {
  formatStoredInventoryQuantity,
  mealConsumptionKey,
  parseMealConsumptionPayload,
} from './consumption';

describe('meal consumption state helpers', () => {
  it('builds a stable meal identity', () => {
    expect(mealConsumptionKey(2, 'lunch')).toBe('2:lunch');
  });

  it('keeps only structurally valid persisted records', () => {
    const valid = {
      consumedAt: '2026-09-30T20:00:00.000Z',
      dayIndex: 1,
      mealType: 'breakfast',
      mealTitle: 'Avena',
      decrements: [],
      skipped: [],
    };
    expect(parseMealConsumptionPayload({ '1:breakfast': valid, broken: { dayIndex: 2 } })).toEqual({
      '1:breakfast': valid,
    });
  });

  it('rejects inconsistent keys and invalid nested evidence', () => {
    const base = {
      consumedAt: '2026-09-30T20:00:00.000Z',
      dayIndex: 1,
      mealType: 'breakfast',
      mealTitle: 'Avena',
      decrements: [],
      skipped: [],
    };
    expect(parseMealConsumptionPayload({ '2:breakfast': base })).toEqual({});
    expect(
      parseMealConsumptionPayload({
        '1:breakfast': {
          ...base,
          decrements: [
            { inventoryItemId: 'i1', ingredientName: 'Avena', quantity: -1, unit: 'kg' },
          ],
        },
      })
    ).toEqual({});
    expect(
      parseMealConsumptionPayload({
        '1:breakfast': {
          ...base,
          skipped: [{ ingredientName: 'Avena', quantity: 1, unit: 'kg', reason: 'made_up' }],
        },
      })
    ).toEqual({});
  });

  it('preserves parseable quantity storage when the unit column is empty', () => {
    expect(formatStoredInventoryQuantity(0.75, null, 'kg')).toBe('0.75 kg');
    expect(formatStoredInventoryQuantity(2, null, 'unidad')).toBe('2');
    expect(formatStoredInventoryQuantity(0.75, 'kg', 'kg')).toBe('0.75');
  });
});
