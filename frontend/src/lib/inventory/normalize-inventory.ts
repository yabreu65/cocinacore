export type InventoryCategory =
  | 'Proteínas'
  | 'Verduras'
  | 'Frutas'
  | 'Lácteos'
  | 'Granos'
  | 'Especias'
  | 'Despensa'
  | 'Otros';

export function normalizeInventoryName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function detectInventoryCategory(ingredientName: string): InventoryCategory {
  const text = normalizeInventoryName(ingredientName);
  if (/(pollo|carne|\bres\b|cerdo|pescado|atun|huevo|jamon)/.test(text)) return 'Proteínas';
  if (/(tomate|cebolla|pimenton|zanahoria|lechuga|ajo|brocoli|pepino)/.test(text))
    return 'Verduras';
  if (/(manzana|banana|platano|fresa|frutilla|uva|naranja|limon)/.test(text)) return 'Frutas';
  if (/(leche|queso|mantequilla|yogur|yogurt|crema)/.test(text)) return 'Lácteos';
  if (/(arroz|avena|quinoa|maiz|pasta|harina|trigo|lenteja|garbanzo|frijol)/.test(text))
    return 'Granos';
  if (/(\bsal\b|pimienta|comino|oregano|oregano|cilantro|perejil|canela|romero|tomillo)/.test(text))
    return 'Especias';
  if (/(aceite|vinagre|azucar|azúcar|salsa|caldo|conserva)/.test(text)) return 'Despensa';
  return 'Otros';
}

function parseLeadingNumber(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replace(',', '.').trim();
  const match = normalized.match(/^(\d+(\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getStockBadge(
  quantity: string | null,
  lowStockThreshold: number | null
): 'suficiente' | 'bajo stock' | 'sin cantidad' {
  const qty = parseLeadingNumber(quantity);
  if (qty === null) return 'sin cantidad';
  if (
    typeof lowStockThreshold === 'number' &&
    Number.isFinite(lowStockThreshold) &&
    qty <= lowStockThreshold
  ) {
    return 'bajo stock';
  }
  return 'suficiente';
}

// A date-only value (including its persisted UTC-midnight form) denotes a
// calendar day, not an instant to shift into the browser's local time zone.
export function expirationCalendarDay(value: string): number | null {
  const calendar = value.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.0+)?Z)?$/);
  if (calendar) {
    const parsed = new Date(`${calendar[1]}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== calendar[1])
      return null;
    return parsed.getTime();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function isExpiringSoon(expirationDate: string | null, days = 5): boolean {
  if (!expirationDate) return false;
  const today = new Date();
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const endDay = expirationCalendarDay(expirationDate);
  if (endDay === null) return false;
  const diffDays = (endDay - todayDay) / 86400000;
  return diffDays >= 0 && diffDays <= days;
}
