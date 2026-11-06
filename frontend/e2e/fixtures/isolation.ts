const EXECUTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export const E2E_EXECUTION_ID_ENV = 'COCINACORE_E2E_EXECUTION_ID';
export const E2E_CACHE_NAMESPACE_ENV = 'COCINACORE_E2E_CACHE_NAMESPACE';

export interface E2EIsolationEnvironment {
  [key: string]: string | undefined;
  COCINACORE_E2E_DISPOSABLE?: string;
  COCINACORE_E2E_EXECUTION_ID?: string;
  COCINACORE_E2E_WORKERS?: string;
  COCINACORE_SEPARATED_DB_LANES_ENABLED?: string;
}

export function requireE2EExecutionId(environment: E2EIsolationEnvironment = process.env): string {
  const executionId = environment[E2E_EXECUTION_ID_ENV];
  if (!executionId || !EXECUTION_ID_PATTERN.test(executionId)) {
    throw new Error('E2E execution id must be an explicit safe lane identifier.');
  }
  return executionId;
}

export function requireE2EIsolationConfiguration(
  environment: E2EIsolationEnvironment = process.env
): string {
  const executionId = requireE2EExecutionId(environment);
  if (
    environment.COCINACORE_E2E_DISPOSABLE !== 'true' ||
    environment.COCINACORE_E2E_WORKERS !== '1' ||
    environment.COCINACORE_SEPARATED_DB_LANES_ENABLED !== 'true'
  ) {
    throw new Error(
      'E2E requires a disposable database, one Playwright worker, and separated DB lanes.'
    );
  }
  return executionId;
}

export function buildE2ECachePrefix(environment: E2EIsolationEnvironment = process.env): string {
  const executionId = requireE2EExecutionId(environment);
  return `recipe:e2e:${executionId}:`;
}

export function buildE2ECachePattern(environment: E2EIsolationEnvironment = process.env): string {
  return `${buildE2ECachePrefix(environment)}*`;
}
