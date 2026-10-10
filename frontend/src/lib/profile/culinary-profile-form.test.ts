import { describe, expect, it } from 'vitest';
import { EMPTY_CULINARY_SELECTIONS } from './culinary-profile-contract';
import { createCulinaryProfileUpdatePayload, profileFormFromApi } from './culinary-profile-form';

describe('culinary profile form mapping', () => {
  it('initializes detailed fields with safe defaults when profile data is absent', () => {
    expect(profileFormFromApi(null)).toEqual({
      availableTimeMinutes: '',
      dislikedIngredientsText: '',
      allergiesText: '',
      householdMembers: [],
    });
  });

  it('maps all saved detailed fields into editable form state', () => {
    expect(
      profileFormFromApi({
        availableTimeMinutes: 35,
        dislikedIngredients: [' Olives ', 'Mushrooms'],
        allergies: ['Peanuts'],
        householdMembers: [{ name: 'Ana', ageGroup: 'adult' }],
      })
    ).toEqual({
      availableTimeMinutes: '35',
      dislikedIngredientsText: 'Olives\nMushrooms',
      allergiesText: 'Peanuts',
      householdMembers: [{ name: 'Ana', ageGroup: 'adult' }],
    });
  });

  it('generates a complete update payload and preserves edited household rows', () => {
    expect(
      createCulinaryProfileUpdatePayload({
        fullName: '  Ada Lovelace  ',
        level: '',
        selections: EMPTY_CULINARY_SELECTIONS,
        availableTimeMinutes: '',
        dislikedIngredientsText: ' Olives\r\n\n Mushrooms ',
        allergiesText: 'Peanuts\n Sesame ',
        householdMembers: [
          { name: '  Ana ', ageGroup: 'adult' },
          { name: 'Leo', ageGroup: 'child' },
        ],
      })
    ).toEqual({
      fullName: 'Ada Lovelace',
      level: null,
      selections: EMPTY_CULINARY_SELECTIONS,
      availableTimeMinutes: null,
      dislikedIngredients: ['Olives', 'Mushrooms'],
      allergies: ['Peanuts', 'Sesame'],
      householdMembers: [
        { name: 'Ana', ageGroup: 'adult' },
        { name: 'Leo', ageGroup: 'child' },
      ],
    });
  });

  it('keeps explicit empty arrays so saved detailed data can be cleared', () => {
    expect(
      createCulinaryProfileUpdatePayload({
        fullName: 'Ada',
        level: 'Chef',
        selections: EMPTY_CULINARY_SELECTIONS,
        availableTimeMinutes: '45',
        dislikedIngredientsText: '',
        allergiesText: '',
        householdMembers: [],
      })
    ).toMatchObject({
      availableTimeMinutes: 45,
      dislikedIngredients: [],
      allergies: [],
      householdMembers: [],
    });
  });
});
