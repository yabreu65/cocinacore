import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MealPlanCoveragePanel } from './meal-plan-coverage-card';
import type { MealPlanCoverageForecast } from '@/lib/meal-planner/coverage-forecast';

const unknownForecast: MealPlanCoverageForecast = {
  status: 'unknown',
  reason: 'schedule_not_confirmed',
  horizonDays: 7,
  timeZone: null,
  fromDate: null,
  throughDate: null,
  scheduledMealCount: 0,
  consumedMealCount: 0,
  items: [],
  summary: { sufficient: 0, partial: 0, missing: 0, unknown: 0 },
};

const readyForecast: MealPlanCoverageForecast = {
  status: 'ready',
  horizonDays: 7,
  timeZone: 'America/Argentina/Buenos_Aires',
  fromDate: '2026-10-25',
  throughDate: '2026-10-31',
  scheduledMealCount: 3,
  consumedMealCount: 1,
  items: [
    {
      ingredientName: 'Arroz',
      normalizedName: 'arroz',
      requiredTotalQuantity: 500,
      requiredUnit: 'g',
      availableQuantity: 1,
      availableUnit: 'kg',
      projectedUsedQuantity: 500,
      projectedRemainingQuantity: 500,
      missingQuantity: 0,
      status: 'sufficient',
      usedInRecipes: ['Arroz con verduras · 2026-10-25'],
      category: 'Granos',
      estimatedUnitPrice: null,
    },
  ],
  summary: { sufficient: 1, partial: 0, missing: 0, unknown: 0 },
};

function renderPanel(forecast: MealPlanCoverageForecast) {
  return renderToStaticMarkup(
    <MealPlanCoveragePanel
      forecast={forecast}
      mealPlanId="plan-1"
      peopleCount={4}
      horizonDays={7}
      loading={false}
      error={null}
      startDate=""
      timeZone="America/Argentina/Buenos_Aires"
      isScheduling={false}
      scheduleError={null}
      scheduleMessage={null}
      onHorizonChange={vi.fn()}
      onStartDateChange={vi.fn()}
      onConfirmSchedule={vi.fn()}
    />
  );
}

describe('MealPlanCoveragePanel', () => {
  it('shows an honest unknown state and explicit date-confirmation CTA for legacy plans', () => {
    const markup = renderPanel(unknownForecast);

    expect(markup).toContain('Cobertura de ingredientes');
    expect(markup).toContain('desconocida');
    expect(markup).toContain('Fecha de inicio del plan');
    expect(markup).toContain('Confirmar agenda');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('stock suficiente');
  });

  it('explains when the saved plan is shorter than the selected horizon', () => {
    const markup = renderPanel({
      ...unknownForecast,
      horizonDays: 14,
      reason: 'plan_does_not_cover_horizon',
    });

    expect(markup).toContain('El menú confirmado no cubre los 14 días');
    expect(markup).toContain('Elegí 7 días o generá un plan más largo');
  });

  it('renders responsive horizon controls and explainable per-ingredient quantities', () => {
    const markup = renderPanel(readyForecast);

    expect(markup).toContain('Horizonte de 7 días');
    expect(markup).toContain('Horizonte de 14 días');
    expect(markup).toContain('sm:grid-cols-2');
    expect(markup).toContain('Arroz');
    expect(markup).toContain('Suficiente');
    expect(markup).toContain('500 g');
    expect(markup).toContain('4 porciones');
    expect(markup).toContain('America/Argentina/Buenos_Aires');
  });

  it('keeps ingredient-level unknown visible without rendering a missing quantity as zero', () => {
    const forecast: MealPlanCoverageForecast = {
      ...readyForecast,
      items: [
        {
          ...readyForecast.items[0],
          availableQuantity: null,
          availableUnit: 'unknown',
          projectedUsedQuantity: null,
          projectedRemainingQuantity: null,
          missingQuantity: null,
          status: 'unknown',
        },
      ],
      summary: { sufficient: 0, partial: 0, missing: 0, unknown: 1 },
    };
    const markup = renderPanel(forecast);

    expect(markup).toContain('Disponibilidad desconocida');
    expect(markup).not.toContain('Faltan 0');
    expect(markup).not.toContain('Disponible 0');
  });
});
