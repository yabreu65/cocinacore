export const PRODUCTION_ORIGIN = 'https://cocinacore.31-220-98-21.sslip.io';

export interface ProductionEnvironment {
  [key: string]: string | undefined;
  E2E_RUN_MODE?: string;
  E2E_PRODUCTION_URL?: string;
  E2E_PRODUCTION_USER_EMAIL?: string;
  E2E_PRODUCTION_USER_PASSWORD?: string;
  E2E_PRODUCTION_USER_ID?: string;
  E2E_PRODUCTION_TENANT_ID?: string;
  E2E_ALLOW_SIGNUP?: string;
}

export interface ValidatedProductionConfig {
  baseURL: string;
}

export interface ProductionAuthEnvironment extends ValidatedProductionConfig {
  email: string;
  password: string;
  expectedUserId: string;
  expectedTenantId: string;
}

export function validateProductionMode(env: ProductionEnvironment): void {
  if (env.E2E_RUN_MODE !== 'production') {
    throw new Error('E2E_RUN_MODE must be exactly production.');
  }
}

export function validateProductionUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('E2E_PRODUCTION_URL is required.');
  }

  // The sole accepted URL may have one trailing slash; no other normalization is allowed.
  const candidate = value.endsWith('/') ? value.slice(0, -1) : value;
  if (candidate !== PRODUCTION_ORIGIN) {
    throw new Error(`E2E_PRODUCTION_URL must be exactly ${PRODUCTION_ORIGIN} (optionally followed by one slash).`);
  }

  return PRODUCTION_ORIGIN;
}

function validateProductionGates(env: ProductionEnvironment): ValidatedProductionConfig {
  validateProductionMode(env);
  const baseURL = validateProductionUrl(env.E2E_PRODUCTION_URL);

  const required = [
    ['E2E_PRODUCTION_USER_EMAIL', env.E2E_PRODUCTION_USER_EMAIL],
    ['E2E_PRODUCTION_USER_PASSWORD', env.E2E_PRODUCTION_USER_PASSWORD],
    ['E2E_PRODUCTION_USER_ID', env.E2E_PRODUCTION_USER_ID],
    ['E2E_PRODUCTION_TENANT_ID', env.E2E_PRODUCTION_TENANT_ID],
  ] as const;
  for (const [name, value] of required) {
    if (!value?.trim()) {
      throw new Error(`${name} is required and must be non-empty.`);
    }
  }

  if (env.E2E_ALLOW_SIGNUP !== 'false') {
    throw new Error('E2E_ALLOW_SIGNUP must be exactly false.');
  }

  return { baseURL };
}

export function validateProductionEnvironment(
  env: ProductionEnvironment,
): ValidatedProductionConfig {
  return validateProductionGates(env);
}

export function readProductionAuthEnvironment(
  env: ProductionEnvironment,
): ProductionAuthEnvironment {
  const { baseURL } = validateProductionGates(env);
  return {
    baseURL,
    email: env.E2E_PRODUCTION_USER_EMAIL!,
    password: env.E2E_PRODUCTION_USER_PASSWORD!,
    expectedUserId: env.E2E_PRODUCTION_USER_ID!,
    expectedTenantId: env.E2E_PRODUCTION_TENANT_ID!,
  };
}
