/** PostgreSQL ISO DateStyle, converted to UTC without losing fractional evidence.
 * Timestamp without time zone follows the application's UTC convention.
 * Infinity/BC/out-of-range dates are rejected instead of becoming valid-looking dates.
 */
export function postgresTimestampToIso(value: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
      value
    );
  if (!match) throw new Error('Unsupported PostgreSQL timestamp.');
  const [, day, hours, minutes, seconds, fraction = '', offset = 'Z'] = match;
  const calendar = new Date(day + 'T00:00:00.000Z');
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== day ||
    Number(hours) > 23 ||
    Number(minutes) > 59 ||
    Number(seconds) > 59
  )
    throw new Error('Invalid PostgreSQL timestamp.');
  const precise = fraction.padEnd(6, '0');
  const zone = offset.replace(/^([+-]\d{2})$/, '$1:00').replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  const date = new Date(`${day}T${hours}:${minutes}:${seconds}.${precise.slice(0, 3)}${zone}`);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid PostgreSQL timestamp.');
  const iso = date.toISOString();
  if (iso.length !== 24) throw new Error('PostgreSQL timestamp outside supported range.');
  return /[1-9]/.test(precise.slice(3)) ? iso.slice(0, -1) + precise.slice(3) + 'Z' : iso;
}

/** Display-only conversion; preserve full source timestamp for concurrency and expiry. */
export function postgresTimestampDisplayDate(value: string): Date {
  return new Date(value.replace(/(\.\d{3})\d+(?=Z$)/, '$1'));
}

/** Revision tokens are instants, not presentation strings. Reject ambiguous
 * timezone-less values and preserve all six fractional digits. */
export function equalPostgresTimestamps(left: unknown, right: unknown): boolean {
  const hasZone = (value: unknown): value is string =>
    typeof value === 'string' && /(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value);
  if (!hasZone(left) || !hasZone(right)) return false;
  try {
    return postgresTimestampToIso(left) === postgresTimestampToIso(right);
  } catch {
    return false;
  }
}

/** Reconstruct the exact ISO DateStyle UTC text produced by the previous pg
 * identity parser. Used only to recompute a complete legacy source hash. */
export function postgresLegacyUtcTimestamp(value: string): string {
  if (!equalPostgresTimestamps(value, value)) throw new Error('Invalid timestamp evidence.');
  const canonical = postgresTimestampToIso(value);
  const [day, time] = canonical.slice(0, -1).split('T');
  const [whole, fraction = ''] = time.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${day} ${whole}${trimmed ? '.' + trimmed : ''}+00`;
}
