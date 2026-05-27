type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = Record<string, unknown>;

function emit(level: LogLevel, event: string, payload: LogPayload): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...payload,
  });

  if (level === 'error') {
    console.error(line);
    return;
  }

  if (level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
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
