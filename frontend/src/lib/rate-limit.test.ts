import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from './rate-limit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulates time passing by advancing the system clock. */
function advanceSeconds(seconds: number): void {
  vi.advanceTimersByTime(seconds * 1000);
}

// ---------------------------------------------------------------------------
// checkRateLimit tests (in-memory fallback path — no Redis in tests)
// ---------------------------------------------------------------------------

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Ensure REDIS_URL is not set so we always hit in-memory fallback in tests
    vi.stubEnv('REDIS_URL', '');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  // -----------------------------------------------------------------------
  // Basic sliding window
  // -----------------------------------------------------------------------

  it('allows requests up to the configured limit', async () => {
    const route = 'recipe-generate'; // limit: 10, window: 60s
    const ip = '1.2.3.4';

    for (let i = 0; i < 10; i++) {
      const result = await checkRateLimit(route, ip);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(9 - i);
      expect(result.limit).toBe(10);
    }
  });

  it('blocks requests once the limit is exceeded', async () => {
    const route = 'recipe-generate'; // 10 req / 60s
    const ip = '1.2.3.4';

    // Exhaust the limit
    for (let i = 0; i < 10; i++) {
      await checkRateLimit(route, ip);
    }

    const blocked = await checkRateLimit(route, ip);
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(10);
  });

  it('resets the window after the sliding period', async () => {
    const route = 'embeddings'; // 25 req / 60s
    const ip = '5.5.5.5';

    // Exhaust
    for (let i = 0; i < 25; i++) {
      await checkRateLimit(route, ip);
    }

    expect((await checkRateLimit(route, ip)).success).toBe(false);

    // Advance past the window
    advanceSeconds(61);

    // Should be allowed again
    const after = await checkRateLimit(route, ip);
    expect(after.success).toBe(true);
    expect(after.remaining).toBe(24); // 25 - 1
  });

  // -----------------------------------------------------------------------
  // Per-route limits
  // -----------------------------------------------------------------------

  it('enforces route-specific limits (meal-plan = 5)', async () => {
    const ip = '10.0.0.1';

    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('meal-plan', ip)).success).toBe(true);
    }

    expect((await checkRateLimit('meal-plan', ip)).success).toBe(false);
  });

  it('enforces route-specific limits (meal-plan/warmup = 3)', async () => {
    const ip = '10.0.0.2';

    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit('meal-plan/warmup', ip)).success).toBe(true);
    }

    expect((await checkRateLimit('meal-plan/warmup', ip)).success).toBe(false);
  });

  it('enforces route-specific limits (inventory-suggestion = 8)', async () => {
    const ip = '10.0.0.3';

    for (let i = 0; i < 8; i++) {
      expect((await checkRateLimit('inventory-suggestion', ip)).success).toBe(true);
    }

    expect((await checkRateLimit('inventory-suggestion', ip)).success).toBe(false);
  });

  it('enforces route-specific limits (embeddings = 25)', async () => {
    const ip = '10.0.0.4';

    for (let i = 0; i < 25; i++) {
      expect((await checkRateLimit('embeddings', ip)).success).toBe(true);
    }

    expect((await checkRateLimit('embeddings', ip)).success).toBe(false);
  });

  // -----------------------------------------------------------------------
  // IP isolation
  // -----------------------------------------------------------------------

  it('isolates rate limits per IP address', async () => {
    const ipA = '192.168.0.1';
    const ipB = '192.168.0.2';

    // Exhaust ipA for recipe-generate
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('recipe-generate', ipA);
    }

    // ipA should be blocked
    expect((await checkRateLimit('recipe-generate', ipA)).success).toBe(false);

    // ipB should still have full capacity
    const ipBResult = await checkRateLimit('recipe-generate', ipB);
    expect(ipBResult.success).toBe(true);
    expect(ipBResult.remaining).toBe(9);
  });

  // -----------------------------------------------------------------------
  // User ID scoping
  // -----------------------------------------------------------------------

  it('isolates rate limits per userId within the same IP', async () => {
    const ip = '10.0.0.5';

    // Exhaust user-a
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('recipe-generate', ip, 'user-a');
    }

    // user-a is blocked
    expect((await checkRateLimit('recipe-generate', ip, 'user-a')).success).toBe(false);

    // user-b on same IP still has capacity
    expect((await checkRateLimit('recipe-generate', ip, 'user-b')).success).toBe(true);
  });

  // -----------------------------------------------------------------------
  // resetAt correctness
  // -----------------------------------------------------------------------

  it('returns a resetAt timestamp in the future when blocked', async () => {
    const now = Date.now();

    for (let i = 0; i < 10; i++) {
      await checkRateLimit('recipe-generate', '1.1.1.1');
    }

    const blocked = await checkRateLimit('recipe-generate', '1.1.1.1');
    expect(blocked.success).toBe(false);
    expect(blocked.resetAt).toBeGreaterThan(Math.floor(now / 1000));
  });

  it('resets properly after the window passes using resetAt', async () => {
    const ip = '11.11.11.11';

    for (let i = 0; i < 5; i++) {
      await checkRateLimit('meal-plan', ip);
    }

    const blocked = await checkRateLimit('meal-plan', ip);
    expect(blocked.success).toBe(false);

    // Advance past resetAt
    const waitMs = (blocked.resetAt - Math.floor(Date.now() / 1000)) * 1000 + 1000;
    advanceSeconds(waitMs / 1000);

    const after = await checkRateLimit('meal-plan', ip);
    expect(after.success).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Unknown route fallback
  // -----------------------------------------------------------------------

  it('applies a generous default limit for unknown routes', async () => {
    // Default is 100 req/60s for unknown routes
    for (let i = 0; i < 100; i++) {
      expect((await checkRateLimit('unknown-route', '99.99.99.99')).success).toBe(true);
    }

    expect((await checkRateLimit('unknown-route', '99.99.99.99')).success).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Partial window consumption
  // -----------------------------------------------------------------------

  it('correctly reports remaining count mid-window', async () => {
    const ip = '12.12.12.12';

    // Consume 3 out of 10
    for (let i = 0; i < 3; i++) {
      await checkRateLimit('recipe-generate', ip);
    }

    const result = await checkRateLimit('recipe-generate', ip);
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(6); // 10 - 4 (including this one)
  });

  // -----------------------------------------------------------------------
  // Sliding window: only counts requests within the window
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Auth endpoint rate limiting (longer windows)
  // -----------------------------------------------------------------------

  it('enforces auth/password-reset limits (3/15min)', async () => {
    const ip = '20.20.20.20';

    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit('auth/password-reset', ip)).success).toBe(true);
    }

    expect((await checkRateLimit('auth/password-reset', ip)).success).toBe(false);
  });

  it('enforces auth/login limits (8/15min)', async () => {
    const ip = '21.21.21.21';

    for (let i = 0; i < 8; i++) {
      expect((await checkRateLimit('auth/login', ip)).success).toBe(true);
    }

    expect((await checkRateLimit('auth/login', ip)).success).toBe(false);
  });

  it('enforces auth/signup limits (5/15min)', async () => {
    const ip = '22.22.22.22';

    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('auth/signup', ip)).success).toBe(true);
    }

    expect((await checkRateLimit('auth/signup', ip)).success).toBe(false);
  });

  it('resets auth limits after the 15-minute window passes', async () => {
    const ip = '23.23.23.23';

    // Exhaust password-reset: 3 req / 15 min
    for (let i = 0; i < 3; i++) {
      await checkRateLimit('auth/password-reset', ip);
    }
    expect((await checkRateLimit('auth/password-reset', ip)).success).toBe(false);

    // Advance 16 minutes
    advanceSeconds(960);

    // Should be reset now
    expect((await checkRateLimit('auth/password-reset', ip)).success).toBe(true);
  });

  it('slides the window so old requests expire and new ones are allowed', async () => {
    const ip = '13.13.13.13';

    // Make 5 requests at t=0
    for (let i = 0; i < 5; i++) {
      await checkRateLimit('meal-plan', ip);
    }

    // Advance 30 seconds
    advanceSeconds(30);

    // Make 5 more requests — should fail on the 6th BEFORE 60s passes
    for (let i = 0; i < 5; i++) {
      await checkRateLimit('meal-plan', ip);
    }
    expect((await checkRateLimit('meal-plan', ip)).success).toBe(false);

    // Advance past 60s from initial request
    advanceSeconds(31);

    // Now the first 5 have expired, so we can make more
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('meal-plan', ip)).success).toBe(true);
    }
  });
});
