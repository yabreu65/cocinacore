import { afterEach, describe, expect, it, vi } from 'vitest';

interface RedisMock {
  connect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  eval: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<[number, number, string]>>>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  disconnect: () => void;
}

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    connect: vi.fn(async (): Promise<void> => {}),
    eval: vi.fn(async (..._args: unknown[]): Promise<[number, number, string]> => {
      void _args;
      return [0, 5, '1800000000000'];
    }),
    on: vi.fn() as RedisMock['on'],
    disconnect: vi.fn() as RedisMock['disconnect'],
  } satisfies RedisMock,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('checkRateLimit Redis path', () => {
  it('uses the oldest sorted-set score to calculate the blocked reset time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_055_000));
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    expect(process.env.REDIS_URL).toBe('redis://localhost:6379');
    vi.resetModules();
    vi.doMock('ioredis', () => ({
      default: class RedisMockClient {
        connect(): Promise<void> {
          return redisMock.connect();
        }

        eval(...args: unknown[]): Promise<[number, number, string]> {
          return redisMock.eval(...args);
        }

        on(event: string, listener: (...args: unknown[]) => void): void {
          redisMock.on(event, listener);
        }

        disconnect(): void {
          redisMock.disconnect();
        }
      },
    }));

    const { checkRateLimit } = await import('./rate-limit');
    const result = await checkRateLimit('today', '1.2.3.4', 'user-1');

    expect(redisMock.connect).toHaveBeenCalledTimes(1);
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')"),
      1,
      'rl:today:1.2.3.4:user-1',
      1_800_000_055_000,
      60,
      5,
      expect.any(String)
    );
    expect(result.success).toBe(false);
    expect(result.resetAt).toBe(1_800_000_060);
  });

  it('falls back to the in-memory limiter when Redis returns a malformed score', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_055_000));
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    expect(process.env.REDIS_URL).toBe('redis://localhost:6379');
    vi.resetModules();
    vi.doMock('ioredis', () => ({
      default: class RedisMockClient {
        connect(): Promise<void> {
          return redisMock.connect();
        }

        eval(...args: unknown[]): Promise<[number, number, string]> {
          return redisMock.eval(...args);
        }

        on(event: string, listener: (...args: unknown[]) => void): void {
          redisMock.on(event, listener);
        }

        disconnect(): void {
          redisMock.disconnect();
        }
      },
    }));
    redisMock.eval.mockResolvedValueOnce([0, 5, '   ']);

    const { checkRateLimit } = await import('./rate-limit');
    const result = await checkRateLimit('today', '1.2.3.4', 'user-1');

    expect(redisMock.connect).toHaveBeenCalledTimes(1);
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.resetAt).toBe(1_800_000_115);
  });

  it('fails closed for required shared limits when Redis returns a malformed score', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_055_000));
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.resetModules();
    vi.doMock('ioredis', () => ({
      default: class RedisMockClient {
        connect(): Promise<void> {
          return redisMock.connect();
        }

        eval(...args: unknown[]): Promise<[number, number, string]> {
          return redisMock.eval(...args);
        }

        on(event: string, listener: (...args: unknown[]) => void): void {
          redisMock.on(event, listener);
        }

        disconnect(): void {
          redisMock.disconnect();
        }
      },
    }));
    redisMock.eval.mockResolvedValueOnce([0, 5, '   ']);

    const { checkRateLimit } = await import('./rate-limit');
    const result = await checkRateLimit('cooking-teacher-user', 'user-1', undefined, {
      requireSharedStore: true,
    });

    expect(result.success).toBe(false);
    expect(result.storage).toBe('unavailable');
    expect(result.remaining).toBe(0);
  });

  it('reconnects after a transient Redis command failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_800_000_055_000));
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    vi.resetModules();
    vi.doMock('ioredis', () => ({
      default: class RedisMockClient {
        connect(): Promise<void> {
          return redisMock.connect();
        }

        eval(...args: unknown[]): Promise<[number, number, string]> {
          return redisMock.eval(...args);
        }

        on(event: string, listener: (...args: unknown[]) => void): void {
          redisMock.on(event, listener);
        }

        disconnect(): void {
          redisMock.disconnect();
        }
      },
    }));
    redisMock.eval.mockRejectedValueOnce(new Error('transient Redis failure'));

    const { checkRateLimit } = await import('./rate-limit');
    const failed = await checkRateLimit('today', '1.2.3.4', undefined, {
      requireSharedStore: true,
    });
    expect(failed.storage).toBe('unavailable');

    vi.advanceTimersByTime(1_001);
    redisMock.eval.mockResolvedValueOnce([1, 1, '1800000055000']);
    const recovered = await checkRateLimit('today', '1.2.3.4', undefined, {
      requireSharedStore: true,
    });

    expect(recovered.storage).toBe('redis');
    expect(recovered.success).toBe(true);
    expect(redisMock.connect).toHaveBeenCalledTimes(2);
    expect(redisMock.eval).toHaveBeenCalledTimes(2);
  });
});
