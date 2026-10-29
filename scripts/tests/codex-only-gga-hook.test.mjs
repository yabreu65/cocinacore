import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const wrapperPath = path.join(
  repositoryRoot,
  ".githooks",
  "gga-codex-pre-commit",
);

const currentCandidate = () => ({
  head: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim(),
  branch: execFileSync("git", ["branch", "--show-current"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim(),
  tree: execFileSync("git", ["write-tree"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim(),
});

const runWrapper = async ({
  exitCode,
  attempts,
  authorized = true,
  consumed = false,
}) => {
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
  if (authorized) {
    const candidate = currentCandidate();
    await writeFile(
      ledgerPath,
      `${new Date().toISOString()} cycle=test provider=codex authorized_attempts=1 timeout=600 status=AUTHORIZED head=${candidate.head} branch=${candidate.branch} tree=${candidate.tree} staged_files=6\n`,
      "utf8",
    );
    if (consumed) {
      await writeFile(
        ledgerPath,
        `${await readFile(ledgerPath, "utf8")}2026-01-01T00:00:00Z provider=codex attempt=1 result=FAIL head=${candidate.head} branch=${candidate.branch}\n`,
        "utf8",
      );
    }
  }
  const environment = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    GGA_CODEX_LEDGER: ledgerPath,
    GGA_FAKE_EXIT: String(exitCode),
    GGA_LOG: logPath,
  };
  if (attempts === undefined) delete environment.GGA_CODEX_ATTEMPTS;
  else environment.GGA_CODEX_ATTEMPTS = String(attempts);
  const result = await new Promise((resolve) => {
    const child = spawn(wrapperPath, [], {
      cwd: repositoryRoot,
      env: environment,
      stdio: "ignore",
    });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  const log = await readFile(logPath, "utf8").catch(() => "");
  const ledger = await readFile(ledgerPath, "utf8").catch(() => "");
  await rm(directory, { recursive: true, force: true });
  return { result, log, ledger };
};

test("Codex-only wrapper never contains or invokes OpenCode", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.doesNotMatch(source, /opencode/i);
  assert.match(source, /GGA_PROVIDER=codex/);
  assert.match(source, /gga run --no-cache/);
});

test("missing attempt override defaults to one authorized PASS attempt", async () => {
  const { result, log, ledger } = await runWrapper({
    exitCode: 0,
  });
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.match(log, /^codex\|600\|run --no-cache\n$/);
  assert.match(ledger, /provider=codex attempt=1 result=PASS/);
});

test("GGA_CODEX_ATTEMPTS=1 is accepted and failure never retries", async () => {
  const { result, log, ledger } = await runWrapper({
    exitCode: 1,
    attempts: 1,
  });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(log.trim().split("\n").length, 1);
  assert.match(ledger, /provider=codex attempt=1 result=FAIL/);
});

test("a timeout-like provider failure never retries", async () => {
  const { result, log, ledger } = await runWrapper({ exitCode: 124 });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(log.trim().split("\n").length, 1);
  assert.match(ledger, /provider=codex attempt=1 result=FAIL/);
});

test("authorization remains append-only before the attempt result", async () => {
  const { result, ledger } = await runWrapper({ exitCode: 0 });
  assert.equal(result.code, 0);
  const lines = ledger.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /status=AUTHORIZED/);
  assert.match(lines[1], /provider=codex attempt=1 result=PASS/);
});

test("missing authorization fails closed before invoking GGA", async () => {
  const { result, log } = await runWrapper({ exitCode: 0, authorized: false });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(log, "");
});

test("a consumed authorization fails closed before invoking GGA", async () => {
  const { result, log } = await runWrapper({ exitCode: 0, consumed: true });
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(log, "");
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
        GGA_TIMEOUT: "601",
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

test("Codex invocation inherits CLI model and reasoning without local overrides", async () => {
  const source = await readFile(wrapperPath, "utf8");
  assert.doesNotMatch(source, /gpt-5\.6-luna|model_reasoning_effort|medium/);
  assert.doesNotMatch(source, /\.githooks\/bin|COCINACORE_CODEX_EXECUTABLE/);
  await assert.rejects(
    readFile(path.join(repositoryRoot, ".githooks", "bin", "codex")),
  );
});

test("zero, two, negative, and non-numeric budgets fail closed", async () => {
  for (const attempts of ["0", "2", "-1", "invalid"]) {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "cocina-codex-gga-budget-"),
    );
    const ledgerPath = path.join(directory, "ledger.log");
    const logPath = path.join(directory, "gga.log");
    const fakeBin = path.join(directory, "bin");
    await (await import("node:fs/promises")).mkdir(fakeBin);
    const fakeGga = path.join(fakeBin, "gga");
    await writeFile(
      fakeGga,
      '#!/bin/sh\nprintf invoked >> "$GGA_LOG"\n',
      "utf8",
    );
    await chmod(fakeGga, 0o755);
    const result = await new Promise((resolve) => {
      const child = spawn(wrapperPath, [], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          GGA_CODEX_ATTEMPTS: attempts,
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
  }
});
