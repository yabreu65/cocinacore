import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';

const nextConfig: NextConfig = {
  output: 'standalone',

  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';

    const headers = [
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
      },
    ];

    // CSP only in production; too restrictive for local dev
    if (!isDev) {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
      headers.push({
        key: 'Content-Security-Policy',
        value:
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com; frame-ancestors 'none';",
      });
    }

    return [
      {
        source: '/:path*',
        headers,
      },
    ];
  },
};

const sentryWrapped = withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for better stack traces
  widenClientFileUpload: true,

  // Hides source maps from generated client bundles
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});

// Bundle analyzer wrapper: only active when ANALYZE=true
const withBundleAnalyzer =
  process.env.ANALYZE === 'true'
    ? bundleAnalyzer({ enabled: true })
    : (config: NextConfig) => config;

export default withBundleAnalyzer(sentryWrapped);
