import { ReconciliationSchema, type ReconciliationRequest } from './reconciliation-request';

export type ReconciliationReceipt = { operationId: string; movementCount: number };
const key = (sessionId: string) => `cooking-reconciliation:${sessionId}`;
const pendingKey = (sessionId: string) => `${key(sessionId)}:pending:v1`;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Only a complete, validated request is recoverable. An orphaned pre-upgrade
// key is never reused for a newly edited form. The server receipt is checked
// before allowing a new request, and uniqueness is enforced by PostgreSQL.
export function readPendingReconciliation(
  storage: StorageAccess,
  sessionId: string
): ReconciliationRequest | null {
  const raw = storage.getItem(pendingKey(sessionId));
  if (raw === null) return null;
  const result = ReconciliationSchema.safeParse(JSON.parse(raw));
  if (!result.success) throw new Error('Invalid pending reconciliation');
  return result.data;
}
export function persistReconciliation(
  storage: StorageAccess,
  sessionId: string,
  request: ReconciliationRequest
): ReconciliationRequest {
  const existing = readPendingReconciliation(storage, sessionId);
  if (existing) return existing;
  const validated = ReconciliationSchema.parse(request);
  storage.setItem(pendingKey(sessionId), JSON.stringify(validated));
  return validated;
}
export function clearPendingReconciliation(storage: StorageAccess, sessionId: string) {
  storage.removeItem(pendingKey(sessionId));
  storage.removeItem(key(sessionId));
}
