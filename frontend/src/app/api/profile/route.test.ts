import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireUserMock = vi.fn();
const updateUserMock = vi.fn();
const findProfileMock = vi.fn();
const findTermsMock = vi.fn();
const listDimensionsMock = vi.fn();
const listTermsMock = vi.fn();
const saveProfileMock = vi.fn();
const scopedTransactionMock = vi.fn();
const updateUserInTransactionMock = vi.fn();
const saveProfileInTransactionMock = vi.fn();
const lockProfileUpdateMock = vi.fn();
const findProfileInTransactionMock = vi.fn();
const findTermsInTransactionMock = vi.fn();
const transactionClient = { query: vi.fn() };

vi.mock('@/lib/auth/server', () => ({
  requireUser: requireUserMock,
}));

vi.mock('@/lib/db/repositories/userRepository', () => ({
  updateUser: updateUserMock,
  updateUserInTransaction: updateUserInTransactionMock,
}));

vi.mock('@/lib/db/repositories/culinaryProfileRepository', () => ({
  findCulinaryProfileByUserId: findProfileMock,
  findCulinaryProfileTermsByUserId: findTermsMock,
  listCulinaryDimensions: listDimensionsMock,
  listCulinaryTerms: listTermsMock,
  saveCulinaryProfile: saveProfileMock,
  saveCulinaryProfileInTransaction: saveProfileInTransactionMock,
  lockCulinaryProfileUpdateInTransaction: lockProfileUpdateMock,
  findCulinaryProfileByUserIdInTransaction: findProfileInTransactionMock,
  findCulinaryProfileTermsByUserIdInTransaction: findTermsInTransactionMock,
  ProfileTenantMismatchError: class extends Error {},
}));

vi.mock('@/lib/db', () => ({
  scopedTransaction: scopedTransactionMock,
}));

const { GET, PUT } = await import('./route');

const dimensions = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    key: 'cuisine',
    label: 'Cocina',
    sort_order: 1,
    created_at: '2026-01-01',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    key: 'dietary',
    label: 'Restricciones y dietas',
    sort_order: 2,
    created_at: '2026-01-01',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    key: 'technique',
    label: 'Técnica',
    sort_order: 3,
    created_at: '2026-01-01',
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    key: 'ingredient_type',
    label: 'Tipo de ingrediente',
    sort_order: 4,
    created_at: '2026-01-01',
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    key: 'goal',
    label: 'Objetivo',
    sort_order: 5,
    created_at: '2026-01-01',
  },
];

const terms = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    dimension_id: dimensions[0].id,
    label: 'Argentina',
    is_active: true,
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    dimension_id: dimensions[1].id,
    label: 'Sin TACC',
    is_active: true,
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    dimension_id: dimensions[2].id,
    label: 'Ahumado',
    is_active: true,
  },
  {
    id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    dimension_id: dimensions[3].id,
    label: 'Proteína',
    is_active: true,
  },
  {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    dimension_id: dimensions[4].id,
    label: 'Bajar de peso',
    is_active: true,
  },
];

const user = {
  id: 'user-1',
  email: 'user@example.test',
  fullName: 'Yoryi',
  tenant: {
    tenantId: 'tenant-1',
    role: 'owner',
    tenantType: 'home',
    onboardingCompleted: false,
  },
  termsAcceptedAt: null,
  termsVersion: null,
  onboardingCompleted: false,
};

