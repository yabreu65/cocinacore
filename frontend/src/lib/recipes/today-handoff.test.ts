import { describe, expect, it } from 'vitest';
import { RecipeGenerateSchema } from '../validation';
import {
  buildRecipeGenerationRequestPayload,
  buildTodayRecipeRequestFields,
  parseTodayHandoff,
  serializeTodayHandoff,
  type TodayHandoff,
} from './today-handoff';

const selected: TodayHandoff = {
  slot: 'snack',
  title: 'Tostadas con tomate',
  ingredients: ['pan', 'tomate', 'aceite'],
};

describe('Today recipe handoff', () => {
  it('serializes the selected Today option and repeated ingredients exactly', () => {
    expect(serializeTodayHandoff(selected)).toBe(
      '/recipes/search?slot=snack&title=Tostadas+con+tomate&ingredient=pan&ingredient=tomate&ingredient=aceite',
    );
  });

  it('parses valid intent and maps the snack slot to recipe request fields', () => {
    const intent = parseTodayHandoff(
      new URLSearchParams('slot=snack&title=Tostadas+con+tomate&ingredient=pan&ingredient=tomate'),
    );

    expect(intent).toEqual({
      slot: 'snack',
      title: 'Tostadas con tomate',
      ingredients: ['pan', 'tomate'],
      recipeName: 'Tostadas con tomate',
      mealType: 'Merienda',
    });
  });

  it('ignores invalid slots and titles, and filters oversized or empty ingredients', () => {
    expect(parseTodayHandoff(new URLSearchParams('slot=brunch&title=Desayuno'))).toBeNull();
    expect(parseTodayHandoff(new URLSearchParams(`slot=lunch&title=${'x'.repeat(201)}`))).toBeNull();
    expect(parseTodayHandoff(new URLSearchParams('slot=lunch&title=Bad%00Title'))).toBeNull();
    const query = new URLSearchParams('slot=lunch&title=Sopa&ingredient=');
    query.append('ingredient', 'x'.repeat(101));
    query.append('ingredient', 'zapallo');
    expect(parseTodayHandoff(query)).toMatchObject({ ingredients: ['zapallo'] });
  });

  it('builds the full recipe request payload with Today fields and current form values', () => {
    const todayFields = buildTodayRecipeRequestFields(
      new URLSearchParams('slot=snack&title=Tostadas+con+tomate&ingredient=pan&ingredient=tomate'),
    );

    const payload = buildRecipeGenerationRequestPayload({
      mode: 'rag',
      ingredients: 'pan\ntomate\naceite',
      recipeName: 'Tostadas con tomate editadas',
      restrictions: 'sin gluten, sin nueces',
      todayFields,
    });

    expect(payload).not.toHaveProperty('restrictions');
    expect(payload).toEqual({
      mode: 'rag',
      ingredients: ['pan', 'tomate', 'aceite'],
      recipeName: 'Tostadas con tomate editadas',
      mealType: 'Merienda',
      peopleCount: 4,
      culinaryProfile: {
        level: 'Intermedio',
        identity: [],
        preferred: [],
        avoid: ['sin gluten', 'sin nueces'],
        goals: [],
      },
    });
    expect(RecipeGenerateSchema.parse(payload)).toEqual({ ...payload, chunks: [], provider: 'auto' });
  });

  it('omits Today-only fields when building a request without a handoff', () => {
    const payload = buildRecipeGenerationRequestPayload({
      mode: 'free',
      ingredients: 'lentejas\n zanahoria ',
      recipeName: '',
      restrictions: '',
      todayFields: null,
    });

    expect(payload).not.toHaveProperty('restrictions');
    expect(payload).toEqual({
      mode: 'free',
      ingredients: ['lentejas', 'zanahoria'],
      peopleCount: 4,
      culinaryProfile: {
        level: 'Intermedio',
        identity: [],
        preferred: [],
        avoid: [],
        goals: [],
      },
    });
    expect(RecipeGenerateSchema.parse(payload)).toEqual({ ...payload, chunks: [], provider: 'auto' });
    expect(payload).not.toHaveProperty('recipeName');
    expect(payload).not.toHaveProperty('mealType');
  });

  it('stops scanning repeated ingredients at the raw ingredient bound', () => {
    class InstrumentedParams extends URLSearchParams {
      ingredientReads = 0;

      override getAll(name: string): string[] {
        if (name === 'ingredient') throw new Error('ingredient getAll must not be used');
        return super.getAll(name);
      }

      override *entries(): URLSearchParamsIterator<[string, string]> {
        for (const entry of super.entries()) {
          if (entry[0] === 'ingredient') this.ingredientReads += 1;
          yield entry;
        }
      }
    }

    const query = new InstrumentedParams('slot=dinner&title=Guiso');
    for (let index = 0; index < 35; index += 1) query.append('ingredient', `item-${index}`);
    expect(parseTodayHandoff(query)?.ingredients).toHaveLength(30);
    expect(query.ingredientReads).toBe(30);
  });

  it('counts invalid repeated ingredients toward the raw scan bound', () => {
    const query = new URLSearchParams('slot=snack&title=Guiso');
    for (let index = 0; index < 30; index += 1) query.append('ingredient', '');
    query.append('ingredient', 'tomate');

    expect(parseTodayHandoff(query)?.ingredients).toEqual([]);
  });
});
