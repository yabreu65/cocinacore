import { getLocalDateInTimeZone } from './structured-plan';

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Inventory forms store a calendar day, historically encoded as midnight UTC
 * in the timestamptz column. Preserve that day in every plan timezone.
 * Non-midnight legacy timestamps retain their plan-local day semantics.
 */
export function normalizeExpirationDate(value: string | Date, timeZone: string): string | null {
  let instant: Date;
  let hasSubmillisecond = false;
  if (value instanceof Date) {
    instant = value;
  } else {
    const trimmed = value.trim();
    if (isValidCalendarDate(trimmed)) return trimmed;
    const timestampMatch =
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
        trimmed
      );
    if (
      !timestampMatch ||
      !isValidCalendarDate(timestampMatch[1]) ||
      Number(timestampMatch[2]) > 23 ||
      Number(timestampMatch[3]) > 59 ||
      Number(timestampMatch[4] ?? '0') > 59
    )
      return null;
    const fraction = /\.(\d{1,9})(?:Z|[+-])/.exec(trimmed)?.[1] ?? '';
    hasSubmillisecond = /[1-9]/.test(fraction.slice(3));
    const normalizedTimestamp = trimmed
      .replace(' ', 'T')
      .replace(/(\.\d{3})\d+(?=Z|[+-])/, '$1')
      .replace(/([+-]\d{2})$/, '$1:00')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    instant = new Date(normalizedTimestamp);
  }
  if (!Number.isFinite(instant.getTime())) return null;
  const iso = instant.toISOString();
  if (!hasSubmillisecond && iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  return getLocalDateInTimeZone(instant, timeZone);
}

export function inventoryExpirationStatus(
  expirationDate: string | Date | null,
  now: Date,
  timeZone: string
): 'eligible' | 'expired' | 'invalid' {
  // This helper is used by user-confirmed consumption only. Undated lots retain
  // legacy eligibility; this is not proof of freshness for automatic forecasts.
  if (expirationDate === null) return 'eligible';
  const currentDate = getLocalDateInTimeZone(now, timeZone);
  const expirationDay = normalizeExpirationDate(expirationDate, timeZone);
  if (!currentDate || !expirationDay) return 'invalid';
  return expirationDay < currentDate ? 'expired' : 'eligible';
}
