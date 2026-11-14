import { describe, expect, it } from 'vitest';
import {
  postgresTimestampToIso,
  postgresTimestampDisplayDate,
  equalPostgresTimestamps,
  postgresLegacyUtcTimestamp,
} from './postgres-timestamp';
import { normalizeExpirationDate } from '@/lib/meal-planner/expiration-date';
describe('PostgreSQL timestamp contract', () => {
  it.each([
    ['2026-11-14 12:34:56+00', '2026-11-14T12:34:56.000Z'],
    ['2026-11-14 07:34:56.123456-05', '2026-11-14T12:34:56.123456Z'],
    ['2026-11-14 00:00:00.000001+0000', '2026-11-14T00:00:00.000001Z'],
    ['2026-11-14 12:34:56.123', '2026-11-14T12:34:56.123Z'],
  ])('normalizes %s preserving exact precision', (raw, expected) => {
    expect(postgresTimestampToIso(raw)).toBe(expected);
    expect(postgresTimestampDisplayDate(expected).getTime()).toBe(
      new Date(expected.replace(/(\.\d{3})\d+Z$/, '$1Z')).getTime()
    );
  });
  it('compares legacy and canonical revision instants without truncating microseconds', () => {
    expect(
      equalPostgresTimestamps('2026-11-14 07:34:56.123456-05', '2026-11-14T12:34:56.123456Z')
    ).toBe(true);
    expect(
      equalPostgresTimestamps('2026-11-14 12:34:56.123456+00', '2026-11-14T12:34:56.123457Z')
    ).toBe(false);
    expect(equalPostgresTimestamps('2026-11-14 12:34:56', '2026-11-14T12:34:56Z')).toBe(false);
    expect(equalPostgresTimestamps('invalid', 'invalid')).toBe(false);
    expect(postgresLegacyUtcTimestamp('2026-11-14T12:34:56.123400Z')).toBe(
      '2026-11-14 12:34:56.1234+00'
    );
    expect(postgresLegacyUtcTimestamp('2026-11-14T12:34:56.000Z')).toBe('2026-11-14 12:34:56+00');
  });
  it('does not confuse a non-midnight microsecond with a canonical calendar day', () => {
    const exact = postgresTimestampToIso('2026-11-14 00:00:00.000001+00');
    expect(normalizeExpirationDate(exact, 'America/Bogota')).toBe('2026-11-13');
    expect(
      normalizeExpirationDate(postgresTimestampToIso('2026-11-14 00:00:00+00'), 'America/Bogota')
    ).toBe('2026-11-14');
  });
  it.each(['2026-02-30 12:00:00+00', '2026-11-14 24:00:00+00', 'infinity'])(
    'rejects invalid or unsupported values: %s',
    (raw) => {
      expect(() => postgresTimestampToIso(raw)).toThrow();
    }
  );
});
