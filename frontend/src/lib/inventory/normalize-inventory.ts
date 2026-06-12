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
  if (/(pollo|carne|res|cerdo|pescado|atun|huevo|jamon)/.test(text)) return 'Proteínas';
  if (/(tomate|cebolla|pimenton|zanahoria|lechuga|ajo|brocoli|pepino)/.test(text))
    return 'Verduras';
  if (/(manzana|banana|platano|fresa|frutilla|uva|naranja|limon)/.test(text)) return 'Frutas';
  if (/(leche|queso|mantequilla|yogur|yogurt|crema)/.test(text)) return 'Lácteos';
  if (/(arroz|avena|quinoa|maiz|pasta|harina|trigo|lenteja|garbanzo|frijol)/.test(text))
    return 'Granos';
  if (/(sal|pimienta|comino|oregano|oregano|cilantro|perejil|canela|romero|tomillo)/.test(text))
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

export function isExpiringSoon(expirationDate: string | null, days = 5): boolean {
  if (!expirationDate) return false;
  const today = new Date();
  const end = new Date(expirationDate);
  if (Number.isNaN(end.getTime())) return false;
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((end.getTime() - today.getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= days;
}
