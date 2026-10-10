import type {
  CulinaryHouseholdMember,
  CulinarySelections,
} from './culinary-profile-contract';

type DetailedProfileData = {
  availableTimeMinutes: number | null;
  dislikedIngredients: string[];
  allergies: string[];
  householdMembers: CulinaryHouseholdMember[];
};

export type CulinaryProfileFormState = {
  availableTimeMinutes: string;
  dislikedIngredientsText: string;
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
  return {
    availableTimeMinutes:
      profile?.availableTimeMinutes == null ? '' : String(profile.availableTimeMinutes),
    dislikedIngredientsText:
      profile?.dislikedIngredients?.map((value) => value.trim()).join('\n') ?? '',
    allergiesText: profile?.allergies?.map((value) => value.trim()).join('\n') ?? '',
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
    allergies: linesToList(input.allergiesText),
    householdMembers: input.householdMembers
      .map((member) => ({ ...member, name: member.name.trim() }))
      .filter((member) => member.name.length > 0),
  };
}
