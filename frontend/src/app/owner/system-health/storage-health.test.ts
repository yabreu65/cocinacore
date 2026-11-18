import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStorageHealth, summarizeHealth } from './storage-health';

afterEach(() => vi.unstubAllGlobals());

function mockHealth(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('public storage readiness display', () => {
  it('reads the existing health endpoint without caching', async () => {
    const fetchMock = mockHealth({ dependencies: { storage: { status: 'ok', latencyMs: 7 } } });
    expect(await loadStorageHealth()).toEqual({ status: 'ok', latency: 7 });
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));
  });

  it('reads an unavailable storage check from a valid 503 response', async () => {
    mockHealth({ dependencies: { storage: { status: 'unavailable', latencyMs: 2000 } } }, 503);
    expect(await loadStorageHealth()).toEqual({ status: 'fail', latency: 2000 });
  });

  it('preserves degraded storage readiness', async () => {
    mockHealth({ dependencies: { storage: { status: 'degraded', latencyMs: 2 } } }, 503);
    expect(await loadStorageHealth()).toEqual({ status: 'degraded', latency: 2 });
  });

  it.each([
    {},
    { dependencies: {} },
    { dependencies: { storage: { status: 'ok', latencyMs: -1 } } },
    { dependencies: { storage: { status: 'unexpected', latencyMs: 1 } } },
  ])('does not invent storage status or latency when evidence is absent or invalid: %j', async (body) => {
    mockHealth(body);
    expect(await loadStorageHealth()).toEqual({ status: 'unknown', latency: null });
  });

  it('reports an unsuccessful transport as unknown rather than a storage failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await loadStorageHealth()).toEqual({ status: 'unknown', latency: null });
    mockHealth({ dependencies: { storage: { status: 'ok', latencyMs: 1 } } }, 500);
    expect(await loadStorageHealth()).toEqual({ status: 'unknown', latency: null });
  });

  it('does not mark the entire dashboard healthy when storage is degraded or unknown', () => {
    expect(summarizeHealth('ok', { status: 'ok', latency: 1 })).toBe('ok');
    expect(summarizeHealth('ok', { status: 'degraded', latency: 1 })).toBe('degraded');
    expect(summarizeHealth('ok', { status: 'fail', latency: 1 })).toBe('degraded');
    expect(summarizeHealth('ok', { status: 'unknown', latency: null })).toBe('partial');
    expect(summarizeHealth('degraded', { status: 'ok', latency: 1 })).toBe('degraded');
  });
});
