export type HistoryOperation = 'save' | 'feedback' | 'delete' | 'import';

export function createHistoryOperationGate() {
  const pending = new Map<string, HistoryOperation>();
  return {
    begin(id: string, operation: HistoryOperation): boolean {
      if (pending.has(id)) return false;
      pending.set(id, operation);
      return true;
    },
    finish(id: string, operation: HistoryOperation): void {
      if (pending.get(id) === operation) pending.delete(id);
    },
    snapshot() {
      return new Map(pending);
    },
    get size() {
      return pending.size;
    },
  };
}
