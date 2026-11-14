import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { getPool, query } from '@/lib/db';
import { createTenant, findTenantById, updateTenant } from '@/lib/db/repositories/tenantRepository';
import {
  createUser,
  findUserByEmail,
  listUsersByTenant,
  updateUser,
} from '@/lib/db/repositories/userRepository';
import {
  createSession,
  deleteSessionByTokenHash,
  findSessionByTokenHash,
  touchSessionLastSeen,
} from '@/lib/db/repositories/sessionRepository';
import {
  createPasswordResetToken,
  findActivePasswordResetToken,
  markPasswordResetTokenUsed,
} from '@/lib/db/repositories/passwordResetRepository';
import {
  createInventoryItem,
  deleteInventoryItem,
  findInventoryItemById,
  listInventoryItemsScoped,
} from '@/lib/db/repositories/inventoryRepository';
import { manageInventoryItem } from '@/lib/db/repositories/inventoryManagementRepository';
import {
  createShoppingListItem,
  deleteShoppingListItem,
  listShoppingListItems,
  updateShoppingListItemStatus,
} from '@/lib/db/repositories/shoppingListRepository';
import {
  findCulinaryProfileByUserId,
  listCulinaryDimensions,
  setCulinaryProfileTerms,
  upsertCulinaryProfile,
} from '@/lib/db/repositories/culinaryProfileRepository';
import {
  createPersistentRecipe,
  listPersistentRecipes,
} from '@/lib/db/repositories/recipeRepository';
import {
  createGlobalBook,
  createGlobalPdfRecord,
  insertBookChunks,
} from '@/lib/db/repositories/pdfRepository';
import { searchChunks } from '@/lib/db/repositories/bookChunkRepository';

const enabled = process.env.COCINACORE_PROVISIONED_RUNTIME_INTEGRATION === 'true';
const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.RUNTIME_TEST_ADMIN_DATABASE_URL;

