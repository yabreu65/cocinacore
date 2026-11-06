export interface StandaloneServerFixtureEnv {
  AUTH_SECRET: string;
  COCINACORE_E2E_CACHE_NAMESPACE: string;
  GEMINI_API_KEY: string;
  GEMINI_BASE_URL: string;
  STORAGE_DRIVER: string;
  LOCAL_UPLOAD_DIR: string;
}

export function buildStandaloneServerFixtureEnv(
  environment: Readonly<Record<string, string | undefined>>,
  providerPort: number
): StandaloneServerFixtureEnv {
  return {
    AUTH_SECRET: environment.AUTH_SECRET ?? 'e2e-auth-secret-change-me',
    COCINACORE_E2E_CACHE_NAMESPACE:
      environment.COCINACORE_E2E_CACHE_NAMESPACE ?? 'missing-e2e-namespace',
    GEMINI_API_KEY: 'e2e-gemini-key',
    GEMINI_BASE_URL: `http://127.0.0.1:${providerPort}/v1beta`,
    STORAGE_DRIVER: environment.STORAGE_DRIVER ?? 'local',
    LOCAL_UPLOAD_DIR: environment.LOCAL_UPLOAD_DIR ?? './uploads',
  };
}
