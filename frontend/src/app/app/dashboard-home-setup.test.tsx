import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DashboardFirstRunActions,
  DashboardQuickActions,
  DashboardSetupPanel,
} from './dashboard-home-setup';

describe('CocinaCore Hogar: guided dashboard', () => {
  it('offers an immediate cooking path without mandatory setup', () => {
    const html = renderToStaticMarkup(<DashboardFirstRunActions />);
    expect(html).toContain('Quiero cocinar ahora');
    expect(html).toContain('href="/recipes/search"');
    expect(html).toContain('Quiero organizar mi cocina');
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain('sin completar la configuración');
  });

  it('guides first-time accounts through three safe household tasks', () => {
    const html = renderToStaticMarkup(
      <DashboardSetupPanel onboardingCompleted={false} hasIngredients={false} hasRecipes={false} />
    );
    expect(html).toContain('Prepara tu espacio de cocina');
    expect(html).toContain('0 de 3 pasos');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain('href="/recipes/inventory"');
    expect(html).toContain('href="/recipes/search"');
    expect(html).toContain('Contanos qué te gusta cocinar');
  });

  it('links to the existing history when an idea is generated but not imported', () => {
    const html = renderToStaticMarkup(
      <DashboardSetupPanel
        onboardingCompleted
        hasIngredients
        hasRecipes={false}
        hasGeneratedIdeas
      />
    );
    expect(html).toContain('href="/recipes/history"');
    expect(html).toContain('Guardá tu primera receta');
    expect(html).toContain('Ya generaste una idea.');
  });

  it('counts completed tasks and points to the next incomplete task', () => {
    const html = renderToStaticMarkup(
      <DashboardSetupPanel onboardingCompleted hasIngredients hasRecipes={false} />
    );
    expect(html).toContain('2 de 3 pasos');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('href="/recipes/search"');
    expect(html).toContain('Continuar con mi cocina');
  });

  it('does not interrupt accounts that completed their household setup', () => {
    const html = renderToStaticMarkup(
      <DashboardSetupPanel onboardingCompleted hasIngredients hasRecipes />
    );
    expect(html).toBe('');
  });

  it('shows four practical shortcuts without promising unfinished premium features', () => {
    const html = renderToStaticMarkup(<DashboardQuickActions />);
    expect(html).toContain('Mis ingredientes');
    expect(html).toContain('Mis recetas');
    expect(html).toContain('Planificar menú');
    expect(html).toContain('Lista de compras');
    expect(html).toContain('href="/recipes/inventory"');
    expect(html).toContain('href="/recipes"');
    expect(html).toContain('href="/meal-planner"');
    expect(html).toContain('href="/shopping-list"');
    expect(html).not.toContain('Premium Board');
    expect(html).not.toContain('Miembros');
  });
});
