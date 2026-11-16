import {
  normalizeInventoryUnit,
  parseInventoryDecimal,
  validateInventoryFields,
  type InventoryUnit,
} from './inventory-input';

export type InventoryStockSnapshot = Readonly<{
  quantity: string | null;
  unit: string | null;
  lowStockThreshold: string | number | null;
}>;

// Count is an absolute physical observation, never a relative retryable increment.
// Convert changes presentation only. Correct explicitly replaces an ambiguous legacy
// baseline and must not be represented as a measurable stock increase/decrease.
export type InventoryStockCommand =
  | { kind: 'count'; quantity: string; reason: string }
  | { kind: 'convert'; unit: InventoryUnit }
  | {
      kind: 'correct';
      quantity: string;
      unit: InventoryUnit;
      lowStockThreshold: string | null;
      reason: string;
    };

export type InventoryStockMovement = Readonly<{
  type: 'manual_adjustment' | 'correction';
  quantity: string;
  unit: InventoryUnit;
  source: 'manual_inventory_count' | 'manual_inventory_baseline_correction';
  notes: string;
}>;
export type InventoryStockPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      quantity: string;
      unit: InventoryUnit;
      lowStockThreshold: string | null;
      movement: InventoryStockMovement | null;
    };

const SCALE = BigInt(10000);
const MAX = BigInt('999999999999');
const ZERO = BigInt(0);
function scaled(value: string | number | null): bigint | null {
  const parsed = parseInventoryDecimal(value);
  if (parsed === null) return null;
  const [integer, fraction = ''] = String(parsed).split('.');
  return BigInt(integer) * SCALE + BigInt(fraction.padEnd(4, '0'));
}
function decimal(value: bigint): string {
  const sign = value < ZERO ? '-' : '';
  const absolute = value < ZERO ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(4, '0').replace(/0+$/, '');
  return `${sign}${absolute / SCALE}${fraction ? '.' + fraction : ''}`;
}
function convert(value: bigint, from: InventoryUnit, to: InventoryUnit): bigint | null {
  if (from === to) return value;
  const mass = ['g', 'kg'];
  const volume = ['ml', 'l'];
  if (
    !((mass.includes(from) && mass.includes(to)) || (volume.includes(from) && volume.includes(to)))
  )
    return null;
  const factor = (unit: InventoryUnit) => BigInt(unit === 'kg' || unit === 'l' ? 1000 : 1);
  const numerator = value * factor(from);
  const denominator = factor(to);
  if (numerator % denominator !== ZERO) return null;
  const result = numerator / denominator;
  return result <= MAX ? result : null;
}
function reasonText(value: string): string | null {
  const reason = value.trim();
  return reason.length > 0 && reason.length <= 300 ? reason : null;
}
const fail = (error: string): InventoryStockPlan => ({ ok: false, error });

export function planInventoryStockChange(
  snapshot: InventoryStockSnapshot,
  command: InventoryStockCommand
): InventoryStockPlan {
  const previousStock = validateInventoryFields({
    quantity: snapshot.quantity,
    unit: snapshot.unit,
  });
  const known = previousStock.ok && previousStock.quantity !== null && previousStock.unit !== null;
  const previous = validateInventoryFields(snapshot);
  if (command.kind === 'correct') {
    if (known)
      return fail('La cantidad anterior es válida. Usa un conteo o una conversión de unidad.');
    const reason = reasonText(command.reason);
    if (!reason) return fail('Indica el motivo de la corrección (máximo 300 caracteres).');
    const next = validateInventoryFields({
      quantity: command.quantity,
      unit: command.unit,
      lowStockThreshold: command.lowStockThreshold,
    });
    if (!next.ok) return fail(next.error);
    if (next.quantity === null || next.unit === null)
      return fail('Indica una cantidad y unidad confirmadas.');
    // This quantity is the NEW observed baseline, not an inferred delta. Keep
    // the original raw fields in the audit note to explain the correction.
    return {
      ok: true,
      quantity: next.quantity,
      unit: next.unit,
      lowStockThreshold: next.lowStockThreshold === null ? null : String(next.lowStockThreshold),
      movement: {
        type: 'correction',
        quantity: next.quantity,
        unit: next.unit,
        source: 'manual_inventory_baseline_correction',
        notes: JSON.stringify({
          reason,
          previous: snapshot,
          semantics: 'new_confirmed_baseline_not_delta',
        }),
      },
    };
  }
  if (known && !previous.ok)
    return fail('Corrige el stock mínimo antes de ajustar las existencias.');
  if (!previous.ok || previous.quantity === null || previous.unit === null)
    return fail('Confirma primero la cantidad y unidad anteriores mediante una corrección.');
  const old = scaled(previous.quantity);
  const threshold = scaled(previous.lowStockThreshold);
  if (old === null) return fail('Cantidad anterior inválida.');
  if (command.kind === 'convert') {
    const target = normalizeInventoryUnit(command.unit);
    if (!target) return fail('Selecciona una unidad válida.');
    const quantity = convert(old, previous.unit, target);
    const minimum = threshold === null ? null : convert(threshold, previous.unit, target);
    if (quantity === null || (threshold !== null && minimum === null))
      return fail('La conversión no es compatible o excede la precisión permitida.');
    return {
      ok: true,
      quantity: decimal(quantity),
      unit: target,
      lowStockThreshold: minimum === null ? null : decimal(minimum),
      movement: null,
    };
  }
  const reason = reasonText(command.reason);
  if (!reason) return fail('Indica el motivo del conteo (máximo 300 caracteres).');
  const next = scaled(command.quantity);
  if (next === null)
    return fail('Introduce una cantidad válida, no negativa y con hasta cuatro decimales.');
  const delta = next - old;
  // Existing recipe_consumption and purchase movements use positive quantities;
  // manual_adjustment alone uses a signed delta with an explicit source marker.
  return {
    ok: true,
    quantity: decimal(next),
    unit: previous.unit,
    lowStockThreshold: threshold === null ? null : decimal(threshold),
    movement:
      delta === ZERO
        ? null
        : {
            type: 'manual_adjustment',
            quantity: decimal(delta),
            unit: previous.unit,
            source: 'manual_inventory_count',
            notes: JSON.stringify({
              reason,
              previousQuantity: decimal(old),
              newQuantity: decimal(next),
              semantics: 'signed_delta',
            }),
          },
  };
}
