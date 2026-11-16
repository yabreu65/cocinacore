import { describe, expect, it } from 'vitest';
import { createHistoryOperationGate } from './history-operation-gate';

describe('recipe history per-row operation gate', () => {
  it('keeps the first row locked while another row starts or finishes', async () => {
    const gate = createHistoryOperationGate();
    expect(gate.begin('a', 'save')).toBe(true);
    expect(gate.begin('b', 'feedback')).toBe(true);
    expect(gate.begin('a', 'delete')).toBe(false);
    expect(gate.begin('a', 'import')).toBe(false);
    gate.finish('b', 'feedback');
    expect(gate.snapshot()).toEqual(new Map([['a', 'save']]));
    expect(gate.begin('a', 'feedback')).toBe(false);
    gate.finish('a', 'save');
    expect(gate.begin('a', 'delete')).toBe(true);
  });
  it('does not release another operation or affect another row', () => {
    const gate = createHistoryOperationGate();
    expect(gate.begin('a', 'import')).toBe(true);
    expect(gate.begin('b', 'import')).toBe(true);
    gate.finish('a', 'save');
    expect(gate.size).toBe(2);
    gate.finish('a', 'import');
    expect(gate.begin('b', 'delete')).toBe(false);
    expect(gate.size).toBe(1);
  });
});
