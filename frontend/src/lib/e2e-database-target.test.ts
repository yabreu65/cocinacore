import { describe, expect, it } from 'vitest';
import { applyValidatedTargetsToRunner, validateE2ETargets } from '../../e2e/database-target';

describe('validateE2ETargets', () => {
  const valid = {
    E2E_DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5435/cocinacore_local_db',
    E2E_REDIS_URL: 'redis://:secret@127.0.0.1:6381/15',
  };

  it('overwrites ambient runner URLs with the validated isolated targets', () => {
    const environment = {
      ...valid,
      DATABASE_URL: 'postgresql://elsewhere:secret@192.0.2.10:5432/other',
      REDIS_URL: 'redis://elsewhere:secret@192.0.2.11:6379/0',
    };

    applyValidatedTargetsToRunner(environment);

    expect(environment.DATABASE_URL).toBe(valid.E2E_DATABASE_URL);
    expect(environment.REDIS_URL).toBe(valid.E2E_REDIS_URL);
  });

  it('accepts the isolated local database and Redis targets without exposing credentials', () => {
    expect(validateE2ETargets(valid)).toEqual({
      databaseUrl: valid.E2E_DATABASE_URL,
      redisUrl: valid.E2E_REDIS_URL,
      databaseTarget: {
        protocol: 'postgresql:',
        host: '127.0.0.1',
        port: '5435',
        database: 'cocinacore_local_db',
      },
      redisTarget: {
        protocol: 'redis:',
        host: '127.0.0.1',
        port: '6381',
        database: '15',
      },
    });
  });

  it.each([
    [{ ...valid, E2E_DATABASE_URL: undefined }, 'E2E_DATABASE_URL is required'],
    [
      { ...valid, E2E_DATABASE_URL: 'postgresql://u:p@localhost:5435/cocinacore_local_db' },
      '127.0.0.1',
    ],
    [{ ...valid, E2E_DATABASE_URL: 'postgresql://u:p@127.0.0.1:5436/cocinacore_local_db' }, '5435'],
    [{ ...valid, E2E_DATABASE_URL: 'postgres://u:p@127.0.0.1:5435/other' }, 'cocinacore_local_db'],
    [{ ...valid, E2E_DATABASE_URL: 'mysql://u:p@127.0.0.1:5435/cocinacore_local_db' }, 'postgres'],
    [{ ...valid, E2E_REDIS_URL: undefined }, 'E2E_REDIS_URL is required'],
    [{ ...valid, E2E_REDIS_URL: 'redis://u:p@localhost:6381/15' }, '127.0.0.1'],
    [{ ...valid, E2E_REDIS_URL: 'redis://u:p@127.0.0.1:6379/15' }, '6381'],
    [{ ...valid, E2E_REDIS_URL: 'redis://u:p@127.0.0.1:6381/not-a-db' }, 'database'],
  ] as const)('rejects unsafe target configuration', (env, message) => {
    expect(() => validateE2ETargets(env)).toThrow(message);
  });

  it('never includes credentials in validation errors', () => {
    let thrown: unknown;
    try {
      validateE2ETargets({
        ...valid,
        E2E_REDIS_URL: 'redis://user:do-not-leak@remote.example:6381/0',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain('do-not-leak');
  });
});
