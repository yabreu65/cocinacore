export function normalizeMarkdownLine(value: string): string {
  return value
    .replace(/^[\s>*-]+/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

export function normalizeIngredientName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(tomates|jitomates)\b/g, 'tomate')
    .replace(/\bcebollas\b/g, 'cebolla')
    .replace(/\bajos\b/g, 'ajo')
    .replace(/\b(almendra|almendras)\b/g, 'almendra')
    .replace(/\b(huevo|huevos)\b/g, 'huevo')
    .replace(/\b(nuez|nueces)\b/g, 'nuez')
    .replace(/\b(manis?|cacahuates?|cacahuetes?|peanuts?|groundnuts?)\b/g, 'mani');
}
