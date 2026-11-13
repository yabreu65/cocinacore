export type ConflictPhase = 'idle' | 'reload-required' | 'review-required' | 'ready';

export function conflictAfter409(): ConflictPhase {
  return 'reload-required';
}

export function conflictAfterReload(success: boolean): ConflictPhase {
  return success ? 'review-required' : 'reload-required';
}

export function conflictAfterReview(confirmed: boolean): ConflictPhase {
  return confirmed ? 'ready' : 'review-required';
}

export function maySubmitConflict(phase: ConflictPhase): boolean {
  return phase === 'idle' || phase === 'ready';
}

export function metadataChanges<T extends Record<string, unknown>>(
  baseline: T,
  draft: T
): Partial<T> {
  return Object.fromEntries(
    Object.keys(draft)
      .filter((key) => !Object.is(baseline[key], draft[key]))
      .map((key) => [key, draft[key]])
  ) as Partial<T>;
}

export function metadataPatch<T extends Record<string, string>>(
  baseline: T,
  draft: T,
  nullableFields: readonly (keyof T)[]
): Partial<{ [K in keyof T]: T[K] | null }> {
  const changed = metadataChanges(baseline, draft);
  return Object.fromEntries(
    Object.entries(changed).map(([key, value]) => [
      key,
      nullableFields.includes(key as keyof T) && value === '' ? null : value,
    ])
  ) as Partial<{ [K in keyof T]: T[K] | null }>;
}

export function rebaseMetadata<T extends Record<string, unknown>>(
  baseline: T,
  draft: T,
  latest: T
): T {
  const changed = metadataChanges(baseline, draft);
  return { ...latest, ...changed };
}

export function conversionConfirmationKey(preview: string): string {
  return `confirmed:${preview}`;
}

export function isExactConversionConfirmed(preview: string, confirmation: string): boolean {
  return preview.length > 0 && confirmation === conversionConfirmationKey(preview);
}

export function matchingDuplicateNames<T>(
  rows: readonly T[],
  name: string,
  normalize: (value: string) => string,
  getName: (row: T) => string
): T[] {
  const normalized = normalize(name);
  return normalized ? rows.filter((row) => normalize(getName(row)) === normalized) : [];
}
