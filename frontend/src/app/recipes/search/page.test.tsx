import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecipeSearchPage from './page';
import { buildTodayRecipeRequestFields } from '@/lib/recipes/today-handoff';

const { searchParams } = vi.hoisted(() => ({ searchParams: { current: '' } }));

vi.mock('@/lib/api', () => ({ safeFetch: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(searchParams.current) }));

beforeEach(() => {
  searchParams.current = '';
});

describe('RecipeSearchPage Today handoff', () => {
  it('prefills valid URL intent, maps it into the canonical request body fields, and keeps explicit submit', () => {
    searchParams.current = 'slot=snack&title=Tostadas+con+tomate&ingredient=pan&ingredient=tomate';
    const markup = renderToStaticMarkup(createElement(RecipeSearchPage));

    expect(markup).toContain('name="recipeName"');
    expect(markup).toContain('value="Tostadas con tomate"');
    expect(markup).toContain('pan\ntomate');
    expect(markup).toContain('type="submit"');
    expect(buildTodayRecipeRequestFields(new URLSearchParams(searchParams.current))).toEqual({
      recipeName: 'Tostadas con tomate',
      mealType: 'Merienda',
      ingredients: ['pan', 'tomate'],
    });
  });

  it('preserves the empty search form for an invalid Today slot', () => {
    searchParams.current = 'slot=brunch&title=Desayuno&ingredient=avena';
    const markup = renderToStaticMarkup(createElement(RecipeSearchPage));
    expect(markup).not.toContain('Desayuno</');
    expect(markup).not.toContain('avena');
    expect(buildTodayRecipeRequestFields(new URLSearchParams(searchParams.current))).toBeNull();
  });
});
