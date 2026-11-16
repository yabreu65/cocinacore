import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import type { AuthUser } from '../../src/lib/auth/types';
import type { CulinaryProfileApiData } from '../../src/lib/profile/culinary-profile-contract';
import { validateE2ETargets } from '../database-target';
import { assertE2EDisposableIsolation, closeE2EDatabase } from '../fixtures/database';

test('persists culinary profile details for the authenticated synthetic user', async ({ page }) => {
  test.skip(
    process.env.COCINACORE_ISOLATED_E2E !== '1',
    'Requires the isolated E2E runner to prevent creating data in the default environment.'
  );

  const database = new Pool({ connectionString: validateE2ETargets(process.env).databaseUrl });
  try {
    await assertE2EDisposableIsolation(database);
    const uniqueId = randomUUID();
    const email = `m2-profile-e2e-${uniqueId}@cocinacore.local`;
    const password = `M2ProfileE2E!${randomUUID()}`;
    const signupResponse = await page.request.post('/api/auth/signup', {
      data: {
        email,
        password,
        confirmPassword: password,
        fullName: 'M2 Culinary Profile E2E',
        termsAccepted: true,
      },
    });
    expect(signupResponse.ok()).toBeTruthy();
    const { user: identity } = (await signupResponse.json()) as { user: AuthUser };
    if (!identity.tenant) throw new Error('Signup must create a household tenant.');
    expect(identity.tenant.role).toBe('owner');
    expect(identity.tenant.tenantType).toBe('home');
    const tenantId = identity.tenant.tenantId;
    const accountCounts = async () =>
      (await database.query<{ users: number; memberships: number }>(
        `select
           (select count(*)::int from public.users where tenant_id=$1) as users,
           (select count(*)::int from public.tenant_memberships where tenant_id=$1) as memberships`,
        [tenantId]
      )).rows[0];
    expect(await accountCounts()).toEqual({ users: 1, memberships: 1 });
    const join = await page.request.post('/api/auth/signup', {
      data: {
        email: `join-${uniqueId}@cocinacore.local`,
        password,
        confirmPassword: password,
        fullName: 'Synthetic join attempt',
        termsAccepted: true,
        tenantId,
      },
    });
    expect(join.status()).toBe(400);
    expect(await accountCounts()).toEqual({ users: 1, memberships: 1 });
    await page.goto('/members');
    await expect(page).toHaveURL('/profile');
    await page.goto('/billing');
    await expect(page.getByRole('main').getByText('Una cuenta por hogar', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Gestionar miembros' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Mis comensales' }).click();
    await expect(page).toHaveURL('/profile');
    await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible();

    const availableTime = page.getByLabel('Tiempo disponible (minutos)');
    const dislikedIngredients = page.getByLabel('Ingredientes que no te gustan');
    const allergies = page.getByLabel('Alergias adicionales');

    await availableTime.fill('45');
    await dislikedIngredients.fill('aceitunas\ncilantro');
    await allergies.fill('alergia a la proteína de la leche\nmariscos');
    const peanut = page.getByRole('button', { name: 'Maní (cacahuate)', exact: true });
    const treeNuts = page.getByRole('button', { name: 'Frutos secos de árbol', exact: true });
    await peanut.click();
    await expect(peanut).toHaveAttribute('aria-pressed', 'true');
    await expect(treeNuts).toHaveAttribute('aria-pressed', 'false');
    await treeNuts.click();
    await expect(treeNuts).toHaveAttribute('aria-pressed', 'true');
    await peanut.click();
    await expect(peanut).toHaveAttribute('aria-pressed', 'false');
    await expect(treeNuts).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Añadir comensal' }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('E2E Household Member');
    await page.getByLabel('Grupo de edad').selectOption('child');

    await page.getByRole('button', { name: 'Guardar perfil culinario' }).click();
    await expect(
      page.getByText('Perfil culinario guardado. CocinaCore ya usará estas preferencias.')
    ).toBeVisible();

    const [persisted] = await Promise.all([
      page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/profile' &&
        response.request().method() === 'GET'
      ),
      page.reload(),
    ]);
    expect(persisted.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Perfil', exact: true })).toBeVisible();
    await expect(page.getByLabel('Tiempo disponible (minutos)')).toHaveValue('45');
    await expect(page.getByLabel('Ingredientes que no te gustan')).toHaveValue('aceitunas\ncilantro');
    await expect(page.getByLabel('Alergias adicionales')).toHaveValue('alergia a la proteína de la leche\nmariscos');
    await expect(peanut).toHaveAttribute('aria-pressed', 'false');
    await expect(treeNuts).toHaveAttribute('aria-pressed', 'true');

    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('E2E Household Member');
    await expect(page.getByLabel('Grupo de edad')).toHaveValue('child');
    expect(await accountCounts()).toEqual({ users: 1, memberships: 1 });
    const profile = (await persisted.json()) as CulinaryProfileApiData;
    expect(profile.user.id).toBe(identity.id);
    expect(profile.user.tenant?.tenantId).toBe(tenantId);
    expect(profile.profile?.householdMembers).toEqual([
      { name: 'E2E Household Member', ageGroup: 'child' },
    ]);
    // Historical data only: do not hide previously created accounts or invite new ones.
    const legacyId = randomUUID();
    try {
      await database.query(
        "insert into public.users(id,tenant_id,email,password_hash,role,full_name) values ($1,$2,$3,'fixture','member','Legacy household fixture')",
        [legacyId, tenantId, legacyId + '@example.invalid']
      );
      await database.query(
        "insert into public.tenant_memberships(tenant_id,user_id,role) values ($1,$2,'member')",
        [tenantId, legacyId]
      );
      await page.goto('/billing');
      await expect(page.getByRole('main').getByText('Accesos históricos: 2', { exact: true })).toBeVisible();
      await expect(page.getByRole('main').getByText('Una cuenta por hogar', { exact: true })).toHaveCount(0);
      await page.getByRole('link', { name: 'Ver accesos existentes' }).click();
      await expect(page.getByRole('heading', { name: 'Accesos existentes' })).toBeVisible();
      await expect(page.getByText(legacyId + '@example.invalid', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Invitaciones' })).toHaveCount(0);
      expect(await accountCounts()).toEqual({ users: 2, memberships: 2 });
    } finally {
      await database.query('delete from public.tenant_memberships where tenant_id=$1 and user_id=$2', [tenantId, legacyId]);
      await database.query('delete from public.users where tenant_id=$1 and id=$2', [tenantId, legacyId]);
    }
  } finally {
    await database.end();
    await closeE2EDatabase();
  }
});
