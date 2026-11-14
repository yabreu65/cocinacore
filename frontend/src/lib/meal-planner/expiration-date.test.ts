import { describe, expect, it } from 'vitest';
import { inventoryExpirationStatus, normalizeExpirationDate } from './expiration-date';

describe('inventory calendar expiration', () => {
  it.each([
    '2026-11-13',
    '2026-11-13T00:00:00.000Z',
    '2026-11-13 00:00:00+00',
    '2026-11-12 19:00:00-05',
    new Date('2026-11-13T00:00:00.000Z'),
  ])('preserves the calendar day represented by %s in Bogotá', (value) => {
    expect(normalizeExpirationDate(value, 'America/Bogota')).toBe('2026-11-13');
    expect(
      inventoryExpirationStatus(value, new Date('2026-11-14T04:59:59Z'), 'America/Bogota')
    ).toBe('eligible');
    expect(
      inventoryExpirationStatus(value, new Date('2026-11-14T05:00:00Z'), 'America/Bogota')
    ).toBe('expired');
  });

  it('keeps a non-midnight legacy timestamp on its plan-local day', () => {
    expect(normalizeExpirationDate('2026-11-14T03:30:00Z', 'America/Bogota')).toBe('2026-11-13');
  });

  it.each(['2026-11-13T00:00:00.000001Z', '2026-11-12 19:00:00.000001-05'])(
    'preserves non-midnight microsecond timestamps: %s',
    (value) => {
      expect(normalizeExpirationDate(value, 'America/Bogota')).toBe('2026-11-12');
    }
  );
  it.each(['2026-02-30', '2026-11-13T24:00:00Z', '2026-11-13T12:60:00Z', 'invalid'])(
    'rejects malformed dates: %s',
    (value) => {
      expect(
        inventoryExpirationStatus(value, new Date('2026-11-13T12:00:00Z'), 'America/Bogota')
      ).toBe('invalid');
    }
  );
});
