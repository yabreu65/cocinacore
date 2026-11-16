import {
  PROFILE_ALLERGEN_OPTIONS,
  profileAllergenOption,
  type ProfileAllergenOption,
  type CulinaryHouseholdMember,
  type CulinarySelections,
} from './culinary-profile-contract';

export { PROFILE_ALLERGEN_OPTIONS };

export function isProfileAllergenSelected(values: readonly string[], id: ProfileAllergenOption['id']): boolean {
  return values.some((value) => profileAllergenOption(value)?.id === id);
}

export function toggleProfileAllergen(values: readonly string[], id: ProfileAllergenOption['id']): string[] {
  const option = PROFILE_ALLERGEN_OPTIONS.find((item) => item.id === id);
  if (!option) return [...values];
  return isProfileAllergenSelected(values, id)
    ? values.filter((value) => profileAllergenOption(value)?.id !== id)
    : [...values, option.value];
}

type DetailedProfileData = {
  availableTimeMinutes: number | null;
  dislikedIngredients: string[];
  allergies: string[];
  householdMembers: CulinaryHouseholdMember[];
};

export type CulinaryProfileFormState = {
  availableTimeMinutes: string;
  dislikedIngredientsText: string;
  selectedAllergies: string[];
  allergiesText: string;
  householdMembers: CulinaryHouseholdMember[];
};

type CulinaryProfileUpdateInput = {
  fullName: string;
  level: string;
  selections: CulinarySelections;
} & CulinaryProfileFormState;

export function profileFormFromApi(
  profile: DetailedProfileData | null | undefined
): CulinaryProfileFormState {
  const allergies = profile?.allergies?.map((value) => value.trim()) ?? [];
  return {
    availableTimeMinutes:
      profile?.availableTimeMinutes == null ? '' : String(profile.availableTimeMinutes),
    dislikedIngredientsText:
      profile?.dislikedIngredients?.map((value) => value.trim()).join('\n') ?? '',
    selectedAllergies: allergies.filter((value) => profileAllergenOption(value) !== undefined),
    allergiesText: allergies.filter((value) => profileAllergenOption(value) === undefined).join('\n'),
    householdMembers: profile?.householdMembers?.map((member) => ({ ...member })) ?? [],
  };
}

function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function createCulinaryProfileUpdatePayload(input: CulinaryProfileUpdateInput) {
  const availableTimeMinutes = input.availableTimeMinutes.trim();
  return {
    fullName: input.fullName.trim(),
    level: input.level || null,
    selections: input.selections,
    availableTimeMinutes: availableTimeMinutes ? Number(availableTimeMinutes) : null,
    dislikedIngredients: linesToList(input.dislikedIngredientsText),
    allergies: [...input.selectedAllergies, ...linesToList(input.allergiesText)],
    householdMembers: input.householdMembers
      .map((member) => ({ ...member, name: member.name.trim() }))
      .filter((member) => member.name.length > 0),
  };
}
