import { describe, expect, it } from 'vitest';
import { EMPTY_CULINARY_SELECTIONS, profileAllergyContext, profileAllergenIdsForRestriction } from './culinary-profile-contract';
import { createCulinaryProfileUpdatePayload, profileFormFromApi, toggleProfileAllergen, isProfileAllergenSelected } from './culinary-profile-form';

describe('culinary profile form mapping', () => {
  it('initializes detailed fields with safe defaults when profile data is absent', () => {
    expect(profileFormFromApi(null)).toEqual({
      availableTimeMinutes: '',
      dislikedIngredientsText: '',
      selectedAllergies: [],
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
      selectedAllergies: [],
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
        selectedAllergies: [],
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
        selectedAllergies: [],
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
  it('keeps known allergy choices distinct and preserves unrecognized saved descriptions', () => {
    const state = profileFormFromApi({
      availableTimeMinutes: 30,
      dislikedIngredients: [],
      allergies: ['maní', 'Frutos secos', 'alergia a la proteína de la leche', 'Nueces'],
      householdMembers: [],
    });
    expect(state.selectedAllergies).toEqual(['maní', 'Frutos secos']);
    expect(state.allergiesText).toBe('alergia a la proteína de la leche\nNueces');
    expect(isProfileAllergenSelected(state.selectedAllergies, 'peanut')).toBe(true);
    expect(isProfileAllergenSelected(state.selectedAllergies, 'tree_nuts')).toBe(true);
    state.selectedAllergies = toggleProfileAllergen(state.selectedAllergies, 'peanut');
    expect(state.selectedAllergies).toEqual(['Frutos secos']);
    state.selectedAllergies = toggleProfileAllergen(state.selectedAllergies, 'milk');
    expect(createCulinaryProfileUpdatePayload({
      fullName: 'Ada', level: 'Chef', selections: EMPTY_CULINARY_SELECTIONS, ...state,
    }).allergies).toEqual(['Frutos secos', 'Leche', 'alergia a la proteína de la leche', 'Nueces']);
  });

  it('uses the same fixed IDs for model context without interpreting custom descriptions', () => {
    expect(profileAllergyContext(['maní', 'Frutos secos', 'Leche', 'alergia al maní y nueces'])).toEqual([
      { id: 'peanut', label: 'Maní (cacahuate)', value: 'maní' },
      { id: 'tree_nuts', label: 'Frutos secos de árbol', value: 'Frutos secos' },
      { id: 'milk', label: 'Leche y derivados', value: 'Leche' },
      { id: null, label: 'alergia al maní y nueces', value: 'alergia al maní y nueces' },
    ]);
  });

  it('maps only fixed legacy category labels and preserves ambiguous descriptions', () => {
    expect(profileAllergenIdsForRestriction('Mariscos')).toEqual(['crustaceans', 'molluscs']);
    expect(profileAllergenIdsForRestriction('alergia al huevo')).toEqual(['egg']);
    expect(profileAllergenIdsForRestriction('alergia al maní y nueces')).toEqual([]);
    expect(profileAllergenIdsForRestriction('alergia a la proteína de la leche')).toEqual([]);
    expect(profileAllergenIdsForRestriction('constructor')).toEqual([]);
    expect(profileAllergenIdsForRestriction('__proto__')).toEqual([]);
  });

});
