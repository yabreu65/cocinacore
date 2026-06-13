type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

interface SentryBreadcrumbClient {
  addBreadcrumb(breadcrumb: {
    category: string;
    level: 'info' | 'warning' | 'error';
    message: string;
    data: LogPayload;
  }): void;
}

function isEdgeRuntime(): boolean {
  return (
    typeof (globalThis as { EdgeRuntime?: string }).EdgeRuntime !== 'undefined' ||
    typeof process === 'undefined'
  );
}

function sanitizePayload(payload: LogPayload): LogPayload {
  const SECRET_FIELD_PATTERNS = [
    /api[_-]?key/i,
    /secret/i,
    /password/i,
    /token/i,
    /authorization/i,
    /credential/i,
    /key$/i,
  ];

  const sanitized: LogPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SECRET_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizePayload(value as LogPayload);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function isSentryBreadcrumbClient(value: unknown): value is SentryBreadcrumbClient {
  return (
    typeof value === 'object' &&
    value !== null &&
    'addBreadcrumb' in value &&
    typeof value.addBreadcrumb === 'function'
  );
}

function loadSentryClient(): SentryBreadcrumbClient | null {
  try {
    // Dynamic require keeps Sentry optional during dev/CI while preserving typed access.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sentryModule: unknown = require('@sentry/nextjs');
    return isSentryBreadcrumbClient(sentryModule) ? sentryModule : null;
  } catch {
    return null;
  }
}

function emit(level: LogLevel, event: string, payload: LogPayload): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitizePayload(payload),
  });

  if (isEdgeRuntime()) {
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
    return;
  }

  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

  if (process.env.NODE_ENV === 'production') {
    const sentryClient = loadSentryClient();
    if (sentryClient) {
      sentryClient.addBreadcrumb({
        category: 'server-logger',
        level: level === 'warn' ? 'warning' : level,
        message: event,
        data: sanitizePayload(payload),
      });
    }
  }
}

export const serverLogger = {
  info(event: string, payload: LogPayload = {}) {
    emit('info', event, payload);
  },
  warn(event: string, payload: LogPayload = {}) {
    emit('warn', event, payload);
  },
  error(event: string, payload: LogPayload = {}) {
    emit('error', event, payload);
  },
};
