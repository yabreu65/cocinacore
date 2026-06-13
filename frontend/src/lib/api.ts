export async function typedJson<T>(response: Response): Promise<T> {
  const data: unknown = await response.json();
  return data as T;
}

export async function safeFetch<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Request failed';
    return { ok: false, error: message, status: response.status };
  }
  const data = (await response.json()) as T;
  return { ok: true, data };
}
