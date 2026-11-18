import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';

const e2eDistDir = process.env.COCINACORE_E2E_NEXT_DIST_DIR;
if (e2eDistDir && !/^\.next-e2e-[A-Za-z0-9_-]{1,96}$/.test(e2eDistDir)) {
  throw new Error('COCINACORE_E2E_NEXT_DIST_DIR must be a safe isolated output directory.');
}

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: e2eDistDir ?? '.next',

  // The standalone ingress already bounds this upload to 50 MiB and all
  // other requests to 2 MiB. Keep the authenticated middleware enabled:
  // Next's default 10 MiB clone limit otherwise truncates large multipart
  // bodies before the route can parse them.
  experimental: {
    proxyClientMaxBodySize: 50 * 1024 * 1024,
  },

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

  telemetry: false,
});

// Bundle analyzer wrapper: only active when ANALYZE=true
const withBundleAnalyzer =
  process.env.ANALYZE === 'true'
    ? bundleAnalyzer({ enabled: true })
    : (config: NextConfig) => config;

export default withBundleAnalyzer(sentryWrapped);
