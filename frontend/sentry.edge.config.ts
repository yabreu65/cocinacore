import * as Sentry from '@sentry/nextjs';

const tracesSampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE
  ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
  : process.env.NODE_ENV === 'production'
    ? 0.1
    : 1.0;

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate,
});