describe.skipIf(!enabled)('provisioned runtime PostgreSQL access', () => {
  let admin: Client | undefined;
  let tenantId: string | undefined;
  let userId: string | undefined;
  let userEmail: string | undefined;
  let globalBookId: string | undefined;

  beforeAll(async () => {
    if (!appUrl || !adminUrl) {
      throw new Error('Runtime integration test requires disposable application and admin URLs.');
    }
    getPool();
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();

    const tenant = await createTenant({ name: 'Provisioned runtime integration tenant' });
    tenantId = tenant.id;
    userEmail = `runtime-${randomUUID()}@example.invalid`;
    const user = await createUser({
      email: userEmail,
      passwordHash: 'not-a-real-password-hash',
      fullName: 'Runtime ACL Fixture',
      tenantId,
      role: 'member',
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: 'runtime-acl-test',
    });
    userId = user.id;
    await query(
      'insert into public.tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)',
      [tenantId, userId, 'member']
    );
  }, 30_000);

  afterAll(async () => {
    try {
      if (admin && globalBookId) {
        await admin.query('delete from public.global_books where id = $1', [globalBookId]);
      }
      if (admin && userId) {
        await admin.query('delete from public.users where id = $1', [userId]);
      }
      if (admin && tenantId) {
        await admin.query('delete from public.tenants where id = $1', [tenantId]);
      }
    } finally {
      if (admin) await admin.end();
      await getPool().end();
    }
  }, 30_000);

  it('runs the application repository operations retained by the explicit runtime ACL', async () => {
    if (!tenantId || !userId) throw new Error('Runtime fixture setup failed.');

    expect((await findTenantById(tenantId))?.id).toBe(tenantId);
    expect((await updateTenant(tenantId, { name: 'Updated runtime tenant' }))?.name).toBe(
      'Updated runtime tenant'
    );
    expect((await findUserByEmail(userEmail!))?.id).toBe(userId);
    expect(await findUserByEmail('runtime-lookup-does-not-exist@example.invalid')).toBeNull();
    expect((await listUsersByTenant(tenantId)).some((row) => row.id === userId)).toBe(true);
    expect((await updateUser(userId, { fullName: 'Updated runtime fixture' }))?.full_name).toBe(
      'Updated runtime fixture'
    );
    const membershipInvitation = await admin!.query(
      `insert into public.tenant_invitations
        (tenant_id, email, invited_by, role, invitation_token, expires_at)
       select $1, email, $2, 'member', $3, now() + interval '1 day'
         from public.users where id = $2`,
      [tenantId, userId, `runtime-invite-${randomUUID()}`]
    );
    expect(membershipInvitation.rowCount).toBe(1);
    const invitationToken = (
      await admin!.query<{ invitation_token: string }>(
        'select invitation_token from public.tenant_invitations where tenant_id = $1 order by created_at desc limit 1',
        [tenantId]
      )
    ).rows[0]?.invitation_token;
    if (!invitationToken) throw new Error('Invitation fixture setup failed.');
    const accepted = await query<{ accept_tenant_invitation: string }>(
      'select public.accept_tenant_invitation($1::uuid, $2) as accept_tenant_invitation',
      [userId, invitationToken]
    );
    expect(accepted.rows[0].accept_tenant_invitation).toBe(tenantId);

    const sessionHash = `a${randomUUID().replaceAll('-', '')}`.slice(0, 64);
    const session = await createSession(userId, sessionHash, new Date(Date.now() + 60_000));
    expect((await findSessionByTokenHash(sessionHash))?.id).toBe(session.id);
    await touchSessionLastSeen(sessionHash);
    await deleteSessionByTokenHash(sessionHash);
    expect(await findSessionByTokenHash(sessionHash)).toBeNull();

    const resetHash = `b${randomUUID().replaceAll('-', '')}`.slice(0, 64);
    const reset = await createPasswordResetToken({
      userId,
      tokenHash: resetHash,
      requestedIpHash: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await findActivePasswordResetToken(resetHash))?.id).toBe(reset.id);
    await markPasswordResetTokenUsed(reset.id);
    expect(await findActivePasswordResetToken(resetHash)).toBeNull();

    const inventory = await createInventoryItem({
      tenantId,
      userId,
      ingredientName: 'ACL smoke rice',
      quantity: '2',
      unit: 'kg',
    });
    const scope = { tenantId, userId };
    expect((await findInventoryItemById(inventory.id, tenantId, scope))?.id).toBe(inventory.id);
    const current = (await listInventoryItemsScoped(scope)).find((row) => row.id === inventory.id);
    if (!inventory.revision) throw new Error('Missing created inventory revision');
    expect(current?.revision).toBe(inventory.revision);
    expect(
      await manageInventoryItem(scope, {
        id: inventory.id,
        revision: inventory.revision,
        action: 'stock',
        command: { kind: 'convert', unit: 'g' },
      })
    ).toMatchObject({ status: 'updated', item: { quantity: '2000', unit: 'g' } });
    expect(await deleteInventoryItem(inventory.id, tenantId, scope)).toBe('deleted');
    expect(await findInventoryItemById(inventory.id, tenantId, scope)).toBeNull();

    const shoppingItem = await createShoppingListItem({
      tenantId,
      userId,
      ingredientName: 'ACL smoke lentils',
      source: 'runtime-acl-test',
      quantity: '1 bag',
    });
    expect(
      (await listShoppingListItems(tenantId, userId)).some((row) => row.id === shoppingItem.id)
    ).toBe(true);
    expect(
      (await updateShoppingListItemStatus(shoppingItem.id, tenantId, userId, 'purchased'))?.status
    ).toBe('purchased');
    expect((await deleteShoppingListItem(shoppingItem.id, tenantId, userId))?.id).toBe(
      shoppingItem.id
    );

    const profile = await upsertCulinaryProfile({ userId, tenantId });
    expect((await findCulinaryProfileByUserId(userId, tenantId))?.user_id).toBe(profile.user_id);
    expect(Array.isArray(await listCulinaryDimensions())).toBe(true);
    await setCulinaryProfileTerms(userId, tenantId, []);

    const recipe = await createPersistentRecipe(
      { tenantId, userId },
      {
        title: 'Runtime ACL recipe',
        instructions: 'Mix and cook.',
        servings: 2,
        ingredients: [{ name: 'rice', quantity: '100', unit: 'g' }],
      }
    );
    expect(
      (await listPersistentRecipes({ tenantId, userId }, { limit: 10 })).some(
        (row) => row.id === recipe.id
      )
    ).toBe(true);

    const globalBook = await createGlobalBook({
      title: 'Runtime ACL global book',
      author: null,
      description: null,
      cuisineRegion: 'test',
      cuisineCountry: null,
      cuisineStyle: null,
      tags: [],
    });
    globalBookId = globalBook.id;
    await createGlobalPdfRecord({
      globalBookId,
      storagePath: `runtime-acl/${globalBookId}.pdf`,
      fileSizeBytes: 1,
      pageCount: 1,
      checksumSha256: 'a'.repeat(64),
      uploadedBy: userId,
    });
    const embedding = Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));
    await insertBookChunks([
      {
        tenantId: null,
        tenantBookId: null,
        globalBookId,
        sourceType: 'global_pdf',
        content: 'Runtime ACL search fixture',
        metadata: { test: true },
        embedding,
      },
    ]);
    const chunks = await searchChunks({
      embedding,
      tenantId,
      userId,
      matchThreshold: 0,
      matchCount: 5,
      statementTimeoutMs: 5_000,
    });
    expect(chunks.some((row) => row.content === 'Runtime ACL search fixture')).toBe(true);

    const ownerMetricQueries = await Promise.all([
      query('select count(*)::text as count from public.tenants'),
      query('select count(*)::text as count from public.users'),
      query('select count(*)::text as count from public.global_books'),
      query('select count(*)::text as count from public.global_pdf_library'),
      query(
        'select count(*)::text as count from public.book_chunks where global_book_id is not null'
      ),
      query('select count(*)::text as count from public.premium_review_reports'),
      query('select count(*)::text as count from public.platform_owners'),
    ]);
    expect(ownerMetricQueries.every((result) => result.rows[0]?.count !== undefined)).toBe(true);
  }, 45_000);
});
