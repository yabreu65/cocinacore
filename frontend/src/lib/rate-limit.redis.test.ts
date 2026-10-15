import { afterEach, describe, expect, it, vi } from 'vitest';

interface RedisMock {
  connect: ReturnType<typeof vi.fn<() => Promise<void>>>;
  script: ReturnType<typeof vi.fn<(command: string, script: string) => Promise<string>>>;
  evalsha: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<[number, number, string]>>>;
}

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    connect: vi.fn(async (): Promise<void> => {}),
    script: vi.fn(async (_command: string, _script: string) => {
      void _command;
      void _script;
      return 'dummy-sha';
    }),
    evalsha: vi.fn(async (..._args: unknown[]): Promise<[number, number, string]> => {
      void _args;
      return [0, 5, '1800000000000'];
    }),
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

        script(command: string, script: string): Promise<string> {
          return redisMock.script(command, script);
        }

        evalsha(...args: unknown[]): Promise<[number, number, string]> {
          return redisMock.evalsha(...args);
        }
      },
    }));

    const { checkRateLimit } = await import('./rate-limit');
    const result = await checkRateLimit('today', '1.2.3.4', 'user-1');

    expect(redisMock.connect).toHaveBeenCalledTimes(1);
    expect(redisMock.script).toHaveBeenCalledTimes(1);
    expect(redisMock.script).toHaveBeenCalledWith(
      'LOAD',
      expect.stringContaining("redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')"),
    );
    expect(redisMock.script).toHaveBeenCalledWith(
      'LOAD',
      expect.stringContaining('return { success, count, oldestScore }'),
    );
    expect(redisMock.evalsha).toHaveBeenCalledTimes(1);
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

        script(command: string, script: string): Promise<string> {
          return redisMock.script(command, script);
        }

        evalsha(...args: unknown[]): Promise<[number, number, string]> {
          return redisMock.evalsha(...args);
        }
      },
    }));
    redisMock.evalsha.mockResolvedValueOnce([0, 5, '   ']);

    const { checkRateLimit } = await import('./rate-limit');
    const result = await checkRateLimit('today', '1.2.3.4', 'user-1');

    expect(redisMock.connect).toHaveBeenCalledTimes(1);
    expect(redisMock.script).toHaveBeenCalledTimes(1);
    expect(redisMock.evalsha).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.resetAt).toBe(1_800_000_115);
  });
});