const profile = {
  user_id: 'user-1',
  tenant_id: 'tenant-1',
  level: 'Intermedio',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

function request(body: unknown): Request {
  return new Request('https://app.example.test/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/profile culinary contract', () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    updateUserMock.mockReset();
    findProfileMock.mockReset();
    findTermsMock.mockReset();
    listDimensionsMock.mockReset();
    listTermsMock.mockReset();
    saveProfileMock.mockReset();
    scopedTransactionMock.mockReset();
    updateUserInTransactionMock.mockReset();
    saveProfileInTransactionMock.mockReset();
    lockProfileUpdateMock.mockReset();
    findProfileInTransactionMock.mockReset();
    findTermsInTransactionMock.mockReset();
    transactionClient.query.mockReset();

    scopedTransactionMock.mockImplementation(
      async (_scope: unknown, callback: (client: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient)
    );
    updateUserInTransactionMock.mockResolvedValue({ ...user, full_name: 'Yoryi' });
    saveProfileInTransactionMock.mockResolvedValue(profile);
    lockProfileUpdateMock.mockResolvedValue(undefined);
    findProfileInTransactionMock.mockResolvedValue(profile);
    findTermsInTransactionMock.mockResolvedValue([
      {
        user_id: 'user-1',
        term_id: terms[0].id,
        preference_type: 'identity',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Argentina',
      },
      {
        user_id: 'user-1',
        term_id: terms[1].id,
        preference_type: 'avoid',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Sin TACC',
      },
    ]);
    requireUserMock.mockResolvedValue(user);
    updateUserMock.mockResolvedValue({ ...user, full_name: 'Yoryi' });
    findProfileMock.mockResolvedValue(profile);
    findTermsMock.mockResolvedValue([
      {
        user_id: 'user-1',
        term_id: terms[0].id,
        preference_type: 'identity',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Argentina',
      },
      {
        user_id: 'user-1',
        term_id: terms[1].id,
        preference_type: 'avoid',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Sin TACC',
      },
    ]);
    listDimensionsMock.mockResolvedValue(dimensions);
    listTermsMock.mockResolvedValue(terms);
    saveProfileMock.mockResolvedValue(profile);
  });

  it('returns 401 for unauthenticated GET and PUT before repository access or mutation', async () => {
    requireUserMock.mockRejectedValue(new Error('no auth'));

    const getResponse = await GET();
    const putResponse = await PUT(request({ level: 'Chef' }));

    expect(getResponse.status).toBe(401);
    expect(putResponse.status).toBe(401);
    expect(findProfileMock).not.toHaveBeenCalled();
    expect(findTermsMock).not.toHaveBeenCalled();
    expect(listDimensionsMock).not.toHaveBeenCalled();
    expect(listTermsMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(saveProfileMock).not.toHaveBeenCalled();
    expect(scopedTransactionMock).not.toHaveBeenCalled();
    expect(lockProfileUpdateMock).not.toHaveBeenCalled();
    expect(findProfileInTransactionMock).not.toHaveBeenCalled();
    expect(findTermsInTransactionMock).not.toHaveBeenCalled();
    expect(updateUserInTransactionMock).not.toHaveBeenCalled();
    expect(saveProfileInTransactionMock).not.toHaveBeenCalled();
  });

  it('GET exposes active taxonomy and canonical selected term groups for the authenticated user', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(findProfileMock).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(findTermsMock).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(listDimensionsMock).toHaveBeenCalledTimes(1);
    expect(listTermsMock).toHaveBeenCalledWith(undefined, true);

    const body = (await response.json()) as {
      user: typeof user;
      profile: { level: string | null } | null;
      taxonomy: {
        dimensions: Array<{ id: string; key: string; label: string; sortOrder: number }>;
        terms: Array<{ id: string; dimensionId: string; label: string }>;
      };
      selections: {
        favoriteCuisineTermIds: string[];
        dietaryAvoidTermIds: string[];
        techniqueTermIds: string[];
        ingredientTypeTermIds: string[];
        goalTermIds: string[];
      };
    };

    expect(body.user).toEqual(user);
    expect(body.profile).toEqual({ level: 'Intermedio' });
    expect(body.taxonomy.dimensions).toEqual(
      dimensions.map((dimension) => ({
        id: dimension.id,
        key: dimension.key,
        label: dimension.label,
        sortOrder: dimension.sort_order,
      }))
    );
    expect(body.taxonomy.terms).toEqual(
      terms.map((term) => ({
        id: term.id,
        dimensionId: term.dimension_id,
        label: term.label,
      }))
    );
    expect(body.selections).toEqual({
      favoriteCuisineTermIds: [terms[0].id],
      dietaryAvoidTermIds: [terms[1].id],
      techniqueTermIds: [],
      ingredientTypeTermIds: [],
      goalTermIds: [],
    });
  });

  it('GET requests user B data and does not expose a returned user A profile in the same tenant', async () => {
    const userB = { ...user, id: 'user-2' };
    requireUserMock.mockResolvedValueOnce(userB);
    findProfileMock.mockResolvedValueOnce(profile);
    findTermsMock.mockResolvedValueOnce([]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(findProfileMock).toHaveBeenCalledWith('user-2', 'tenant-1');
    expect(findTermsMock).toHaveBeenCalledWith('user-2', 'tenant-1');
    await expect(response.json()).resolves.toMatchObject({
      user: userB,
      profile: null,
      selections: {
        favoriteCuisineTermIds: [],
        dietaryAvoidTermIds: [],
        techniqueTermIds: [],
        ingredientTypeTermIds: [],
        goalTermIds: [],
      },
    });
  });

  it('PUT derives preference types server-side from trusted taxonomy dimensions', async () => {
    const response = await PUT(
      request({
        fullName: '  Jorge Abreu  ',
        level: 'Intermedio',
        selections: {
          favoriteCuisineTermIds: [terms[0].id],
          dietaryAvoidTermIds: [terms[1].id],
          techniqueTermIds: [terms[2].id],
          ingredientTypeTermIds: [terms[3].id],
          goalTermIds: [terms[4].id],
        },
        onboardingCompleted: true,
        userId: 'browser-user',
        tenantId: 'browser-tenant',
      })
    );

    expect(response.status).toBe(200);
    expect(updateUserInTransactionMock).toHaveBeenCalledWith(transactionClient, 'user-1', {
      fullName: 'Jorge Abreu',
      onboardingCompleted: true,
    });
    expect(saveProfileInTransactionMock).toHaveBeenCalledWith(transactionClient, {
      userId: 'user-1',
      tenantId: 'tenant-1',
      level: 'Intermedio',
      terms: [
        { termId: terms[0].id, preferenceType: 'identity' },
        { termId: terms[1].id, preferenceType: 'avoid' },
        { termId: terms[2].id, preferenceType: 'prefer' },
        { termId: terms[3].id, preferenceType: 'prefer' },
        { termId: terms[4].id, preferenceType: 'goal' },
      ],
    });
  });

  it.each([
    ['same tenant', 'tenant-1'],
    ['different tenant', 'tenant-2'],
  ])(
    'PUT uses session identity for user B in the %s despite forged body identities',
    async (_case, tenantId) => {
      const userB = { ...user, id: 'user-2', tenant: { ...user.tenant, tenantId } };
      requireUserMock.mockResolvedValueOnce(userB);
      findProfileInTransactionMock.mockResolvedValueOnce(null);
      findTermsInTransactionMock.mockResolvedValueOnce([]);

      const response = await PUT(
        request({
          fullName: 'User B',
          level: 'Chef',
          userId: 'user-1',
          tenantId: 'tenant-forged',
        })
      );

      expect(response.status).toBe(200);
      expect(lockProfileUpdateMock).toHaveBeenCalledWith(transactionClient, 'user-2', tenantId);
      expect(findProfileInTransactionMock).toHaveBeenCalledWith(
        transactionClient,
        'user-2',
        tenantId
      );
      expect(findTermsInTransactionMock).toHaveBeenCalledWith(
        transactionClient,
        'user-2',
        tenantId
      );
      expect(updateUserInTransactionMock).toHaveBeenCalledWith(transactionClient, 'user-2', {
        fullName: 'User B',
      });
      expect(saveProfileInTransactionMock).toHaveBeenCalledWith(transactionClient, {
        userId: 'user-2',
        tenantId,
        level: 'Chef',
      });
      expect(updateUserInTransactionMock).not.toHaveBeenCalledWith(
        transactionClient,
        'user-1',
        expect.anything()
      );
      expect(saveProfileInTransactionMock).not.toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({
          userId: 'user-1',
        })
      );
      expect(saveProfileInTransactionMock).not.toHaveBeenCalledWith(
        transactionClient,
        expect.objectContaining({
          tenantId: 'tenant-forged',
        })
      );
    }
  );

  it('rejects a term submitted under the wrong semantic group before any mutation', async () => {
    const response = await PUT(
      request({
        fullName: 'Yoryi',
        level: 'Intermedio',
        selections: {
          favoriteCuisineTermIds: [terms[1].id],
          dietaryAvoidTermIds: [],
          techniqueTermIds: [],
          ingredientTypeTermIds: [],
          goalTermIds: [],
        },
      })
    );

    expect(response.status).toBe(400);
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('rejects unknown or inactive term ids before mutation', async () => {
    listTermsMock.mockResolvedValue([
      ...terms,
      {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        dimension_id: dimensions[0].id,
        label: 'Inactiva',
        is_active: false,
      },
    ]);

    const response = await PUT(
      request({
        selections: {
          favoriteCuisineTermIds: ['99999999-9999-4999-8999-999999999999'],
          dietaryAvoidTermIds: [],
          techniqueTermIds: [],
          ingredientTypeTermIds: [],
          goalTermIds: [],
        },
      })
    );

    expect(response.status).toBe(400);
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('explicitly rejects Avanzado and other invalid levels plus over-bounded selection arrays', async () => {
    const advancedLevel = await PUT(request({ level: 'Avanzado' }));
    expect(advancedLevel.status).toBe(400);
    expect(saveProfileInTransactionMock).not.toHaveBeenCalled();

    const badLevel = await PUT(request({ level: 'Dios de la cocina' }));
    expect(badLevel.status).toBe(400);

    const tooMany = await PUT(
      request({
        selections: {
          favoriteCuisineTermIds: Array.from(
            { length: 7 },
            (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
          ),
        },
      })
    );
    expect(tooMany.status).toBe(400);
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('requires tenant context for culinary persistence', async () => {
    requireUserMock.mockResolvedValueOnce({ ...user, tenant: null });

    const response = await PUT(request({ level: 'Principiante' }));

    expect(response.status).toBe(400);
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('persists bounded household, habitual-time, allergy, and normalized free-text profile fields', async () => {
    const response = await PUT(
      request({
        dislikedIngredients: ['  cilantro  ', 'CILANTRO', '  hongos   secos '],
        allergies: ['  maní  '],
        availableTimeMinutes: 45,
        householdMembers: [
          { name: 'Ana', ageGroup: 'adult' },
          { name: 'Luz', ageGroup: 'child' },
        ],
      })
    );

    expect(response.status).toBe(200);
    expect(saveProfileInTransactionMock).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        dislikedIngredients: ['cilantro', 'hongos secos'],
        allergies: ['maní'],
        availableTimeMinutes: 45,
        householdMembers: [
          { name: 'Ana', ageGroup: 'adult' },
          { name: 'Luz', ageGroup: 'child' },
        ],
      })
    );
  });

  it.each([4, 241, 45.5])(
    'rejects invalid habitual preparation time %s without mutation',
    async (minutes) => {
      const response = await PUT(request({ availableTimeMinutes: minutes }));

      expect(response.status).toBe(400);
      expect(updateUserMock).not.toHaveBeenCalled();
      expect(saveProfileMock).not.toHaveBeenCalled();
    }
  );

  it('rejects unknown household age groups and object keys without mutation', async () => {
    const unknownAgeGroup = await PUT(
      request({
        householdMembers: [{ name: 'Persona', ageGroup: 'senior' }],
      })
    );
    expect(unknownAgeGroup.status).toBe(400);

    const unknownKey = await PUT(
      request({
        householdMembers: [{ name: 'Persona', ageGroup: 'adult', email: 'private@example.test' }],
      })
    );
    expect(unknownKey.status).toBe(400);
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('rejects oversized household lists and blank member names without mutation', async () => {
    const tooMany = await PUT(
      request({
        householdMembers: Array.from({ length: 13 }, (_, index) => ({
          name: `Persona ${index}`,
          ageGroup: 'adult',
        })),
      })
    );
    expect(tooMany.status).toBe(400);

    const blankName = await PUT(request({ householdMembers: [{ name: '  ', ageGroup: 'adult' }] }));
    expect(blankName.status).toBe(400);
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('preserves omitted persisted profile fields when updating a scalar', async () => {
    const persistedFields = {
      available_time_minutes: 45,
      allergies: ['maní'],
      disliked_ingredients: ['cilantro'],
      household_members: [{ name: 'Ana', ageGroup: 'adult' }],
    };
    findProfileMock.mockResolvedValueOnce({ ...profile, level: 'Chef', ...persistedFields });
    findTermsMock.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        term_id: terms[0].id,
        preference_type: 'identity',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Argentina',
      },
      {
        user_id: 'user-1',
        term_id: terms[1].id,
        preference_type: 'avoid',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Sin TACC',
      },
    ]);

    await PUT(request({ level: 'Chef' }));
    expect(saveProfileInTransactionMock).toHaveBeenLastCalledWith(transactionClient, {
      userId: 'user-1',
      tenantId: 'tenant-1',
      level: 'Chef',
    });
  });

  it('preserves omitted selection groups when one selection group is explicitly cleared', async () => {
    findProfileMock.mockResolvedValueOnce({ ...profile, level: 'Intermedio' });
    findTermsMock.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        term_id: terms[0].id,
        preference_type: 'identity',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Argentina',
      },
      {
        user_id: 'user-1',
        term_id: terms[1].id,
        preference_type: 'avoid',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Sin TACC',
      },
    ]);

    await PUT(request({ selections: { favoriteCuisineTermIds: [] } }));

    expect(saveProfileInTransactionMock).toHaveBeenLastCalledWith(transactionClient, {
      userId: 'user-1',
      tenantId: 'tenant-1',
      terms: [{ termId: terms[1].id, preferenceType: 'avoid' }],
    });
  });

  it('omits unsubmitted scalar profile fields from the repository save input', async () => {
    const response = await PUT(request({ fullName: 'Yoryi' }));

    expect(response.status).toBe(200);
    const saveInput = saveProfileInTransactionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(saveInput).not.toHaveProperty('level');
    expect(saveInput).not.toHaveProperty('availableTimeMinutes');
    expect(saveInput).not.toHaveProperty('dislikedIngredients');
    expect(saveInput).not.toHaveProperty('allergies');
    expect(saveInput).not.toHaveProperty('householdMembers');
  });

  it('does not request a terms replacement when selections are omitted', async () => {
    const response = await PUT(request({ level: 'Chef' }));

    expect(response.status).toBe(200);
    const saveInput = saveProfileInTransactionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(saveInput).not.toHaveProperty('terms');
  });

  it('merges a partial selection group with the current persisted terms', async () => {
    findTermsMock.mockResolvedValueOnce([]);
    findTermsInTransactionMock.mockResolvedValueOnce([
      {
        user_id: 'user-1',
        term_id: terms[1].id,
        preference_type: 'avoid',
        weight: 1,
        created_at: '2026-01-01',
        term_label: 'Sin TACC',
      },
    ]);

    const response = await PUT(
      request({
        selections: { favoriteCuisineTermIds: [terms[0].id] },
      })
    );

    expect(response.status).toBe(200);
    expect(findTermsInTransactionMock).toHaveBeenCalledWith(
      transactionClient,
      'user-1',
      'tenant-1'
    );
    const saveInput = saveProfileInTransactionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(saveInput.terms).toEqual([
      { termId: terms[0].id, preferenceType: 'identity' },
      { termId: terms[1].id, preferenceType: 'avoid' },
    ]);
  });

  it('rejects an existing profile from another tenant before terms reads or any mutation', async () => {
    findProfileInTransactionMock.mockResolvedValueOnce({ ...profile, tenant_id: 'tenant-2' });

    const response = await PUT(
      request({
        fullName: 'Changed name',
        onboardingCompleted: true,
        level: 'Chef',
        selections: { favoriteCuisineTermIds: [] },
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'profile_tenant_mismatch' });
    expect(findProfileInTransactionMock).toHaveBeenCalledWith(
      transactionClient,
      'user-1',
      'tenant-1'
    );
    expect(findTermsInTransactionMock).not.toHaveBeenCalled();
    expect(updateUserInTransactionMock).not.toHaveBeenCalled();
    expect(saveProfileInTransactionMock).not.toHaveBeenCalled();
  });

  it('locks and reads mutable profile state through the transaction client before writes', async () => {
    const calls: string[] = [];
    lockProfileUpdateMock.mockImplementation(
      async (client: typeof transactionClient, userId: string) => {
        expect(client).toBe(transactionClient);
        expect(userId).toBe('user-1');
        calls.push('lock');
      }
    );
    findProfileInTransactionMock.mockImplementation(
      async (client: typeof transactionClient, userId: string) => {
        expect(client).toBe(transactionClient);
        expect(userId).toBe('user-1');
        calls.push('profile-read');
        return profile;
      }
    );
    findTermsInTransactionMock.mockImplementation(
      async (client: typeof transactionClient, userId: string) => {
        expect(client).toBe(transactionClient);
        expect(userId).toBe('user-1');
        calls.push('terms-read');
        return [];
      }
    );
    updateUserInTransactionMock.mockImplementation(async () => {
      calls.push('user-write');
      return { ...user, full_name: 'Nuevo nombre' };
    });
    saveProfileInTransactionMock.mockImplementation(async () => {
      calls.push('profile-write');
      return profile;
    });

    const response = await PUT(request({ fullName: 'Nuevo nombre', level: 'Chef' }));

    expect(response.status).toBe(200);
    expect(calls).toEqual(['lock', 'profile-read', 'terms-read', 'user-write', 'profile-write']);
  });

  it('leaves omitted free-text lists out of the save input when one list is explicitly cleared', async () => {
    findProfileInTransactionMock.mockResolvedValueOnce({
      ...profile,
      allergies: ['maní'],
      disliked_ingredients: ['cilantro'],
      household_members: [{ name: 'Ana', ageGroup: 'adult' }],
    });

    await PUT(request({ dislikedIngredients: [] }));

    const saveInput = saveProfileInTransactionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(saveInput).toMatchObject({ dislikedIngredients: [] });
    expect(saveInput).not.toHaveProperty('allergies');
    expect(saveInput).not.toHaveProperty('householdMembers');
  });

  it('rejects free-text lists beyond count and per-value length bounds', async () => {
    const tooManyDislikes = await PUT(
      request({ dislikedIngredients: Array.from({ length: 21 }, (_, index) => `food ${index}`) })
    );
    expect(tooManyDislikes.status).toBe(400);

    const tooLongAllergy = await PUT(request({ allergies: ['a'.repeat(201)] }));
    expect(tooLongAllergy.status).toBe(400);
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it('does not expose a profile owned by another user or tenant', async () => {
    for (const foreignProfile of [
      { ...profile, user_id: 'user-2' },
      { ...profile, tenant_id: 'tenant-2' },
    ]) {
      findProfileMock.mockResolvedValueOnce(foreignProfile);
      const response = await GET();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ profile: null });
    }
  });

  it('persists account and culinary profile changes through one transaction client', async () => {
    const response = await PUT(request({ fullName: 'Nuevo nombre', onboardingCompleted: true }));

    expect(response.status).toBe(200);
    expect(scopedTransactionMock).toHaveBeenCalledTimes(1);
    expect(scopedTransactionMock).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      expect.any(Function)
    );
    expect(updateUserInTransactionMock).toHaveBeenCalledWith(transactionClient, 'user-1', {
      fullName: 'Nuevo nombre',
      onboardingCompleted: true,
    });
    expect(saveProfileInTransactionMock).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-1',
      })
    );
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(saveProfileMock).not.toHaveBeenCalled();
  });

  it.each([
    ['user update', updateUserInTransactionMock],
    ['culinary profile save', saveProfileInTransactionMock],
  ])(
    'returns 500 and rejects the transaction when %s fails',
    async (_operation, failingPersistence) => {
      failingPersistence.mockRejectedValueOnce(new Error('persistence failed'));

      const response = await PUT(request({ fullName: 'Nuevo nombre', onboardingCompleted: true }));

      expect(response.status).toBe(500);
      expect(scopedTransactionMock).toHaveBeenCalledTimes(1);
      await expect(response.json()).resolves.toMatchObject({ error: 'Unable to update profile' });
    }
  );

  it('validates request data before starting a transaction', async () => {
    const response = await PUT(request({ fullName: 'x'.repeat(121) }));

    expect(response.status).toBe(400);
    expect(scopedTransactionMock).not.toHaveBeenCalled();
  });
});
