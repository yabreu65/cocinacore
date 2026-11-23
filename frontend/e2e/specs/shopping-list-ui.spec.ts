import { expect, test } from '@playwright/test';
import { injectAuth } from '../fixtures/auth';

type ShoppingItem = {
  id: string;
  source: string;
  ingredient_name: string;
  quantity: string | null;
  status: 'pending' | 'purchased';
  created_at: string;
  updated_at: string;
  purchased_quantity?: string | null;
  purchased_unit?: string | null;
  transfer_inventory_item_id?: string | null;
  transferred_at?: string | null;
};

const plannerId = '7f3c2af1-9d68-4b1f-a49a-a8e6c415a0d2';
const manualItem: ShoppingItem = {
  id: 'manual-row-1',
  source: 'manual',
  ingredient_name: 'Tomates',
  quantity: '2 kg',
  status: 'pending',
  created_at: '2025-01-01T10:00:00.000Z',
  updated_at: '2025-01-01T10:00:00.000Z',
};
const plannerItem: ShoppingItem = {
  id: 'planner-row-1',
  source: `meal-plan:${plannerId}`,
  ingredient_name: 'Arroz',
  quantity: null,
  status: 'purchased',
  created_at: '2025-01-02T10:00:00.000Z',
  updated_at: '2025-01-02T10:00:00.000Z',
};

async function setupShoppingApi(
  page: Parameters<typeof injectAuth>[0],
  initialItems: ShoppingItem[] = []
) {
  let items = [...initialItems];
  let failNext: 'POST' | 'PATCH' | 'DELETE' | null = null;
  const requests: Array<{ method: string; body?: unknown; pathname: string }> = [];

  await page.route('**/api/shopping-list**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body: unknown =
      method === 'POST' || method === 'PATCH' ? (request.postDataJSON() as unknown) : undefined;
    requests.push({ method, body, pathname: url.pathname });

    if (method === 'GET' && url.pathname === '/api/shopping-list') {
      await route.fulfill({ json: { items } });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/shopping-list/purchase-group') {
      const purchase = body as {
        groupKey: string;
        actualQuantity: string;
        rows: Array<{ id: string; ingredientName: string; quantity: string | null }>;
      };
      const current = items.filter((item) =>
        purchase.rows.some(
          (r) =>
            r.id === item.id &&
            r.ingredientName === item.ingredient_name &&
            r.quantity === item.quantity &&
            item.status === 'pending'
        )
      );
      if (current.length !== purchase.rows.length) {
        await route.fulfill({ status: 409, json: { error: 'La lista cambió.' } });
        return;
      }
      const [quantity, unit] = purchase.actualQuantity.split(' ');
      if (purchase.groupKey === 'pending:huevos' && (unit !== 'unidad' || Number(quantity) < 26)) {
        await route.fulfill({
          status: 409,
          json: { error: 'La cantidad comprada no cubre lo necesario.' },
        });
        return;
      }
      const updated = current.map((item) => ({
        ...item,
        status: 'purchased' as const,
        transfer_inventory_item_id: 'inventory-eggs-1',
        transferred_at: '2026-11-21T12:00:00Z',
        purchased_quantity: quantity,
        purchased_unit: unit,
      }));
      const changed = new Map(updated.map((r) => [r.id, r]));
      items = items.map((r) => changed.get(r.id) ?? r);
      await route.fulfill({
        json: {
          items: updated,
          inventoryItem: { id: 'inventory-eggs-1', quantity, unit },
        },
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/shopping-list') {
      if (failNext === 'POST') {
        failNext = null;
        await route.fulfill({ status: 500, json: { error: 'No se pudo guardar el artículo.' } });
        return;
      }
      const submitted = body as { ingredientName: string; quantity: string | null; source: string };
      const item: ShoppingItem = {
        id: `created-${items.length + 1}`,
        source: submitted.source,
        ingredient_name: submitted.ingredientName,
        quantity: submitted.quantity,
        status: 'pending',
        created_at: '2025-01-03T10:00:00.000Z',
        updated_at: '2025-01-03T10:00:00.000Z',
      };
      items = [...items, item];
      await route.fulfill({ status: 201, json: { item } });
      return;
    }

    const itemId = url.pathname.split('/').at(-1);
    if (method === 'PATCH' && itemId) {
      if (failNext === 'PATCH') {
        failNext = null;
        await route.fulfill({ status: 500, json: { error: 'No se pudo cambiar el estado.' } });
        return;
      }
      const status = (body as { status: ShoppingItem['status'] }).status;
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) {
        await route.fulfill({ status: 404, json: { error: 'No encontrado.' } });
        return;
      }
      const updated = { ...item, status };
      items = items.map((candidate) => (candidate.id === itemId ? updated : candidate));
      await route.fulfill({ json: { item: updated } });
      return;
    }

    if (method === 'DELETE' && itemId) {
      if (failNext === 'DELETE') {
        failNext = null;
        await route.fulfill({ status: 500, json: { error: 'No se pudo eliminar el artículo.' } });
        return;
      }
      items = items.filter((candidate) => candidate.id !== itemId);
      await route.fulfill({ json: { ok: true } });
      return;
    }

    await route.fulfill({ status: 404, json: { error: 'Ruta no encontrada.' } });
  });

  return {
    requests,
    fail: (method: 'POST' | 'PATCH' | 'DELETE') => {
      failNext = method;
    },
  };
}

