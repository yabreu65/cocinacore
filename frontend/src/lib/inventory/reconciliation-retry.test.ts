import { describe, expect, it, vi } from 'vitest';
import {
  readPendingReconciliation,
  persistReconciliation,
  clearPendingReconciliation,
} from './reconciliation-retry';
import type { ReconciliationRequest } from './reconciliation-request';
const sessionId = 'session-1';
const lot = '88888888-8888-4888-8888-888888888888';
const request: ReconciliationRequest = {
  expectedVersion: 3,
  idempotencyKey: 'original-key',
  confirmed: true,
  items: [
    {
      ingredientIndex: 0,
      originalIngredient: 'Arroz',
      outcome: 'used',
      effectiveIngredient: 'Arroz',
      quantity: 600,
      unit: 'g',
      inventoryItemId: lot,
      substituteIngredient: null,
      substituteInventoryItemId: null,
    },
  ],
};
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
}
describe('pending reconciliation recovery', () => {
  it('restores the exact request after reload and ignores edited items or version on retry', () => {
    const local = storage();
    const original = persistReconciliation(local, sessionId, request);
    expect(readPendingReconciliation(local, sessionId)).toEqual(original);
    const next = persistReconciliation(local, sessionId, {
      ...request,
      idempotencyKey: 'new-key',
      expectedVersion: 4,
      items: [{ ...request.items[0], quantity: 100 }],
    });
    expect(JSON.stringify(next)).toBe(JSON.stringify(original));
    expect(local.setItem).toHaveBeenCalledOnce();
  });
  it('never reuses an orphaned old key and keeps sessions separate', () => {
    const local = storage();
    local.setItem('cooking-reconciliation:session-1', 'old-key-without-body');
    expect(readPendingReconciliation(local, sessionId)).toBeNull();
    expect(persistReconciliation(local, sessionId, request).idempotencyKey).toBe('original-key');
    expect(readPendingReconciliation(local, 'session-2')).toBeNull();
    clearPendingReconciliation(local, sessionId);
    expect(readPendingReconciliation(local, sessionId)).toBeNull();
    expect(local.getItem('cooking-reconciliation:session-1')).toBeNull();
  });
  it('fails closed on invalid or unreadable storage and never overwrites a pending request', () => {
    const local = storage();
    local.setItem('cooking-reconciliation:session-1:pending:v1', '{"idempotencyKey":"old"}');
    expect(() => persistReconciliation(local, sessionId, request)).toThrow();
    expect(local.setItem).toHaveBeenCalledOnce();
    const unavailable = storage();
    unavailable.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => persistReconciliation(unavailable, sessionId, request)).toThrow('quota');
  });
});
