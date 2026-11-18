export type StorageHealth = {
  status: 'ok' | 'fail' | 'degraded' | 'unknown';
  latency: number | null;
};

const UNKNOWN: StorageHealth = { status: 'unknown', latency: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reuse the public readiness contract, including a valid HTTP 503 response. */
export async function loadStorageHealth(): Promise<StorageHealth> {
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (response.status !== 200 && response.status !== 503) return UNKNOWN;
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.dependencies)) return UNKNOWN;
    const storage = body.dependencies.storage;
    if (!isRecord(storage)) return UNKNOWN;
    const latency = storage.latencyMs;
    if (typeof latency !== 'number' || !Number.isFinite(latency) || latency < 0) {
      return UNKNOWN;
    }
    switch (storage.status) {
      case 'ok': return { status: 'ok', latency };
      case 'degraded': return { status: 'degraded', latency };
      case 'unavailable': return { status: 'fail', latency };
      default: return UNKNOWN;
    }
  } catch {
    return UNKNOWN;
  }
}

export function summarizeHealth(
  ownerStatus: 'ok' | 'degraded',
  storage: StorageHealth,
): 'ok' | 'degraded' | 'partial' {
  if (ownerStatus === 'degraded' || storage.status === 'fail' || storage.status === 'degraded') {
    return 'degraded';
  }
  return storage.status === 'ok' ? 'ok' : 'partial';
}
