import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WastePreventionPanel, type WastePreventionViewReport } from './waste-prevention-card';

const report: WastePreventionViewReport = {
  status: 'ready',
  asOfDate: '2026-10-26',
  timeZone: 'America/Caracas',
  windowDays: 5,
  lots: [
    {
      lotId: 'today',
      ingredientName: 'Tomate',
      status: 'due_today',
      calendarDate: '2026-10-26',
      expirationDate: '2026-10-26',
      daysRemaining: 0,
      quantity: '2',
      unit: 'unidad',
      quantityStatus: 'known',
    },
    {
      lotId: 'expired',
      ingredientName: 'Leche',
      status: 'expired',
      calendarDate: '2026-10-25',
      expirationDate: '2026-10-25',
      daysRemaining: -1,
      quantity: null,
      unit: null,
      quantityStatus: 'unknown',
    },
    {
      lotId: 'unknown',
      ingredientName: 'Arroz',
      status: 'unknown',
      calendarDate: null,
      expirationDate: null,
      daysRemaining: null,
      quantity: null,
      unit: null,
      quantityStatus: 'unknown',
      reason: 'missing_expiration_date',
    },
  ],
  suggestions: [
    {
      recipeId: 'recipe-1',
      title: 'Ensalada de tomate',
      coverage: 'partial',
      matchedIngredientCount: 1,
      requiredIngredientCount: 2,
      expiringLotCount: 1,
      earliestUpcomingLotDate: '2026-10-26',
      ingredients: [],
    },
  ],
};

describe('WastePreventionPanel', () => {
  it('separates due-soon, expired, and unknown states without suggesting expired consumption', () => {
    const markup = renderToStaticMarkup(<WastePreventionPanel report={report} profileConfigured />);

    expect(markup).toContain('Vence hoy');
    expect(markup).toContain('Vencidos y datos incompletos');
    expect(markup).toContain('No se recomienda consumirlo');
    expect(markup).toContain('Fecha no confirmada');
    expect(markup).toContain('Cantidad no registrada');
    expect(markup).toContain('Ensalada de tomate');
  });

  it('shows uncertainty when culinary restrictions are not configured', () => {
    const markup = renderToStaticMarkup(
      <WastePreventionPanel report={report} profileConfigured={false} />
    );

    expect(markup).toContain('no se pueden verificar preferencias o alergias desconocidas');
    expect(markup).toContain('Las sugerencias quedan pausadas');
    expect(markup).not.toContain('Ensalada de tomate');
    expect(markup).toContain('Revisar inventario');
    expect(markup).toContain('Ver biblioteca');
  });

  it('keeps actions navigational and responsive without mutation controls', () => {
    const markup = renderToStaticMarkup(<WastePreventionPanel report={report} profileConfigured />);

    expect(markup).toContain('md:grid-cols-2');
    expect(markup).toContain('/recipes/recipe-1');
    expect(markup).not.toContain('Eliminar');
    expect(markup).not.toContain('Marcar como consumido');
    expect(markup).not.toContain('Agregar a compras');
  });
});
