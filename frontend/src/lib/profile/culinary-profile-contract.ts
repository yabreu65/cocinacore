export type CulinarySelectionKey =
  | 'favoriteCuisineTermIds'
  | 'dietaryAvoidTermIds'
  | 'techniqueTermIds'
  | 'ingredientTypeTermIds'
  | 'goalTermIds';

export type CulinarySelections = Record<CulinarySelectionKey, string[]>;

export interface CulinaryProfileDimension {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
}

export interface CulinaryProfileTerm {
  id: string;
  dimensionId: string;
  label: string;
}

export interface CulinaryHouseholdMember {
  name: string;
  ageGroup: 'adult' | 'teen' | 'child';
}

export interface CulinaryProfileApiData {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    tenant: {
      tenantId: string;
      role: string;
      onboardingCompleted?: boolean;
    } | null;
    onboardingCompleted?: boolean;
  };
  profile: {
    level: string | null;
    availableTimeMinutes: number | null;
    dislikedIngredients: string[];
    allergies: string[];
    householdMembers: CulinaryHouseholdMember[];
  } | null;
  taxonomy: {
    dimensions: CulinaryProfileDimension[];
    terms: CulinaryProfileTerm[];
  };
  selections: CulinarySelections;
}

export const EMPTY_CULINARY_SELECTIONS: CulinarySelections = {
  favoriteCuisineTermIds: [],
  dietaryAvoidTermIds: [],
  techniqueTermIds: [],
  ingredientTypeTermIds: [],
  goalTermIds: [],
};

export function termsForDimension(
  data: Pick<CulinaryProfileApiData, 'taxonomy'>,
  dimensionKey: string
): CulinaryProfileTerm[] {
  const dimensionId = data.taxonomy.dimensions.find(
    (dimension) => dimension.key === dimensionKey
  )?.id;

  if (!dimensionId) return [];
  return data.taxonomy.terms.filter((term) => term.dimensionId === dimensionId);
}

// Stable choices shared by the UI and server. Keep the existing Spanish
// persistence values; the ID is the semantic key, not a recipe-name parser.
export const PROFILE_ALLERGEN_OPTIONS = [
  { id: 'peanut', value: 'Maní', label: 'Maní (cacahuate)' },
  { id: 'tree_nuts', value: 'Frutos secos', label: 'Frutos secos de árbol' },
  { id: 'milk', value: 'Leche', label: 'Leche y derivados' },
  { id: 'egg', value: 'Huevo', label: 'Huevo' },
  { id: 'fish', value: 'Pescado', label: 'Pescado' },
  { id: 'crustaceans', value: 'Crustáceos', label: 'Crustáceos' },
  { id: 'molluscs', value: 'Moluscos', label: 'Moluscos' },
  { id: 'wheat', value: 'Trigo', label: 'Trigo' },
  { id: 'soy', value: 'Soja', label: 'Soja' },
  { id: 'sesame', value: 'Sésamo', label: 'Sésamo' },
  { id: 'mustard', value: 'Mostaza', label: 'Mostaza' },
  { id: 'celery', value: 'Apio', label: 'Apio' },
] as const;

export type ProfileAllergenOption = (typeof PROFILE_ALLERGEN_OPTIONS)[number];

export function profileAllergenOption(value: string): ProfileAllergenOption | undefined {
  const key = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return PROFILE_ALLERGEN_OPTIONS.find((option) =>
    option.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === key
  );
}

// Compatibility for exact historical category labels. This is a fixed
// migration boundary, not an interpreter of arbitrary allergy descriptions.
const LEGACY_ALLERGEN_IDS: Readonly<Record<string, readonly ProfileAllergenOption['id'][]>> = {
  egg: ['egg'],
  lacteos: ['milk'],
  lacteo: ['milk'],
  dairy: ['milk'],
  milk: ['milk'],
  mariscos: ['crustaceans', 'molluscs'],
  marisco: ['crustaceans', 'molluscs'],
  shellfish: ['crustaceans', 'molluscs'],
  soya: ['soy'],
  fish: ['fish'],
  'tree nuts': ['tree_nuts'],
  'fruto seco': ['tree_nuts'],
};

export function profileAllergenIdsForRestriction(value: string): readonly ProfileAllergenOption['id'][] {
  const label = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/^alergia (?:al|a(?: (?:el|la|los|las))?) /, '');
  const option = profileAllergenOption(label);
  return option ? [option.id] : Object.hasOwn(LEGACY_ALLERGEN_IDS, label) ? LEGACY_ALLERGEN_IDS[label] : [];
}

// Exact known catalog entries have an ID. Custom entries are sent as user
// data without guessing their meaning, discarding them or splitting prose.
export function profileAllergyContext(values: readonly string[]) {
  return values.map((value) => {
    const option = profileAllergenOption(value);
    return option ? { id: option.id, label: option.label, value } : { id: null, label: value, value };
  });
}

/** Hard exclusions must survive every consumer; malformed persisted data fails closed. */
export function readHardRestrictionList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const clean = item.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    if (!result.includes(clean)) result.push(clean);
  }
  return result;
}