async function openShoppingList(
  page: Parameters<typeof injectAuth>[0],
  items: ShoppingItem[] = []
) {
  await injectAuth(page);
  const api = await setupShoppingApi(page, items);
  await page.goto('/shopping-list');
  return api;
}

test.describe('Shopping List UI', () => {
  test('loads sections, counts, quantities, status, and private provenance labels', async ({
    page,
  }) => {
    await openShoppingList(page, [manualItem, plannerItem]);

    await expect(page.getByRole('heading', { name: 'Lista de compras' })).toBeVisible();
    await expect(page.getByRole('link', { name: /volver/i })).toHaveAttribute('href', '/app');
    await expect(page.getByRole('heading', { name: /pendientes\s*\(1\)/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /comprados\s*\(1\)/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tomates' })).toBeVisible();
    await expect(page.getByText('2 kg')).toBeVisible();
    await expect(page.getByText('Agregado manualmente')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Arroz' })).toBeVisible();
    await expect(page.getByText('Desde el planificador')).toBeVisible();
    await expect(page.getByText('Estado: Comprado', { exact: true })).toBeVisible();
    await expect(page.getByText(plannerId)).toHaveCount(0);
  });

  test('shows consolidated eggs and suggested commercial packages without changing stored rows', async ({
    page,
  }) => {
    const source: ShoppingItem[] = [
      { ...manualItem, id: 'egg-a', ingredient_name: 'Huevo', quantity: '11 unidad' },
      { ...manualItem, id: 'egg-b', ingredient_name: 'Huevos', quantity: '15 unidad' },
      { ...manualItem, id: 'rice-a', ingredient_name: 'Arroz blanco', quantity: '700 g' },
      { ...manualItem, id: 'rice-b', ingredient_name: 'Arroz blanco cocido', quantity: '500 g' },
    ];
    const api = await openShoppingList(page, source);

    await expect(page.getByRole('heading', { name: 'Pendientes (3)' })).toBeVisible();
    const eggs = page.getByRole('region', { name: 'Huevos consolidado' });
    await expect(eggs).toContainText('Necesario: 26 unidades');
    await expect(eggs).toContainText('Comprar: 1 cartón de 30 huevos');
    await eggs.getByText('Gestionar 2 registros de origen').click();
    await expect(eggs.getByRole('button', { name: 'Eliminar Huevo', exact: true })).toBeVisible();
    await expect(eggs.getByRole('button', { name: 'Eliminar Huevos', exact: true })).toBeVisible();

    const rice = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Arroz blanco', exact: true }),
    });
    await expect(rice).toContainText('Comprar: 1 paquete de 1 kg');
    const cooked = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Arroz blanco cocido', exact: true }),
    });
    await expect(cooked).not.toContainText('paquete de 1 kg');
    expect(api.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  test('confirms a real carton of 30 for 26 eggs, records once and displays the receipt after reload', async ({
    page,
  }) => {
    const api = await openShoppingList(page, [
      { ...manualItem, id: 'egg-a', ingredient_name: 'Huevo', quantity: '11 unidad' },
      { ...manualItem, id: 'egg-b', ingredient_name: 'Huevos', quantity: '15 unidad' },
    ]);
    const grouped = page.getByRole('region', { name: 'Huevos consolidado' });
    await expect(grouped).toContainText('Necesario: 26 unidades');
    await expect(grouped.getByLabel('Cantidad realmente comprada de Huevos')).toHaveValue('');
    await expect(grouped.getByText('Cantidad sugerida:')).toContainText('30 unidad');
    await expect(
      grouped.getByRole('button', { name: 'Confirmar compra e inventario' })
    ).toBeDisabled();
    await expect(grouped.getByLabel('Unidad de compra de Huevos')).toHaveValue('unidad');
    await grouped.getByLabel('Cantidad realmente comprada de Huevos').fill('25');
    await grouped.getByRole('button', { name: 'Confirmar compra e inventario' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'no cubre lo necesario' })
    ).toContainText('no cubre lo necesario');
    await expect(page.getByRole('heading', { name: 'Pendientes (1)' })).toBeVisible();

    await grouped.getByLabel('Cantidad realmente comprada de Huevos').fill('30');
    page.once('dialog', (d) => d.accept());
    await grouped.getByRole('button', { name: 'Confirmar compra e inventario' }).click();
    await expect(page.getByRole('heading', { name: 'Comprados (1)' })).toBeVisible();
    await expect(page.getByText(/Huevos: 30 unidad registrados en el inventario/)).toBeVisible();
    const posts = api.requests.filter(
      (r) => r.method === 'POST' && r.pathname.endsWith('/purchase-group')
    );
    expect(posts).toHaveLength(1); // invalid partial purchase is rejected before network call
    expect(posts[0]?.body).toMatchObject({
      groupKey: 'pending:huevos',
      actualQuantity: '30 unidad',
      rows: [
        { id: 'egg-a', ingredientName: 'Huevo', quantity: '11 unidad' },
        { id: 'egg-b', ingredientName: 'Huevos', quantity: '15 unidad' },
      ],
    });
    await page.reload();
    const bought = page.getByRole('region', { name: 'Huevos consolidado' });
    await expect(bought).toContainText('Necesario: 26 unidades');
    await expect(bought).toContainText('Comprado e ingresado al inventario: 30 unidades');
    expect(
      api.requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/purchase-group'))
    ).toHaveLength(1);
  });

  test('keeps long ingredient names visible beside wrapped actions', async ({ page }) => {
    const longIngredient = `Ingrediente ${'extraordinariamente-largo-'.repeat(20)}`;
    await openShoppingList(page, [{ ...manualItem, ingredient_name: longIngredient }]);

    const heading = page.getByRole('heading', { name: longIngredient });
    const article = page.getByRole('article').filter({ has: heading });
    await expect(heading).toBeVisible();
    await expect(article).toBeVisible();
    await expect(article.getByRole('button', { name: `Eliminar ${longIngredient}` })).toBeVisible();
    const bounds = await heading.boundingBox();
    expect(bounds?.width).toBeGreaterThan(0);
  });

  test('guides the user when both sections are empty', async ({ page }) => {
    await openShoppingList(page);

    await expect(page.getByText(/tu lista está vacía/i)).toBeVisible();
    await expect(
      page.getByText(
        'Cuando agregues ingredientes o confirmes los faltantes de un menú, aparecerán aquí.'
      )
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Agregar ingrediente' })).toHaveAttribute(
      'href',
      '#shopping-ingredient-name'
    );
    await expect(page.getByRole('link', { name: 'Ver planificador' })).toHaveAttribute(
      'href',
      '/meal-planner'
    );
    await expect(page.getByText('No tenés compras pendientes.')).toBeVisible();
    await expect(page.getByText('No hay compras marcadas como realizadas.')).toBeVisible();
  });

  test('creates with the exact manual payload, toggles only status, and confirms exact-row deletion', async ({
    page,
  }) => {
    const api = await openShoppingList(page, [manualItem, plannerItem]);

    await page.getByLabel(/ingrediente/i).fill('Leche');
    await page.getByRole('textbox', { name: 'Cantidad (opcional)', exact: true }).fill('1 litro');
    const manualAddForm = page.locator('form').filter({ has: page.getByLabel(/ingrediente/i) });
    await manualAddForm.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Leche' })).toBeVisible();
    expect(api.requests.find((request) => request.method === 'POST')?.body).toEqual({
      ingredientName: 'Leche',
      quantity: '1 litro',
      source: 'manual',
    });

    const tomatoes = page.getByRole('article').filter({ hasText: 'Tomates' });
    await tomatoes.getByRole('button', { name: /marcar como comprado/i }).click();
    await expect(page.getByRole('heading', { name: /pendientes\s*\(1\)/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /comprados\s*\(2\)/i })).toBeVisible();
    expect(api.requests.find((request) => request.method === 'PATCH')?.body).toEqual({
      status: 'purchased',
    });

    const rice = page.getByRole('article').filter({ hasText: 'Arroz' });
    await rice.getByRole('button', { name: /marcar como pendiente/i }).click();
    await expect(page.getByRole('heading', { name: /pendientes\s*\(2\)/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /comprados\s*\(1\)/i })).toBeVisible();
    expect(
      api.requests.filter((request) => request.method === 'PATCH').map((request) => request.body)
    ).toEqual([{ status: 'purchased' }, { status: 'pending' }]);

    page.once('dialog', (dialog) => dialog.accept());
    await tomatoes.getByRole('button', { name: /eliminar/i }).click();
    await expect(tomatoes).toHaveCount(0);
    expect(api.requests.find((request) => request.method === 'DELETE')?.pathname).toBe(
      '/api/shopping-list/manual-row-1'
    );
    for (const request of api.requests) {
      expect(JSON.stringify(request.body ?? {})).not.toMatch(/tenant|userId|user_id/i);
    }
  });

  test('retains state and announces controlled errors when create, status update, and delete fail', async ({
    page,
  }) => {
    const api = await openShoppingList(page, [manualItem]);

    api.fail('POST');
    await page.getByLabel(/ingrediente/i).fill('Queso');
    const manualAddForm = page.locator('form').filter({ has: page.getByLabel(/ingrediente/i) });
    await manualAddForm.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'No se pudo guardar el artículo.' })
    ).toBeVisible();
    await expect(page.getByText('Queso')).toHaveCount(0);

    api.fail('PATCH');
    const tomatoes = page.getByRole('article').filter({ hasText: 'Tomates' });
    await tomatoes.getByRole('button', { name: /marcar como comprado/i }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'No se pudo cambiar el estado.' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /pendientes\s*\(1\)/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tomates' })).toBeVisible();

    api.fail('DELETE');
    page.once('dialog', (dialog) => dialog.accept());
    await tomatoes.getByRole('button', { name: /eliminar/i }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'No se pudo eliminar el artículo.' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tomates' })).toBeVisible();
  });
});
