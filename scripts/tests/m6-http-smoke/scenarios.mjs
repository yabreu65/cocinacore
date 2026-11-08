import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

/** Operational HTTP assertions; admin is exclusively fixture/observation authority. */
export async function runSmoke({
  base,
  admin,
  runtime,
  mark,
  providerRequests,
}) {
  let assertions = 0;
  const pass = async (text) => {
    assertions++;
    await mark(`PASS ${String(assertions).padStart(2, "0")} ${text}`);
  };
  async function request(
    route,
    { cookie, method = "GET", body, status = 200 } = {},
  ) {
    const response = await fetch(`${base}${route}`, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    // Do not include cookies, auth payloads, tokens or secrets in assertion errors.
    assert.equal(
      response.status,
      status,
      `${method} ${route}: expected ${status}, got ${response.status}`,
    );
    return { response, data };
  }
  const credentials = (email) => {
    const password = `${randomBytes(24).toString("hex")}Aa1!`;
    return {
      email,
      password,
      confirmPassword: password,
      fullName: "HTTP smoke fixture",
      termsAccepted: true,
    };
  };
  const authCounts = async () =>
    (
      await admin.query(`select
    (select count(*)::int from tenants) tenants,
    (select count(*)::int from users) users,
    (select count(*)::int from tenant_memberships) memberships,
    (select count(*)::int from sessions) sessions`)
    ).rows[0];
  for (const stage of ["membership", "commit"]) {
    const before = await authCounts();
    const failed = await request("/api/auth/signup", {
      method: "POST",
      body: credentials(`rollback-${stage}@smoke.invalid`),
      status: 400,
    });
    assert.equal(failed.response.headers.get("set-cookie"), null);
    assert.deepEqual(await authCounts(), before);
    assert.equal((await request("/api/auth/session")).data.user, null);
    await pass(
      `HTTP signup rollback fault=${stage} status=400 no_cookie no_partial_tenant/user/membership/session`,
    );
  }
  const actors = [];
  for (const suffix of ["a", "b"]) {
    const signup = await request("/api/auth/signup", {
      method: "POST",
      body: credentials(`tenant-${suffix}@smoke.invalid`),
    });
    const cookieHeader = signup.response.headers.get("set-cookie");
    assert(cookieHeader?.includes("HttpOnly"));
    const cookie = cookieHeader.split(";")[0];
    const user = signup.data.user;
    assert(user.id && user.tenant.tenantId);
    const session = await request("/api/auth/session", { cookie });
    assert.equal(session.data.user.id, user.id);
    const persisted = await admin.query(
      `select u.id, u.tenant_id, m.role,
      (select count(*)::int from sessions s where s.user_id=u.id) sessions
      from users u join tenant_memberships m on m.user_id=u.id and m.tenant_id=u.tenant_id
      where u.id=$1`,
      [user.id],
    );
    assert.equal(persisted.rows[0].sessions, 1);
    assert.equal(persisted.rows[0].role, "owner");
    actors.push({ cookie, id: user.id, tenantId: user.tenant.tenantId });
    await pass(
      `HTTP signup tenant=${suffix} status=200 committed membership/session; cookie GET session=200`,
    );
  }
  const [a, b] = actors;
  assert.notEqual(a.tenantId, b.tenantId);
  assert.deepEqual(await authCounts(), {
    tenants: 2,
    users: 2,
    memberships: 2,
    sessions: 2,
  });

  const role = (
    await runtime.query(`select current_user, session_user, rolsuper, rolbypassrls,
    rolcreatedb, rolcreaterole, rolreplication, rolinherit,
    (select count(*)::int from pg_auth_members where member=r.oid or roleid=r.oid) memberships,
    (select count(*)::int from pg_class where relowner=r.oid) owned_relations
    from pg_roles r where rolname=current_user`)
  ).rows[0];
  assert.equal(role.current_user, "cocinacore_runtime_rls");
  assert.equal(role.session_user, "cocinacore_runtime_rls");
  for (const field of [
    "rolsuper",
    "rolbypassrls",
    "rolcreatedb",
    "rolcreaterole",
    "rolreplication",
    "rolinherit",
  ])
    assert.equal(role[field], false);
  assert.equal(role.memberships, 0);
  assert.equal(role.owned_relations, 0);
  await pass(
    "runtime login current_user=session_user=cocinacore_runtime_rls; no super/bypass/DDL/replication/inherit/membership/ownership",
  );
  const rlsTables = [
    "user_recipes",
    "user_recipe_versions",
    "cooking_sessions",
    "cooking_session_events",
    "real_consumption_operations",
    "meal_consumption_claims",
    "real_consumption_items",
    "real_consumption_substitutions",
    "real_consumption_movement_links",
  ];
  const rls = await runtime.query(
    `select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relnamespace='public'::regnamespace and relname=any($1::text[])`,
    [rlsTables],
  );
  assert.equal(rls.rows.length, rlsTables.length);
  for (const row of rls.rows)
    assert(row.relrowsecurity && row.relforcerowsecurity, row.relname);
  const denied = async (sql) => {
    try {
      await runtime.query(sql);
      assert.fail(`Unexpected SQL authorization: ${sql}`);
    } catch (error) {
      assert.equal(
        error.code,
        "42501",
        `Expected insufficient_privilege for ${sql}`,
      );
    }
  };
  for (const sql of [
    "select * from public.schema_migrations",
    "create table public.smoke_forbidden(id int)",
    "create temp table smoke_forbidden(id int)",
    "truncate public.user_recipes",
    "delete from public.user_recipes",
    "set role postgres",
    "select public.get_owner_overview_metrics()",
  ])
    await denied(sql);
  await pass(
    "RLS ENABLE+FORCE on 9 tables; runtime denied ledger/DDL/TEMP/TRUNCATE/DELETE/SET ROLE/admin function (42501)",
  );

  await request("/api/owner/health", { cookie: a.cookie, status: 403 });
  await pass(
    "HTTP platform admin health denied=403 to ordinary tenant owner; no provider call",
  );
  for (const [index, actor] of actors.entries()) {
    const { data } = await request("/api/recipes", {
      cookie: actor.cookie,
      method: "POST",
      status: 201,
      body: {
        title: `Smoke rice tenant ${index}`,
        instructions: "Stir the rice gently.\nServe in a bowl.",
        servings: 2,
        ingredients: [{ name: "Rice", quantity: "1", unit: "cup" }],
        tags: ["smoke"],
      },
    });
    actor.recipe = data.recipe;
    assert(actor.recipe.id && actor.recipe.current_version.id);
  }
  await pass(
    "HTTP legitimate recipe writes=201 for both tenants through runtime RLS",
  );
  const aList = (await request("/api/recipes", { cookie: a.cookie })).data
    .items;
  assert.equal(aList.length, 1);
  assert.equal(aList[0].id, a.recipe.id);
  await request(`/api/recipes/${b.recipe.id}`, {
    cookie: a.cookie,
    status: 404,
  });
  await pass("HTTP recipe list excludes foreign rows; foreign recipe GET=404");

  assert.equal((await runtime.query("select * from user_recipes")).rowCount, 0);
  await denied(
    `insert into user_recipes(tenant_id,user_id) values('${a.tenantId}','${a.id}')`,
  );
  await runtime.query("begin");
  await runtime.query(
    "select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)",
    [b.tenantId, b.id],
  );
  assert.equal(
    (
      await runtime.query("select * from user_recipes where id=$1", [
        a.recipe.id,
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await runtime.query(
        "update user_recipes set category='forbidden' where id=$1",
        [a.recipe.id],
      )
    ).rowCount,
    0,
  );
  await denied(
    `insert into user_recipes(tenant_id,user_id) values('${a.tenantId}','${a.id}')`,
  );
  await runtime.query("rollback");
  const emptyContext = async () => {
    const row = (
      await runtime.query(`select nullif(current_setting('app.tenant_id',true),'') tenant,
      nullif(current_setting('app.user_id',true),'') usr`)
    ).rows[0];
    assert.deepEqual(row, { tenant: null, usr: null });
  };
  await emptyContext();
  await runtime.query("begin");
  await runtime.query(
    "select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)",
    [a.tenantId, a.id],
  );
  assert.equal((await runtime.query("select * from user_recipes")).rowCount, 1);
  await runtime.query("commit");
  await emptyContext();
  await pass(
    "runtime SQL no-context read=0/write=42501; foreign-context read/update=0/write=42501; same-client COMMIT+ROLLBACK cleanup",
  );

  // Only source data is seeded as a fixture; both recipe and M5 session are HTTP-created.
  const planId = randomUUID();
  const now = new Date().toISOString();
  const calendar = {
    period: "week",
    dayCount: 7,
    schedule: {
      startDate: "2026-11-01",
      timeZone: "America/Caracas",
      confirmedAt: now,
      portionConfirmation: { peopleCount: 2, confirmedAt: now },
    },
    days: Array.from({ length: 7 }, (_, index) => ({
      dayIndex: index + 1,
      label: [
        "Lunes",
        "Martes",
        "Miércoles",
        "Jueves",
        "Viernes",
        "Sábado",
        "Domingo",
      ][index],
      meals: ["breakfast", "lunch", "dinner"].map((mealType) => ({
        mealType,
        title: "Smoke rice",
        prepMinutes: 20,
        description: null,
        ingredients: [{ name: "Rice", quantity: 1, unit: "cup" }],
        ...(index === 0 && mealType === "lunch"
          ? {
              recipeRef: {
                recipeId: a.recipe.id,
                versionId: a.recipe.current_version.id,
              },
            }
          : {}),
      })),
    })),
  };
  await admin.query(
    `insert into user_meal_plans
    (id,tenant_id,user_id,people_count,period,mode,base_cuisine,calendar_payload)
    values($1,$2,$3,2,'week','menu_to_shopping','smoke',$4::jsonb)`,
    [planId, a.tenantId, a.id, JSON.stringify(calendar)],
  );
  const source = (await request("/api/meal-plan", { cookie: a.cookie })).data;
  assert.equal(source.id, planId);
  const startBody = {
    mealPlanId: planId,
    dayIndex: 1,
    mealType: "lunch",
    recipeId: a.recipe.id,
    versionId: a.recipe.current_version.id,
    expectedUpdatedAt: source.updatedAt,
    expectedCalendarPayload: source.plan,
    idempotencyKey: "smoke-start",
    confirmed: true,
  };
  const start = (
    await request("/api/cooking-sessions", {
      cookie: a.cookie,
      method: "POST",
      status: 201,
      body: startBody,
    })
  ).data;
  assert.equal(start.session.status, "active");
  const sessionId = start.session.id;
  const replay = (
    await request("/api/cooking-sessions", {
      cookie: a.cookie,
      method: "POST",
      body: startBody,
    })
  ).data;
  assert.equal(replay.status, "already_applied");
  assert.equal(replay.session.id, sessionId);
  await request(`/api/cooking-sessions/${sessionId}`, { cookie: a.cookie });
  await request(`/api/cooking-sessions/${sessionId}`, {
    cookie: b.cookie,
    status: 404,
  });
  await pass(
    "M5 HTTP start=201/read=200/idempotent replay=200; cross-tenant read=404",
  );
  let version = start.session.version;
  for (const action of ["pause", "resume"]) {
    const mutation = (
      await request(`/api/cooking-sessions/${sessionId}`, {
        cookie: a.cookie,
        method: "PATCH",
        body: {
          action,
          expectedVersion: version,
          idempotencyKey: `smoke-${action}`,
          confirmed: true,
        },
      })
    ).data;
    version = mutation.session.version;
    assert.equal(
      mutation.session.status,
      action === "pause" ? "paused" : "active",
    );
  }
  await pass("M5 HTTP pause/resume=200 persisted versioned writes");
  const snapshot = async () => {
    const result = {};
    for (const table of [
      ...rlsTables,
      "user_meal_plans",
      "recipe_inventory_items",
      "inventory_movements",
    ]) {
      result[table] = (
        await admin.query(
          `select row_to_json(t)::text as value from public.${table} t order by 1`,
        )
      ).rows;
    }
    return JSON.stringify(result);
  };
  const beforeTeacher = await snapshot();
  const teacherPath = `/api/cooking-sessions/${sessionId}/teacher`;
  await request(teacherPath, {
    method: "POST",
    body: { question: "How should I stir?" },
    status: 401,
  });
  await request(teacherPath, {
    cookie: b.cookie,
    method: "POST",
    body: { question: "How should I stir?" },
    status: 404,
  });
  assert.equal(providerRequests.length, 0);
  await pass("M6 HTTP anonymous=401/cross-tenant=404; local provider calls=0");
  const teacher = (
    await request(teacherPath, {
      cookie: a.cookie,
      method: "POST",
      body: { question: "How should I stir?" },
    })
  ).data.response;
  assert.equal(teacher.kind, "explanation");
  assert.equal(
    teacher.answer,
    "Stir gently following the current recipe instruction.",
  );
  assert.equal(teacher.evidence, "partial");
  assert.equal(teacher.sessionMutation, "none");
  assert.deepEqual(teacher.citations, []);
  const generation = providerRequests.filter((entry) =>
    entry.pathname.endsWith(":generateContent"),
  );
  const embeddings = providerRequests.filter((entry) =>
    entry.pathname.endsWith(":embedContent"),
  );
  assert.equal(generation.length, 1);
  assert(embeddings.length >= 1);
  const prompt = JSON.stringify(generation[0].body);
  assert(prompt.includes("How should I stir?"));
  assert(prompt.includes("Smoke rice tenant 0"));
  assert(!prompt.includes("Smoke rice tenant 1"));
  assert.deepEqual(await snapshot(), beforeTeacher);
  await pass(
    `M6 HTTP teacher=200 kind=explanation evidence=partial sessionMutation=none; local embedding_calls=${embeddings.length} generation_calls=1; business snapshot unchanged`,
  );

  // Authentication after RLS operations must reuse actual HTTP pool backends cleanly.
  for (const actor of [b, a, b, a])
    await request("/api/auth/session", { cookie: actor.cookie });
  const observations = (
    await admin.query(
      "select * from smoke_fixture.observations order by observed_at",
    )
  ).rows;
  const httpRows = observations.filter(
    (row) => row.login_user === "cocinacore_runtime_rls",
  );
  assert(httpRows.length > 0);
  for (const row of httpRows)
    assert.equal(row.effective_user, "cocinacore_runtime_rls");
  const authRows = httpRows.filter((row) =>
    ["users", "sessions"].includes(row.relation_name),
  );
  const scopedRows = httpRows.filter((row) =>
    ["user_recipes", "cooking_sessions"].includes(row.relation_name),
  );
  assert(authRows.length >= 4 && scopedRows.length >= 5);
  for (const row of authRows) {
    assert.equal(row.tenant_context, null);
    assert.equal(row.user_context, null);
  }
  for (const row of scopedRows) {
    assert.equal(row.tenant_context, row.row_tenant);
    assert.equal(row.user_context, row.row_user);
  }
  const reused = scopedRows.filter((scoped) =>
    authRows.some(
      (auth) =>
        auth.backend_pid === scoped.backend_pid &&
        new Date(auth.observed_at) > new Date(scoped.observed_at),
    ),
  );
  assert(
    reused.length > 0,
    "Must observe auth after scoped operation on the same HTTP backend",
  );
  const pids = [...new Set(httpRows.map((row) => row.backend_pid))].sort();
  await mark(
    `HTTP_SQL_OBSERVATION current_user=session_user=cocinacore_runtime_rls backend_pids=${pids.join(",")} auth_rows=${authRows.length} scoped_rows=${scopedRows.length} same_backend_post_scope_auth=${reused.length}`,
  );
  const activity = (
    await admin.query(`select distinct usename from pg_stat_activity where datname=current_database()
    and pid<>pg_backend_pid() and backend_type='client backend'`)
  ).rows;
  assert(activity.length > 0);
  for (const row of activity)
    assert.equal(row.usename, "cocinacore_runtime_rls");
  await pass(
    "HTTP SECURITY INVOKER observations prove runtime current/session identity, transaction-local scope and reused pool context cleanup; activity has no ordinary superuser",
  );
  await mark(`ASSERTION_GROUPS=${assertions} FAILED=0 SKIPPED=0 RETRIES=0`);
}
