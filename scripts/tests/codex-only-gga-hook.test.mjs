import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const wrapperPath = path.join(
  repositoryRoot,
  ".githooks",
  "gga-codex-pre-commit",
);

const runWrapper = async ({ exitCode, attempts }) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cocina-codex-gga-hook-"),
  );
  const fakeBin = path.join(directory, "bin");
  const logPath = path.join(directory, "gga.log");
  const ledgerPath = path.join(directory, "ledger.log");
  await (await import("node:fs/promises")).mkdir(fakeBin);
  const fakeGga = path.join(fakeBin, "gga");
  await writeFile(
    fakeGga,
    '#!/bin/sh\nprintf \'%s|%s|%s\n\' "$GGA_PROVIDER" "$GGA_TIMEOUT" "$*" >> "$GGA_LOG"\nexit "$GGA_FAKE_EXIT"\n',
    "utf8",
  );
  await chmod(fakeGga, 0o755);
  const result = await new Promise((resolve) => {
    const child = spawn(wrapperPath, [], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        GGA_CODEX_ATTEMPTS: String(attempts),
        GGA_CODEX_LEDGER: ledgerPath,
        GGA_FAKE_EXIT: String(exitCode),
        GGA_LOG: logPath,
      },
      stdio: "ignore",
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  const log = await readFile(logPath, "utf8");
  const ledger = await readFile(ledgerPath, "utf8");
  await rm(directory, { recursive: true, force: true });
  return { result, log, ledger };
};

test("Codex-only wrapper never contains or invokes OpenCode", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.doesNotMatch(source, /opencode/i);
  assert.match(source, /GGA_PROVIDER=codex/);
  assert.match(source, /gga run --no-cache/);
});

test("successful Codex review records one PASS attempt", async () => {
  const { result, log, ledger } = await runWrapper({
    exitCode: 0,
    attempts: 1,
  });
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(log, /^codex\|300\|run --no-cache\n$/);
  assert.match(ledger, /provider=codex attempt=1 result=PASS/);
});

test("Codex failure fails closed and records every bounded attempt", async () => {
  const { result, log, ledger } = await runWrapper({
    exitCode: 1,
    attempts: 2,
  });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(log.trim().split("\n").length, 2);
  assert.match(ledger, /provider=codex attempt=1 result=FAIL/);
  assert.match(ledger, /provider=codex attempt=2 result=FAIL/);
});

test("timeout above the parent-safe limit fails before invoking GGA", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cocina-codex-gga-timeout-"),
  );
  const ledgerPath = path.join(directory, "ledger.log");
  const logPath = path.join(directory, "gga.log");
  const fakeBin = path.join(directory, "bin");
  await (await import("node:fs/promises")).mkdir(fakeBin);
  const fakeGga = path.join(fakeBin, "gga");
  await writeFile(fakeGga, '#!/bin/sh\nprintf invoked >> "$GGA_LOG"\n', "utf8");
  await chmod(fakeGga, 0o755);
  const result = await new Promise((resolve) => {
    const child = spawn(wrapperPath, [], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        GGA_TIMEOUT: "301",
        GGA_CODEX_LEDGER: ledgerPath,
        GGA_LOG: logPath,
      },
      stdio: "ignore",
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  await assert.rejects(readFile(logPath, "utf8"));
  await rm(directory, { recursive: true, force: true });
});

test("local Codex shim pins model and medium reasoning without invoking a provider", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cocina-codex-shim-"));
  const fakeCodex = path.join(directory, "real-codex");
  const argsPath = path.join(directory, "args.log");
  await writeFile(
    fakeCodex,
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$COCINA_ARGS_LOG"\n',
    "utf8",
  );
  await chmod(fakeCodex, 0o755);
  const result = spawnSync(
    path.join(repositoryRoot, ".githooks", "bin", "codex"),
    ["exec", "--output-last-message", "/tmp/last-message", "-"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        COCINACORE_CODEX_EXECUTABLE: fakeCodex,
        COCINA_ARGS_LOG: argsPath,
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const args = (await readFile(argsPath, "utf8")).trim().split("\n");
  assert.deepEqual(args.slice(0, 6), [
    "exec",
    "-m",
    "gpt-5.6-luna",
    "-c",
    'model_reasoning_effort="medium"',
    "--output-last-message",
  ]);
  await rm(directory, { recursive: true, force: true });
});

test("invalid attempt budgets fail before invoking the provider", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "cocina-codex-gga-budget-"),
  );
  const ledgerPath = path.join(directory, "ledger.log");
  const result = await new Promise((resolve) => {
    const child = spawn(wrapperPath, [], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        GGA_CODEX_ATTEMPTS: "3",
        GGA_CODEX_LEDGER: ledgerPath,
      },
      stdio: "ignore",
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  await assert.rejects(readFile(ledgerPath, "utf8"));
  await rm(directory, { recursive: true, force: true });
});
