import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { getCloneableBody } from 'next/dist/server/body-streams';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withSentryConfig: vi.fn((...args: unknown[]) => args[0]),
  bundleAnalyzer: vi.fn((...options: [{ enabled: boolean }]) => {
    void options;
    return (config: unknown) => config;
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  withSentryConfig: mocks.withSentryConfig,
}));

vi.mock('@next/bundle-analyzer', () => ({
  default: mocks.bundleAnalyzer,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Next.js Sentry build configuration', () => {
  it('passes the expected build options to Sentry', async () => {
    vi.stubEnv('SENTRY_ORG', 'test-sentry-org');
    vi.stubEnv('SENTRY_PROJECT', 'test-sentry-project');
    vi.stubEnv('CI', 'true');
    vi.stubEnv('ANALYZE', 'true');
    vi.resetModules();

    await import('../next.config');

    expect(mocks.withSentryConfig).toHaveBeenCalledTimes(1);
    const sentryOptions = mocks.withSentryConfig.mock.calls[0]?.[1];
    expect(sentryOptions).toMatchObject({
      telemetry: false,
      org: 'test-sentry-org',
      project: 'test-sentry-project',
      silent: false,
      widenClientFileUpload: true,
      sourcemaps: {
        deleteSourcemapsAfterUpload: true,
      },
    });

    expect(mocks.bundleAnalyzer).toHaveBeenCalledWith({ enabled: true });
  });
});


describe('standalone multipart transport', () => {
  const MiB = 1024 * 1024;

  async function cloneMultipart(bytes: Uint8Array, contentType: string, limit?: number) {
    // Exercise the installed Next.js implementation without a live endpoint,
    // real session, database, storage or provider.
    const pieces = function* () {
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        yield Buffer.from(bytes.subarray(offset, offset + 64 * 1024));
      }
    };
    const stream = Readable.from(pieces()) as unknown as IncomingMessage;
    const clone = getCloneableBody(stream, limit);
    const middlewareBody = clone.cloneBodyStream();
    for await (const _chunk of middlewareBody) { void _chunk; }
    await clone.finalize();
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, { headers: { 'Content-Type': contentType } }).formData();
  }

  it('preserves a large PDF and its index through the real Next middleware body clone', async () => {
    vi.resetModules();
    const { default: config } = await import('../next.config');
    const limit = config.experimental?.proxyClientMaxBodySize;
    expect(limit).toBe(50 * MiB);
    if (typeof limit !== 'number') throw new Error('Missing numeric upload limit');
    const form = new FormData();
    const pdf = new Uint8Array(30 * MiB);
    pdf.set(new TextEncoder().encode('%PDF-1.7\n'));
    pdf[pdf.length - 1] = 42;
    form.set('file', new File([pdf], 'synthetic.pdf', { type: 'application/pdf' }));
    const index = JSON.stringify(Array.from({ length: 308 }, (_, page) => ({
      content: 'synthetic '.repeat(90),
      pageNumber: page + 1,
      embedding: Array.from({ length: 1536 }, (_, i) => Math.sin(i + 1)),
    })));
    form.set('chunks', index);
    const request = new Request('http://localhost/fixture', { method: 'POST', body: form });
    const contentType = request.headers.get('Content-Type');
    if (!contentType) throw new Error('Missing multipart boundary');
    const bytes = new Uint8Array(await request.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(10 * MiB);
    expect(bytes.length).toBeLessThan(49 * MiB);

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(cloneMultipart(bytes, contentType)).rejects.toThrow();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Request body exceeded 10MB'));
      warning.mockClear();
      const received = await cloneMultipart(bytes, contentType, limit);
      expect(warning).not.toHaveBeenCalled();
      const file = received.get('file');
      expect(file).toBeInstanceOf(File);
      if (!(file instanceof File)) throw new Error('Missing complete PDF');
      expect(file.size).toBe(pdf.length);
      expect(new Uint8Array(await file.arrayBuffer()).at(-1)).toBe(42);
      expect(received.get('chunks')).toBe(index);
    } finally {
      warning.mockRestore();
    }
  }, 15_000);
});
