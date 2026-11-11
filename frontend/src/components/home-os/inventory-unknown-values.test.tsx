import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SimulationDayState } from '@/lib/inventory/meal-plan-simulation';
import type { MealPlanProjectionItem } from '@/lib/inventory/meal-plan-projection';
import { InventoryPlaybackCard } from './InventoryPlaybackCard';
import { InventoryDepletionPreview } from './InventoryDepletionPreview';

describe('Household inventory projections preserve unknown values', () => {
  it('does not render unknown before/after playback quantities as zero', () => {
    const day: SimulationDayState = {
      day: 'Lunes',
      dayIndex: 0,
      meals: [],
      ingredients: [
        {
          ingredientName: 'Arroz',
          normalizedName: 'arroz',
          before: null,
          after: null,
          consumed: null,
          unit: 'g',
          status: 'unknown',
        },
      ],
      summary: { consumedCount: 0, criticalCount: 0, lowCount: 0 },
    };
    const html = renderToStaticMarkup(
      <InventoryPlaybackCard dayStates={[day]} selectedDayIndex={0} />
    );
    expect(html).toContain('Cantidad restante sin verificar');
    expect(html).toContain('Sin datos para representar');
    expect(html).not.toContain('0 g restantes');
    expect(html).not.toContain('width:0%');
  });

  it('does not show a depleted bar when projected remaining quantity is unknown', () => {
    const item: MealPlanProjectionItem = {
      ingredientName: 'Arroz',
      normalizedName: 'arroz',
      requiredTotalQuantity: 150,
      requiredUnit: 'g',
      availableQuantity: 200,
      availableUnit: 'g',
      projectedUsedQuantity: null,
      projectedRemainingQuantity: null,
      missingQuantity: null,
      status: 'unknown',
      usedInRecipes: [],
      category: 'Granos',
      estimatedUnitPrice: null,
    };
    const html = renderToStaticMarkup(<InventoryDepletionPreview items={[item]} />);
    expect(html).toContain('Sin datos suficientes para calcular');
    expect(html).not.toContain('width:0%');
  });
});
