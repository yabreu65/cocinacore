import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { countPendingShoppingItems, DashboardDailySnapshot } from './dashboard-daily-snapshot';

describe('UX6: dashboard home returning-user preview', () => {
  it('counts pending shopping items without including purchased items', () => {
    expect(
      countPendingShoppingItems([
        { id: 'a', status: 'pending' },
        { id: 'b', status: 'purchased' },
        { id: 'c', status: 'pending' },
      ])
    ).toBe(2);
    expect(countPendingShoppingItems([])).toBe(0);
  });

  it('links to the existing planning and shopping modules without inventing activity', () => {
    const html = renderToStaticMarkup(<DashboardDailySnapshot />);
    expect(html).toContain('href="/shopping-list"');
    expect(html).toContain('href="/meal-planner"');
    expect(html).toContain('Consultando compras');
    expect(html).toContain('Consultando tu menú');
    expect(html).not.toContain('3 productos');
    expect(html).not.toContain('Tu próxima comida es');
  });
});
