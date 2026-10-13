import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withSentryConfig: vi.fn((...args: unknown[]) => args[0]),
  bundleAnalyzer: vi.fn(
    (_options: { enabled: boolean }) => (config: unknown) => config,
  ),
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
