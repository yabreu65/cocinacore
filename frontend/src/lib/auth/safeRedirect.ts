const DEFAULT_AUTH_REDIRECT = '/app';

export function getSafeRedirectPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_AUTH_REDIRECT;

  try {
    if (!value.startsWith('/') || value.startsWith('//')) {
      return DEFAULT_AUTH_REDIRECT;
    }

    const parsed = new URL(value, 'https://cocinacore.local');
    if (parsed.origin !== 'https://cocinacore.local') {
      return DEFAULT_AUTH_REDIRECT;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}
