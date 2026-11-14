/** Internal rational quantities. Never serialize BigInt in an API DTO. */
export type ExactQuantity = Readonly<{ numerator: bigint; denominator: bigint }>;
const ZERO = BigInt(0);
const ONE = BigInt(1);
function gcd(a: bigint, b: bigint): bigint {
  a = a < ZERO ? -a : a;
  while (b !== ZERO) [a, b] = [b, a % b];
  return a;
}
export function rational(numerator: bigint, denominator = ONE): ExactQuantity {
  if (denominator <= ZERO) throw new RangeError('Invalid denominator');
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
export const zeroQuantity = rational(ZERO);
export function parseExactQuantity(raw: string | number): ExactQuantity | null {
  const text = String(raw).trim().replace(',', '.');
  // Bound legacy input before BigInt conversion.
  if (text.length > 100) return null;
  const fraction = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) {
    const d = BigInt(fraction[3]);
    return d === ZERO ? null : rational(BigInt(fraction[1] ?? '0') * d + BigInt(fraction[2]), d);
  }
  const decimal = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!decimal || (typeof raw === 'string' && decimal[3] !== undefined)) return null;
  const exponent = Number(decimal[3] ?? '0') - (decimal[2]?.length ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 324) return null;
  const n = BigInt(decimal[1] + (decimal[2] ?? ''));
  const scale = BigInt(10) ** BigInt(Math.abs(exponent));
  return exponent >= 0 ? rational(n * scale) : rational(n, scale);
}
export function addQuantity(a: ExactQuantity, b: ExactQuantity): ExactQuantity {
  return rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator
  );
}
export function subtractQuantity(a: ExactQuantity, b: ExactQuantity): ExactQuantity {
  return addQuantity(a, { ...b, numerator: -b.numerator });
}
export function multiplyQuantity(a: ExactQuantity, b: ExactQuantity): ExactQuantity {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}
export function divideQuantity(a: ExactQuantity, b: ExactQuantity): ExactQuantity {
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}
export function quantityNumber(a: ExactQuantity): number {
  // A ratio can be finite even when its reduced numerator and denominator
  // individually exceed Number.MAX_VALUE. Convert only at the DTO boundary.
  const direct = Number(a.numerator) / Number(a.denominator);
  if (Number.isFinite(direct) && (direct !== 0 || a.numerator === ZERO)) return direct;
  const negative = a.numerator < ZERO;
  const n = negative ? -a.numerator : a.numerator;
  const scale = 18 + a.denominator.toString().length - n.toString().length;
  const digits =
    scale >= 0
      ? (n * BigInt(10) ** BigInt(scale)) / a.denominator
      : n / (a.denominator * BigInt(10) ** BigInt(-scale));
  return Number(`${negative ? '-' : ''}${digits}e${-scale}`);
}

export type ExactQuantityBasis = Readonly<{ numerator: string; denominator: string }>;
/** JSON-safe provenance for a fraction that cannot be represented by the numeric DTO. */
export function quantityBasis(value: ExactQuantity): ExactQuantityBasis | undefined {
  const numeric = quantityNumber(value);
  const parsed = parseExactQuantity(numeric);
  return parsed && compareQuantity(parsed, value) === 0
    ? undefined
    : {
        numerator: value.numerator.toString(),
        denominator: value.denominator.toString(),
      };
}
export function readQuantityBasis(
  value: number | null,
  basis?: ExactQuantityBasis
): ExactQuantity | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  if (!basis) return parseExactQuantity(value);
  if (!/^\d{1,4096}$/.test(basis.numerator) || !/^\d{1,4096}$/.test(basis.denominator)) return null;
  const denominator = BigInt(basis.denominator);
  if (denominator === ZERO) return null;
  const exact = rational(BigInt(basis.numerator), denominator);
  return quantityNumber(exact) === value ? exact : null;
}
/** Reject malformed provenance at untrusted DTO boundaries, never silently fall back. */
export function readUntrustedQuantityBasis(value: unknown, basis: unknown): ExactQuantity | null {
  if (typeof value !== 'number') return null;
  if (basis === undefined) return readQuantityBasis(value);
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) return null;
  const record = basis as Record<string, unknown>;
  if (typeof record.numerator !== 'string' || typeof record.denominator !== 'string') return null;
  return readQuantityBasis(value, { numerator: record.numerator, denominator: record.denominator });
}

export function compareQuantity(a: ExactQuantity, b: ExactQuantity): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < ZERO ? -1 : difference > ZERO ? 1 : 0;
}

/** Render a rational without rounding; use a fraction for non-terminating decimals. */
export function exactQuantityText(value: ExactQuantity): string {
  let denominator = value.denominator;
  let twos = 0,
    fives = 0;
  while (denominator % BigInt(2) === ZERO) {
    denominator /= BigInt(2);
    twos++;
  }
  while (denominator % BigInt(5) === ZERO) {
    denominator /= BigInt(5);
    fives++;
  }
  if (denominator !== ONE) return `${value.numerator}/${value.denominator}`;
  const scale = Math.max(twos, fives);
  if (scale === 0) return value.numerator.toString();
  const negative = value.numerator < ZERO;
  const scaled =
    ((negative ? -value.numerator : value.numerator) * BigInt(10) ** BigInt(scale)) /
    value.denominator;
  const digits = scaled.toString().padStart(scale + 1, '0');
  return (negative ? '-' : '') + digits.slice(0, -scale) + '.' + digits.slice(-scale);
}

/** Display numeric DTOs using their exact basis, rejecting inconsistent evidence. */
export function formatExactQuantityEvidence(value: unknown, basis?: unknown): string | null {
  const exact = readUntrustedQuantityBasis(value, basis);
  return exact ? exactQuantityText(exact) : null;
}
