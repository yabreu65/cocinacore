#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runSmoke } from "./tests/m6-http-smoke/scenarios.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { Pool } = require("pg");
// Candidate identity is supplied from outside the script so this preflight cannot
// become self-referential when the script itself changes.
const expectedTreeInput = process.argv[2] ?? process.env.M6_EXPECTED_TREE;
if (!expectedTreeInput || !/^[0-9a-f]{40}$/i.test(expectedTreeInput)) {
  console.error(
    "M6_EXPECTED_TREE (or argv[2]) must be supplied as a 40-character hexadecimal git tree object.",
  );
  process.exit(2);
}
const expectedTree = expectedTreeInput.toLowerCase();
const runId = `m6-http-${Date.now()}-${randomBytes(4).toString("hex")}`;
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), `${runId}-`));
await fs.chmod(scratch, 0o700);
const evidence = await fs.mkdtemp(path.join(os.tmpdir(), `${runId}-results-`));
const secrets = Array.from({ length: 5 }, () =>
  randomBytes(32).toString("hex"),
);
const [adminPassword, runtimePassword, redisPassword, authSecret, providerKey] =
  secrets;
const containers = [];
let candidate, admin, runtime, provider;
let candidateOutput = "";
let passed = false;
const cleanEnv = {
  PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: os.homedir(),
  TMPDIR: scratch,
  LANG: "en_US.UTF-8",
  NEXT_TELEMETRY_DISABLED: "1",
  COCINACORE_SKIP_DOTENV: "1",
  COCINACORE_SEPARATED_DB_LANES_ENABLED: "false",
  NODE_OPTIONS: "--max-old-space-size=7168",
  ...(process.env.GIT_INDEX_FILE ? { GIT_INDEX_FILE: process.env.GIT_INDEX_FILE } : {}),
};
// Explicit local Unix socket; no remote Docker contexts or ambient credentials.
const dockerSocket = path.join(os.homedir(), ".docker/run/docker.sock");
const dockerArgs = ["--host", `unix://${dockerSocket}`];
function redact(value) {
  let result = String(value);
  for (const secret of secrets)
    result = result.replaceAll(secret, "[REDACTED]");
  return result
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/g, "[DATABASE_URL]")
    .replace(/redis:\/\/[^\s'"<>]+/g, "[REDIS_URL]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[SESSION_TOKEN]",
    );
}
async function mark(message) {
  const line = redact(message);
  console.log(line);
  await fs.appendFile(path.join(evidence, "results.log"), `${line}\n`, {
    mode: 0o600,
  });
}
async function command(
  binary,
  args,
  { input, env = cleanEnv, cwd = root, log, monitorDisk = false } = {},
) {
  const child = spawn(binary, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let diskFault;
  const monitor = monitorDisk
    ? setInterval(async () => {
        try {
          await assertFreeSpace();
        } catch (error) {
          diskFault = error;
          child.kill("SIGTERM");
        }
      }, 1000)
    : undefined;
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const [code, signal] = await once(child, "close");
  clearInterval(monitor);
  if (diskFault) throw diskFault;
  if (log)
    await fs.writeFile(path.join(evidence, log), redact(output), {
      mode: 0o600,
    });
  assert.equal(
    code,
    0,
    `${binary} failed code=${code} signal=${signal}; ${redact(output).slice(-3500)}`,
  );
  return output.trim();
}
const docker = (args, options) =>
  command("docker", [...dockerArgs, ...args], options);
async function assertFreeSpace() {
  const stats = await Promise.all([fs.statfs(root), fs.statfs(scratch)]);
  const bytes = Math.min(...stats.map((stat) => stat.bavail * stat.bsize));
  assert(
    bytes > 6 * 1024 ** 3,
    "Free disk must exceed 6 GiB on workspace and temporary filesystem",
  );
  return bytes;
}
async function freeSpace() {
  const bytes = await assertFreeSpace();
  await mark(`FREE_DISK_BYTES=${bytes} threshold=>6GiB`);
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  return port;
}
async function inventory() {
  return Promise.all([
    docker(["ps", "-aq", "--no-trunc"]),
    docker(["volume", "ls", "-q"]),
    docker(["network", "ls", "--format", "{{.ID}}"]),
  ]).then((rows) => rows.map((row) => row.split("\n").filter(Boolean).sort()));
}
let beforeInventory;
const indexPathValue = await command("git", ["rev-parse", "--git-path", "index"]);
const indexPath = path.isAbsolute(indexPathValue)
  ? indexPathValue
  : path.resolve(root, indexPathValue);
const indexBefore = await fs.readFile(indexPath);
const indexDigestBefore = createHash("sha256").update(indexBefore).digest("hex");
try {
  assert.equal(process.version, "v22.22.3");
  assert.equal(await command("git", ["write-tree"]), expectedTree);
  const stagedFilesOutput = await command("git", ["diff", "--cached", "--name-only", "-z"]);
  const stagedFiles = stagedFilesOutput ? stagedFilesOutput.split("\0").filter(Boolean) : [];
  const unstagedFilesOutput = await command("git", ["diff", "--name-only", "-z"]);
  const untrackedFilesOutput = await command("git", ["ls-files", "--others", "--exclude-standard", "-z"]);
  const unstagedFiles = unstagedFilesOutput
    ? unstagedFilesOutput.split("\0").filter(Boolean)
    : [];
  const untrackedFiles = untrackedFilesOutput
    ? untrackedFilesOutput.split("\0").filter(Boolean)
    : [];
  assert.equal(unstagedFiles.length, 0, "Candidate has unstaged tracked changes");
  assert.equal(untrackedFiles.length, 0, "Candidate has untracked files");
  const indexAfter = await fs.readFile(indexPath);
  assert.deepEqual(indexAfter, indexBefore, "Candidate index changed during preflight");
  assert.equal(
    createHash("sha256").update(indexAfter).digest("hex"),
    indexDigestBefore,
    "Candidate index digest changed during preflight",
  );
  await mark(
    `CANDIDATE_TREE=${expectedTree} STAGED_FILES=${stagedFiles.length} UNSTAGED_FILES=${unstagedFiles.length} UNTRACKED_FILES=${untrackedFiles.length} INDEX_SHA256=${indexDigestBefore} RETRIES=0 NODE_PARENT=${process.version}`,
  );
  beforeInventory = await inventory();
  await freeSpace();
  const memory = Number(await docker(["info", "--format", "{{.MemTotal}}"]));
  assert(memory > 6 * 1024 ** 3);
  await mark(`DOCKER_MEMORY_BYTES=${memory}`);
  for (const image of ["pgvector/pgvector:pg16", "redis:7-alpine"]) {
    const id = await docker(["image", "inspect", "--format", "{{.Id}}", image]);
    await mark(`LOCAL_IMAGE image=${image} id=${id} pull=never`);
  }

  // Rebuild from current sources in a private copy; never load repo .env files.
  const frontend = path.join(scratch, "frontend");
  await fs.cp(path.join(root, "frontend"), frontend, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(path.join(root, "frontend"), source);
      return !relative
        .split(path.sep)
        .some(
          (part) =>
            [
              "node_modules",
              ".next",
              "test-results",
              "playwright-report",
              "uploads",
              ".git",
            ].includes(part) ||
            part.startsWith(".env") ||
            part.endsWith(".tsbuildinfo"),
        );
    },
  });
  await mark(
    "DEPENDENCIES_COPY_START private copy; space checked every 128 entries",
  );
  await freeSpace();
  let entries = 0;
  await fs.cp(
    path.join(root, "frontend/node_modules"),
    path.join(frontend, "node_modules"),
    {
      recursive: true,
      filter: async () => {
        if (++entries % 128 === 0) await assertFreeSpace();
        return true;
      },
    },
  );
  await freeSpace();
  await mark(`DEPENDENCIES_COPY_PASS entries=${entries}`);
  await mark("BUILD_START fresh candidate source copy; no reused standalone");
  await command(
    process.execPath,
    [
      path.join(frontend, "node_modules/next/dist/bin/next"),
      "build",
      "--webpack",
    ],
    { cwd: frontend, log: "build.log", monitorDisk: true },
  );
  await mark("BUILD_PASS next build --webpack");
  await freeSpace();

  await fs.writeFile(
    path.join(scratch, "postgres.env"),
    `POSTGRES_PASSWORD=${adminPassword}\nPOSTGRES_DB=m6_smoke\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(scratch, "redis.conf"),
    `bind 0.0.0.0\nprotected-mode yes\nrequirepass ${redisPassword}\nsave ""\nappendonly no\n`,
    { mode: 0o600 },
  );
  for (const [kind, image, port, extra] of [
    [
      "pg",
      "pgvector/pgvector:pg16",
      "5432",
      [
        "--env-file",
        path.join(scratch, "postgres.env"),
        "--tmpfs",
        "/var/lib/postgresql/data:rw,nosuid,size=768m",
      ],
    ],
    [
      "redis",
      "redis:7-alpine",
      "6379",
      [
        "--tmpfs",
        "/data:rw,nosuid,size=128m",
        "--mount",
        `type=bind,src=${scratch}/redis.conf,dst=/smoke-redis.conf,readonly`,
      ],
    ],
  ]) {
    const name = `${runId}-${kind}`;
    containers.push(name); // arm cleanup before creation in case CLI output fails
    await docker([
      "run",
      "--pull=never",
      "-d",
      "--name",
      name,
      "--label",
      `com.cocinacore.m6-http=${runId}`,
      "-p",
      `127.0.0.1::${port}`,
      ...extra,
      image,
      ...(kind === "redis" ? ["redis-server", "/smoke-redis.conf"] : []),
    ]);
  }
  const portFor = async (name, port) => {
    const output = await docker(["port", name, `${port}/tcp`]);
    assert.match(output, /^127\.0\.0\.1:\d+$/);
    return Number(output.split(":")[1]);
  };
  const pgPort = await portFor(containers[0], 5432);
  const redisPort = await portFor(containers[1], 6379);
  for (let i = 0; i < 60; i++) {
    // Startup readiness polling only, not test retries.
    try {
      await docker([
        "exec",
        containers[0],
        "pg_isready",
        "-U",
        "postgres",
        "-d",
        "m6_smoke",
      ]);
      break;
    } catch {
      if (i === 59) throw new Error("Disposable PostgreSQL readiness timeout");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const adminUrl = `postgresql://postgres:${adminPassword}@127.0.0.1:${pgPort}/m6_smoke`;
  const runtimeUrl = `postgresql://cocinacore_runtime_rls:${runtimePassword}@127.0.0.1:${pgPort}/m6_smoke`;
  await command(
    process.execPath,
    [path.join(root, "frontend/scripts/run-migrations.js")],
    { env: { ...cleanEnv, DATABASE_URL: adminUrl }, log: "migrations.log" },
  );
  await command(
    process.execPath,
    [
      path.join(root, "frontend/scripts/run-migrations.js"),
      "--verify-complete",
    ],
    {
      env: { ...cleanEnv, DATABASE_URL: adminUrl },
      log: "migration-verify.log",
    },
  );
  await mark(
    "MIGRATIONS_PASS 001-019 separate provisioning identity=postgres disposable only",
  );
  await docker(
    [
      "exec",
      "-i",
      containers[0],
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "m6_smoke",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `\\set runtime_password '${runtimePassword}'\n${await fs.readFile(path.join(root, "scripts/provision-runtime-role.sql"), "utf8")}`,
      log: "provision.log",
    },
  );
  admin = new Pool({ connectionString: adminUrl, max: 1 });
  runtime = new Pool({ connectionString: runtimeUrl, max: 1 });
  assert.equal(
    (await admin.query("select count(*)::int as n from schema_migrations"))
      .rows[0].n,
    19,
  );
  await admin.query(
    await fs.readFile(
      path.join(root, "scripts/tests/m6-http-smoke/fixtures.sql"),
      "utf8",
    ),
  );
  await mark("PROVISION_PASS official SQL; fixture functions SECURITY INVOKER");

  const providerRequests = [];
  provider = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      assert.equal(req.method, "POST");
      assert(url.pathname.startsWith("/v1beta/models/"));
      providerRequests.push({ pathname: url.pathname, body }); // never retain URL query/API key
      const response = url.pathname.endsWith(":embedContent")
        ? { embedding: { values: Array(1536).fill(0.1) } }
        : {
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        kind: "explanation",
                        answer:
                          "Stir gently following the current recipe instruction.",
                        evidence: "partial",
                        citationIndexes: [],
                        limitations: ["Use the current recipe as reference."],
                      }),
                    },
                  ],
                },
              },
            ],
            modelVersion: "local-smoke-fixture",
          };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response));
    } catch {
      res.writeHead(500);
      res.end("{}");
    }
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const appPort = await freePort();
  const appEnv = {
    ...cleanEnv,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(appPort),
    DATABASE_URL: runtimeUrl,
    REDIS_URL: `redis://:${redisPassword}@127.0.0.1:${redisPort}/0`,
    AUTH_SECRET: authSecret,
    GEMINI_API_KEY: providerKey,
    GEMINI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1beta`,
    STORAGE_DRIVER: "local",
    LOCAL_UPLOAD_DIR: path.join(scratch, "uploads"),
    COCINACORE_E2E_CACHE_NAMESPACE: runId,
    COOKING_TEACHER_TIMEOUT_MS: "20000",
  };
  candidate = spawn(
    process.execPath,
    [
      "--require",
      path.join(root, "scripts/tests/m6-http-smoke/local-network.cjs"),
      path.join(frontend, ".next/standalone/server.js"),
    ],
    { cwd: frontend, env: appEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  candidate.stdout.on("data", (chunk) => {
    candidateOutput += chunk;
  });
  candidate.stderr.on("data", (chunk) => {
    candidateOutput += chunk;
  });
  const base = `http://127.0.0.1:${appPort}`;
  for (let i = 0; i < 120; i++) {
    assert.equal(candidate.exitCode, null, "Candidate exited during startup");
    try {
      const response = await fetch(`${base}/api/auth/session`);
      if (response.ok) break;
    } catch {
      /* bounded readiness polling */
    }
    if (i === 119) throw new Error("Candidate readiness timeout");
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.match(candidateOutput, /SMOKE_NODE_CHILD version=v22\.22\.3/);
  await mark(
    `HTTP_READY child_pid=${candidate.pid} NODE_CHILD=v22.22.3 ordinary_database_identity=cocinacore_runtime_rls`,
  );
  await runSmoke({ base, admin, runtime, mark, providerRequests });
  passed = true;
} catch (error) {
  await mark(`SMOKE_FAIL ${redact(error.stack ?? error)}`);
} finally {
  if (candidate && candidate.exitCode === null) {
    const exited = once(candidate, "exit");
    candidate.kill("SIGTERM");
    const timer = setTimeout(() => candidate.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
  await fs.writeFile(
    path.join(evidence, "candidate.log"),
    redact(candidateOutput),
    { mode: 0o600 },
  );
  await runtime?.end();
  await admin?.end();
  if (provider) await new Promise((resolve) => provider.close(resolve));
  let cleanupOk = true;
  for (const name of containers.reverse()) {
    try {
      const identity = await docker([
        "inspect",
        "--format",
        '{{index .Config.Labels "com.cocinacore.m6-http"}}',
        name,
      ]);
      assert.equal(identity, runId);
      await docker(["rm", "-fv", name]);
    } catch (error) {
      cleanupOk = false;
      await mark(`CLEANUP_FAIL ${error.message}`);
    }
  }
  try {
    if (beforeInventory !== undefined) {
      assert.deepEqual(await inventory(), beforeInventory);
      assert.deepEqual(
        await fs.readFile(
          await command("git", ["rev-parse", "--git-path", "index"]),
        ),
        indexBefore,
      );
    }
    await fs.rm(scratch, { recursive: true, force: true });
    await mark(
      beforeInventory === undefined
        ? "CLEANUP_PASS preflight failed before disposable runtime; scratch removed"
        : "CLEANUP_PASS owned processes/containers/tmpfs/secrets removed; Docker inventory unchanged; index byte-identical",
    );
  } catch (error) {
    cleanupOk = false;
    await mark(`CLEANUP_FAIL ${error.message}`);
  }
  await mark(
    `M6_HTTP_SMOKE=${passed && cleanupOk ? "PASS" : "FAIL"} RETRIES=0 EVIDENCE=${evidence}`,
  );
  process.exitCode = passed && cleanupOk ? 0 : 1;
}
