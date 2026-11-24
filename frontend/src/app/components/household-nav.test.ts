import { describe, expect, it } from 'vitest';
import { activeHouseholdRoute, householdNavigation, isHouseholdRoute } from './household-nav';

describe('UX2: CocinaCore Hogar shared navigation', () => {
  it('covers household routes while excluding public pages and owner administration', () => {
    for (const route of [
      '/app',
      '/app/cooking-intent',
      '/recipes',
      '/recipes/history',
      '/recipes/search',
      '/recipes/inventory',
      '/recipes/abc',
      '/meal-planner',
      '/shopping-list',
      '/library',
      '/profile',
      '/billing',
    ]) {
      expect(isHouseholdRoute(route), route).toBe(true);
    }
    for (const route of [
      '/',
      '/login',
      '/signup',
      '/forgot-password',
      '/reset-password',
      '/terms',
      '/privacy',
      '/cookies',
      '/owner',
      '/owner/tenants',
      '/onboarding',
    ]) {
      expect(isHouseholdRoute(route), route).toBe(false);
    }
  });

  it('highlights the correct item on detail routes without mistakenly selecting Inicio', () => {
    expect(activeHouseholdRoute('/app')).toBe('/app');
    expect(activeHouseholdRoute('/app/cooking-intent')).toBe('/recipes');
    expect(activeHouseholdRoute('/recipes/history')).toBe('/recipes');
    expect(activeHouseholdRoute('/recipes/abc')).toBe('/recipes');
    expect(activeHouseholdRoute('/recipes/search')).toBe('/recipes/search');
    expect(activeHouseholdRoute('/recipes/inventory')).toBe('/recipes/inventory');
    expect(activeHouseholdRoute('/shopping-list')).toBe('/shopping-list');
    expect(activeHouseholdRoute('/meal-planner')).toBe('/meal-planner');
    expect(activeHouseholdRoute('/library')).toBe('/library');
    expect(activeHouseholdRoute('/library/upload')).toBe('/library');
    expect(activeHouseholdRoute('/profile')).toBe('/profile');
    expect(activeHouseholdRoute('/billing')).toBe('/billing');
    expect(activeHouseholdRoute('/premium')).toBeNull();
  });

  it('keeps meaningful household destinations and excludes unfinished premium and members', () => {
    const labels = householdNavigation.map(({ label }) => label);
    expect(labels).toContain('Mis recetas');
    expect(labels).toContain('Asistente de recetas');
    expect(labels).toContain('Inventario');
    expect(labels).toContain('Compras');
    expect(labels).toContain('Biblioteca');
    expect(householdNavigation.map(({ href }) => href)).toContain('/library');
    expect(householdNavigation.findIndex(({ href }) => href === '/library')).toBe(
      householdNavigation.findIndex(({ href }) => href === '/recipes') + 1
    );
    expect(labels).not.toContain('Miembros');
    expect(labels).not.toContain('Premium Board');
    expect(new Set(householdNavigation.map(({ href }) => href)).size).toBe(
      householdNavigation.length
    );
  });
});
