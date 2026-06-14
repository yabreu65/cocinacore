export type ServerSecretKey =
  | 'GEMINI_API_KEY'
  | 'DATABASE_URL'
  | 'REDIS_URL'
  | 'AUTH_SECRET'
  | 'RESEND_API_KEY'
  | 'EMAIL_FROM'
  | 'APP_PUBLIC_URL'
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY';

export type RequiredServerSecretKey = 'GEMINI_API_KEY' | 'DATABASE_URL' | 'REDIS_URL' | 'AUTH_SECRET';

export type ServerEnvSecrets = Readonly<Record<RequiredServerSecretKey, string>>;

function assertServerRuntime(): void {
  if (typeof window !== 'undefined') {
    throw new Error('Server environment secrets cannot be read from a browser runtime.');
  }
}

function isNextPublicKey(key: string): boolean {
  return key.startsWith('NEXT_PUBLIC_');
}

function readNonEmptyEnv(key: ServerSecretKey): string {
  assertServerRuntime();

  if (isNextPublicKey(key)) {
    throw new Error(`Refusing to read public environment variable as a server secret: ${key}`);
  }

  const value = process.env[key];
  if (!value || value.trim() === '' || value === 'CHANGE_ME') {
    throw new Error(`Missing required server environment variable: ${key}`);
  }

  return value;
}

export function getServerSecret(key: ServerSecretKey): string {
  return readNonEmptyEnv(key);
}

export function getServerEnvSecrets(): ServerEnvSecrets {
  return {
    GEMINI_API_KEY: readNonEmptyEnv('GEMINI_API_KEY'),
    DATABASE_URL: readNonEmptyEnv('DATABASE_URL'),
    REDIS_URL: readNonEmptyEnv('REDIS_URL'),
    AUTH_SECRET: readNonEmptyEnv('AUTH_SECRET'),
  };
}

export function getOptionalServerSecret(key: ServerSecretKey): string | undefined {
  assertServerRuntime();
  const value = process.env[key];
  return value && value.trim() !== '' && value !== 'CHANGE_ME' ? value : undefined;
}
