export type ServerSecretKey = 'GEMINI_API_KEY' | 'SUPABASE_SERVICE_ROLE_KEY';

export type ServerEnvSecrets = Readonly<Record<ServerSecretKey, string>>;

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
  if (!value || value.trim() === '') {
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
    SUPABASE_SERVICE_ROLE_KEY: readNonEmptyEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
