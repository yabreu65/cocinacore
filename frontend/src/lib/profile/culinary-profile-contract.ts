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
