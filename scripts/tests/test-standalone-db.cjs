// Run only in a disposable Compose project; this probe creates synthetic accounts and inventory.
if (process.env.CC_STANDALONE_DISPOSABLE_TEST !== "true")
  throw Error("Explicit disposable test flag required");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Client } = require("pg");
const lanes = {
  DATABASE_URL: "cocinacore_runtime_rls",
  AUTH_DATABASE_URL: "cocinacore_auth",
  OWNER_METRICS_DATABASE_URL: "cocinacore_owner_metrics",
  OWNER_GLOBAL_WRITER_DATABASE_URL: "cocinacore_global_writer",
};
const clients = {};
async function deny(c, sql, args = []) {
  try {
    await c.query(sql, args);
    assert.fail("unexpected privilege");
  } catch (e) {
    assert.equal(e.code, "42501");
  }
}
async function context(c, row, fn) {
  await c.query("BEGIN");
  try {
    await c.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
      [row.tenant_id, row.user_id],
    );
    await fn();
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
async function main() {
  for (const [key, role] of Object.entries(lanes)) {
    const url = new URL(process.env[key]);
    assert.equal(url.hostname, "postgres");
    assert.equal(url.pathname, "/cocinacore");
    assert.equal(url.username, role);
    const c = (clients[key] = new Client({ connectionString: url.href }));
    await c.connect();
    const {
      rows: [x],
    } = await c.query(
      "select current_user AS role,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user",
    );
    assert.deepEqual(x, {
      role,
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  }
  console.log("FOUR_RESTRICTED_LANES PASS");
  const rt = clients.DATABASE_URL,
    auth = clients.AUTH_DATABASE_URL,
    metrics = clients.OWNER_METRICS_DATABASE_URL,
    writer = clients.OWNER_GLOBAL_WRITER_DATABASE_URL;
  const signup =
    "select user_id,tenant_id from public.signup_new_account($1,$2,$3,now(),$4)";
  const id = randomUUID();
  const a = (
      await auth.query(signup, [
        `f53-a-${id}@example.invalid`,
        "synthetic-hash",
        "A",
        "v1",
      ])
    ).rows[0],
    b = (
      await auth.query(signup, [
        `f53-b-${id}@example.invalid`,
        "synthetic-hash",
        "B",
        "v1",
      ])
    ).rows[0];
  assert.notEqual(a.tenant_id, b.tenant_id);
  const insert =
    "insert into public.recipe_inventory_items(tenant_id,user_id,ingredient_name) values($1,$2,$3) returning id";
  let itemA, itemB;
  await context(rt, a, async () => {
    itemA = (
      await rt.query(insert, [a.tenant_id, a.user_id, "F53 synthetic A"])
    ).rows[0].id;
  });
  await context(rt, b, async () => {
    itemB = (
      await rt.query(insert, [b.tenant_id, b.user_id, "F53 synthetic B"])
    ).rows[0].id;
  });
  await context(rt, a, async () => {
    assert.equal(
      (
        await rt.query(
          "select id from public.recipe_inventory_items where id=$1",
          [itemA],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await rt.query(
          "select id from public.recipe_inventory_items where id=$1",
          [itemB],
        )
      ).rowCount,
      0,
    );
  });
  await context(rt, b, async () => {
    assert.equal(
      (
        await rt.query(
          "select id from public.recipe_inventory_items where id=$1",
          [itemB],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await rt.query(
          "select id from public.recipe_inventory_items where id=$1",
          [itemA],
        )
      ).rowCount,
      0,
    );
  });
  assert.equal(
    (
      await rt.query(
        "select id from public.recipe_inventory_items where id=any($1::uuid[])",
        [[itemA, itemB]],
      )
    ).rowCount,
    0,
  );
  await rt.query("BEGIN");
  try {
    await rt.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
      [a.tenant_id, a.user_id],
    );
    await deny(rt, insert, [b.tenant_id, b.user_id, "F53 denied"]);
  } finally {
    await rt.query("ROLLBACK");
  }
  await deny(rt, "set role postgres");
  await deny(auth, "insert into public.tenants(name) values($1)", [
    "F53 denied",
  ]);
  await deny(rt, signup, [
    `denied-${id}@example.invalid`,
    "hash",
    "Denied",
    "v1",
  ]);
  await deny(metrics, "select password_hash from public.users");
  await deny(writer, "select password_hash from public.users");
  assert.equal(
    (
      await metrics.query(
        "select tenants,users from public.owner_global_metrics",
      )
    ).rowCount,
    1,
  );
  console.log("RLS_OWN_AND_CROSS_TENANT_READ_WRITE PASS");
  console.log("AUTH_METRICS_WRITER_PRIVILEGE_BOUNDARIES PASS");
}
main()
  .catch((e) => {
    console.error("FAIL", e.code || e.name, e.message.slice(0, 140));
    process.exitCode = 1;
  })
  .finally(() => Promise.all(Object.values(clients).map((c) => c.end())));
