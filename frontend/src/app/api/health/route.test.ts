import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------

const mockPoolClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn(() => Promise.resolve(mockPoolClient)),
};

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(() => mockPool),
}));

// Must import AFTER mocks are set up.
const { GET } = await import('./route');

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface HealthResponseBody {
  status: 'ok' | 'degraded' | 'unavailable';
  timestamp: string;
  uptime: number;
  dependencies: {
    database: { status: string; latencyMs: number; error?: string };
    redis: { status: string; latencyMs: number; error?: string };
  };
}

// ---------------------------------------------------------------------------

function resetToHappyPath(): void {
  mockPoolClient.query.mockReset();
  mockPoolClient.release.mockReset();
  mockPool.connect.mockReset();
  mockPool.connect.mockResolvedValue(mockPoolClient);
  mockPoolClient.query.mockResolvedValue(undefined);
}

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    vi.stubEnv('NODE_ENV', 'test');
    vi.useFakeTimers();
    resetToHappyPath();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  async function getBody(): Promise<HealthResponseBody> {
    const response = await GET();
    return (await response.json()) as HealthResponseBody;
  }

  it('returns degraded when database is healthy but Redis is not configured', async () => {
    const body = await getBody();

    expect(body.status).toBe('degraded');
    expect(body.dependencies.database.status).toBe('ok');
    expect(body.dependencies.redis.status).toBe('degraded');
    expect(body.dependencies.redis.error).toBeUndefined();
  });

  it('returns unavailable when database check fails', async () => {
    mockPoolClient.query.mockRejectedValue(new Error('connection refused'));

    const body = await getBody();

    expect(body.status).toBe('unavailable');
    expect(body.dependencies.database.status).toBe('unavailable');
    expect(body.dependencies.database.error).toBeUndefined();
  });

  it('returns 503 when a dependency is unavailable', async () => {
    mockPoolClient.query.mockRejectedValue(new Error('connection refused'));

    const response = await GET();

    expect(response.status).toBe(503);
  });

  it('returns unavailable when database connect fails', async () => {
    mockPool.connect.mockRejectedValue(new Error('connect ETIMEDOUT'));

    const body = await getBody();

    expect(body.dependencies.database.status).toBe('unavailable');
  });

  it('includes timestamp and uptime in the response', async () => {
    const body = await getBody();

    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('includes latency measurements', async () => {
    const body = await getBody();

    expect(typeof body.dependencies.database.latencyMs).toBe('number');
    expect(typeof body.dependencies.redis.latencyMs).toBe('number');
    expect(body.dependencies.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('releases the database client after a successful query', async () => {
    await GET();

    expect(mockPoolClient.release).toHaveBeenCalled();
  });

  it('releases the database client after a failed query', async () => {
    mockPoolClient.query.mockRejectedValue(new Error('fail'));

    await GET();

    expect(mockPoolClient.release).toHaveBeenCalled();
  });

  it('calls SELECT 1 on the database', async () => {
    await GET();

    expect(mockPoolClient.query).toHaveBeenCalledWith('SELECT 1');
  });
});
