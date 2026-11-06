const ANONYMOUS_RATE_LIMIT_IDENTITY = 'anonymous';
const TRUSTED_CLIENT_IDENTITY_HEADER_ENV = 'COCINACORE_TRUSTED_CLIENT_IDENTITY_HEADER';
const MAX_IDENTITY_LENGTH = 128;

function normalizeIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized || normalized.length > MAX_IDENTITY_LENGTH) return null;
  return normalized;
}

/**
 * Returns an identity from server-authenticated data or a proxy header that
 * the deployment explicitly declares trustworthy. Arbitrary forwarded headers
 * are never accepted by default.
 */
export function getTrustedClientIdentity(request: Request): string {
  const configuredHeader = process.env[TRUSTED_CLIENT_IDENTITY_HEADER_ENV]?.trim();
  const normalizedHeader = configuredHeader?.toLowerCase();
  if (
    !configuredHeader ||
    !/^[A-Za-z0-9-]+$/.test(configuredHeader) ||
    normalizedHeader === 'x-forwarded-for' ||
    normalizedHeader === 'forwarded'
  ) {
    return ANONYMOUS_RATE_LIMIT_IDENTITY;
  }

  return normalizeIdentity(request.headers.get(configuredHeader)) ?? ANONYMOUS_RATE_LIMIT_IDENTITY;
}

/**
 * When ingress does not provide a trustworthy client identity, scope public
 * authentication throttles to the normalized target instead of collapsing all
 * unrelated users into one anonymous bucket.
 */
export function getTargetRateLimitKey(
  request: Request,
  target: string
): {
  identity: string;
  userId?: string;
} {
  const clientIdentity = getTrustedClientIdentity(request);
  return clientIdentity === ANONYMOUS_RATE_LIMIT_IDENTITY
    ? { identity: target }
    : { identity: clientIdentity, userId: target };
}

export function getAuthenticationSecondaryRateLimitKey(
  request: Request,
  route: 'auth/login' | 'auth/signup' | 'auth/password-reset' | 'auth/password-update'
): { route: string; identity: string } {
  const clientIdentity = getTrustedClientIdentity(request);
  return clientIdentity === ANONYMOUS_RATE_LIMIT_IDENTITY
    ? { route: `${route}:anonymous-global`, identity: 'global' }
    : { route: `${route}:trusted-client`, identity: clientIdentity };
}

export function getRetryAfterSeconds(
  resetAt: number,
  nowSeconds = Math.floor(Date.now() / 1000)
): number {
  return Math.max(1, Math.ceil(resetAt - nowSeconds));
}

export { ANONYMOUS_RATE_LIMIT_IDENTITY };
