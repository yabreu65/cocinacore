import { describe, expect, it } from 'vitest';
import { validateActualPurchaseQuantity } from './purchase-quantity';

describe('confirmación de compra real', () => {
  it('exige una cantidad ingresada explícitamente', () => {
    expect(validateActualPurchaseQuantity('', 'g', 1000)).toMatch(/Ingresá/);
    expect(validateActualPurchaseQuantity('  ', 'g', 1000)).toMatch(/Ingresá/);
  });
  it('rechaza cantidades sin unidad, negativas o cero', () => {
    expect(validateActualPurchaseQuantity('1.5', 'g', 1000)).toMatch(/unidad/);
    expect(validateActualPurchaseQuantity('0 kg', 'g', 1000)).not.toBeNull();
    expect(validateActualPurchaseQuantity('-2 kg', 'g', 1000)).not.toBeNull();
  });
  it('rechaza unidades incompatibles y menos cantidad que la requerida', () => {
    expect(validateActualPurchaseQuantity('2 l', 'g', 1000)).not.toBeNull();
    expect(validateActualPurchaseQuantity('500 g', 'g', 1000)).toMatch(/no cubre/);
  });
  it('admite una cantidad compatible, realmente ingresada', () => {
    expect(validateActualPurchaseQuantity('1.5 kg', 'g', 1000)).toBeNull();
    expect(validateActualPurchaseQuantity('1500 g', 'g', 1000)).toBeNull();
    expect(validateActualPurchaseQuantity('1,5 kg', 'g', 1000)).toBeNull();
    expect(validateActualPurchaseQuantity('4 unidad', 'unidad', 2)).toBeNull();
  });
  it('requiere número entero para unidades', () => {
    expect(validateActualPurchaseQuantity('1.5 unidad', 'unidad', 1)).not.toBeNull();
  });
});
