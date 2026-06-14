/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// serverLogger tests
//
// The serverLogger writes structured JSON to stdout/stderr and optionally
// sends breadcrumbs to Sentry in production. We spy on process.stdout.write
// and process.stderr.write to verify output.
//
// @typescript-eslint rules are relaxed for this file because vitest's
// vi.spyOn mock APIs are inherently dynamic and cannot be fully typed.
// ---------------------------------------------------------------------------

interface LogOutput {
  ts: string;
  level: string;
  event: string;
  [key: string]: unknown;
}

function getLastOutput(spy: ReturnType<typeof vi.spyOn>): LogOutput | null {
  const calls = spy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];
    if (call.length > 0 && typeof call[0] === 'string') {
      try {
        const parsed: unknown = JSON.parse(call[0].trim());
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as LogOutput;
        }
      } catch {
        // Not JSON — keep looking.
      }
    }
  }
  return null;
}

describe('serverLogger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'test');
    stdoutSpy = vi.spyOn(process.stdout, 'write');
    stderrSpy = vi.spyOn(process.stderr, 'write');
    vi.resetModules();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  describe('info', () => {
    it('writes structured JSON to stdout', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('test.event', { action: 'login', userId: 'u1' });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.level).toBe('info');
        expect(output.event).toBe('test.event');
        expect(output.action).toBe('login');
        expect(output.userId).toBe('u1');
        expect(typeof output.ts).toBe('string');
      }
    });

    it('handles empty payload', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('empty.event');

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.level).toBe('info');
        expect(output.event).toBe('empty.event');
      }
    });
  });

  describe('warn', () => {
    it('writes structured JSON to stdout', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.warn('warn.event', { reason: 'test' });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.level).toBe('warn');
        expect(output.event).toBe('warn.event');
      }
    });
  });

  describe('error', () => {
    it('writes structured JSON to stderr', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.error('error.event', { msg: 'boom' });

      const output = getLastOutput(stderrSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.level).toBe('error');
        expect(output.event).toBe('error.event');
        expect(output.msg).toBe('boom');
      }
    });
  });

  describe('secret redaction', () => {
    it('redacts api_key fields', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('auth.event', { api_key: 'sk-secret-123' });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.api_key).toBe('[REDACTED]');
      }
    });

    it('redacts password fields', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('login.event', { password: 'hunter2' });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.password).toBe('[REDACTED]');
      }
    });

    it('redacts token fields', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('session.event', { token: 'abc123' });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.token).toBe('[REDACTED]');
      }
    });

    it('redacts secret fields', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('config.event', { secret: 'xyz', auth_secret: 'abc' });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.secret).toBe('[REDACTED]');
        expect(output.auth_secret).toBe('[REDACTED]');
      }
    });

    it('redacts authorization header', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('request.event', { authorization: 'Bearer xyz' });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.authorization).toBe('[REDACTED]');
      }
    });

    it('redacts nested secret objects', async () => {
      const { serverLogger } = await import('./serverLogger');

      serverLogger.info('deep.event', {
        headers: { authorization: 'Bearer abc', 'content-type': 'json' },
        body: { apiKey: 'sk-123', name: 'test' },
      });

      const output = getLastOutput(stdoutSpy);
      expect(output).not.toBeNull();
      if (output) {
        const headers = output.headers as Record<string, unknown>;
        const body = output.body as Record<string, unknown>;
        expect(headers.authorization).toBe('[REDACTED]');
        expect(headers['content-type']).toBe('json');
        expect(body.apiKey).toBe('[REDACTED]');
        expect(body.name).toBe('test');
      }
    });
  });

  describe('production mode', () => {
    it('logs to stderr in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.resetModules();

      const { serverLogger } = await import('./serverLogger');

      serverLogger.error('prod.error', { detail: 'test' });

      const output = getLastOutput(stderrSpy);
      expect(output).not.toBeNull();
      if (output) {
        expect(output.level).toBe('error');
      }
    });
  });
});
