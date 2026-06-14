import * as Sentry from '@sentry/nextjs';

const tracesSampleRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
  ? Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
  : process.env.NODE_ENV === 'production'
    ? 0.1
    : 1.0;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate,
  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
