import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_ORIGIN,
  readProductionAuthEnvironment,
  validateProductionEnvironment,
  validateProductionMode,
  validateProductionUrl,
  type ProductionEnvironment,
} from './e2e-production-config';

const validEnvironment: ProductionEnvironment = {
  E2E_RUN_MODE: 'production',
  E2E_PRODUCTION_URL: PRODUCTION_ORIGIN,
  E2E_PRODUCTION_USER_EMAIL: 'owner@example.test',
  E2E_PRODUCTION_USER_PASSWORD: 'provided-at-runtime',
  E2E_PRODUCTION_USER_ID: 'user-id',
  E2E_PRODUCTION_TENANT_ID: 'tenant-id',
  E2E_ALLOW_SIGNUP: 'false',
};

describe('production Playwright environment validation', () => {
  it.each([undefined, '', 'local', 'Production'])('fails closed unless mode is exactly production: %s', (mode) => {
    expect(() => validateProductionMode({ E2E_RUN_MODE: mode })).toThrow('E2E_RUN_MODE');
  });

  it('accepts only the documented HTTPS origin', () => {
    expect(validateProductionUrl(PRODUCTION_ORIGIN)).toBe(PRODUCTION_ORIGIN);
    expect(validateProductionUrl(`${PRODUCTION_ORIGIN}/`)).toBe(PRODUCTION_ORIGIN);
    expect(() => validateProductionUrl('https://other.example')).toThrow('E2E_PRODUCTION_URL');
  });

  it.each([
    'http://cocinacore.31-220-98-21.sslip.io',
    'https://cocinacore.31-220-98-21.sslip.io.evil.example',
    'https://cocinacore.31-220-98-21.sslip.io/path',
    'https://cocinacore.31-220-98-21.sslip.io?query=1',
    'https://cocinacore.31-220-98-21.sslip.io#fragment',
    'https://user@cocinacore.31-220-98-21.sslip.io',
    'https://cocinacore.31-220-98-21.sslip.io//',
  ])('rejects unsafe production URL variants', (url) => {
    expect(() => validateProductionUrl(url)).toThrow('E2E_PRODUCTION_URL');
  });

  it('rejects a missing production URL', () => {
    expect(() => validateProductionUrl(undefined)).toThrow('E2E_PRODUCTION_URL');
  });

  it.each([
    'E2E_PRODUCTION_USER_EMAIL',
    'E2E_PRODUCTION_USER_PASSWORD',
    'E2E_PRODUCTION_USER_ID',
    'E2E_PRODUCTION_TENANT_ID',
  ] as const)('requires non-empty %s', (name) => {
    expect(() =>
      validateProductionEnvironment({ ...validEnvironment, [name]: undefined }),
    ).toThrow(name);
    expect(() =>
      validateProductionEnvironment({ ...validEnvironment, [name]: '  ' }),
    ).toThrow(name);
  });

  it.each([undefined, 'true', ''])('requires signup to be exactly false: %s', (signup) => {
    expect(() =>
      validateProductionEnvironment({ ...validEnvironment, E2E_ALLOW_SIGNUP: signup }),
    ).toThrow('E2E_ALLOW_SIGNUP');
  });

  it('returns only the validated baseURL for a complete environment', () => {
    const validated = validateProductionEnvironment(validEnvironment);
    expect(validated).toEqual({ baseURL: PRODUCTION_ORIGIN });
    expect(Object.keys(validated)).toEqual(['baseURL']);
  });

  it('reads validated auth values only through the explicit auth accessor', () => {
    const auth = readProductionAuthEnvironment(validEnvironment);
    expect(auth).toEqual({
      baseURL: PRODUCTION_ORIGIN,
      email: validEnvironment.E2E_PRODUCTION_USER_EMAIL,
      password: validEnvironment.E2E_PRODUCTION_USER_PASSWORD,
      expectedUserId: validEnvironment.E2E_PRODUCTION_USER_ID,
      expectedTenantId: validEnvironment.E2E_PRODUCTION_TENANT_ID,
    });
    expect(validateProductionEnvironment(validEnvironment)).not.toHaveProperty('password');
  });

  it('uses safe errors that do not echo supplied values', () => {
    const invalidValue = 'https://sensitive.example/path';
    let message = '';
    try {
      validateProductionUrl(invalidValue);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('E2E_PRODUCTION_URL');
    expect(message).not.toContain(invalidValue);
  });
});
