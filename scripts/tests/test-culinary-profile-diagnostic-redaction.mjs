#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const helperPath = path.join(root, 'scripts/lib/redact-diagnostic-stream.mjs');
const helperSource = existsSync(helperPath) ? readFileSync(helperPath, 'utf8') : '';
const inputBoundMatch = helperSource.match(/\bMAX_INPUT_BYTES\s*=\s*(\d+)\b/);
assert.ok(inputBoundMatch, 'diagnostic sanitizer must declare a finite MAX_INPUT_BYTES input bound');
const MAX_INPUT_BYTES = Number(inputBoundMatch[1]);
assert.ok(Number.isSafeInteger(MAX_INPUT_BYTES) && MAX_INPUT_BYTES > 0 && MAX_INPUT_BYTES < 8 * 1024 * 1024,
  'diagnostic sanitizer input bound must be finite and below the oversized fixture');

const fixtures = [
  {
    name: 'PostgreSQL logs',
    input: '2026-01-02 03:04:05 UTC [1] LOG: database system is ready to accept connections\n',
    survives: ['database system is ready to accept connections'],
  },
  {
    name: 'Redis logs',
    input: '1:M 02 Jan 2026 03:04:05.000 * Ready to accept connections\n',
    survives: ['Ready to accept connections'],
  },
  {
    name: 'credentials and URLs',
    input: [
      'password=fixture-password-value token=fixture-token-value secret=fixture-secret-value',
      'api_key=fixture-api-key-value DATABASE_URL=fixture-database-url-value REDIS_URL=fixture-redis-url-value',
    ].join('\n'),
    redactions: 6,
  },
  {
    name: 'PostgreSQL/Redis URI credentials',
    input: 'postgresql://fixture-pg-user:fixture-pg-password@127.0.0.1/db redis://:fixture-redis-password@127.0.0.1/0\n',
    redactions: 2,
    survives: ['127.0.0.1/db', '127.0.0.1/0'],
  },
  {
    name: 'regex-special credential characters',
    input: 'password=fixture-[a](b).*+$^?\\value, retained=yes\n',
    redactions: 1,
    survives: ['retained=yes'],
  },
  {
    name: 'case-insensitive labels and colon separators',
    input: 'PaSsWoRd: fixture-password-colon TOKEN:fixture-token-colon Api-Key=fixture-api-colon\nDATABASE_URL:fixture-db-colon; REDIS_URL=fixture-redis-colon\n',
    redactions: 5,
  },
  { name: 'empty input', input: '', empty: true },
  { name: 'bounded output', input: 'ordinary diagnostic line\n'.repeat(50000), truncated: true },
  {
    name: 'bounded input',
    input: 'ordinary diagnostic input\n'.repeat(Math.ceil((8 * 1024 * 1024) / 27)),
    inputTruncated: true,
  },
];

function invoke(input) {
  assert.ok(existsSync(helperPath), 'diagnostic sanitizer helper must exist');
  const result = spawnSync(process.execPath, [helperPath], {
    cwd: root,
    input,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `diagnostic sanitizer exited ${result.status ?? 'without status'}; stderr: ${String(result.stderr ?? '').slice(0, 500)}`);
  return result.stdout;
}

for (const fixture of fixtures) {
  const output = invoke(fixture.input);
  if (fixture.empty) {
    assert.equal(output, '', `${fixture.name} output must remain empty`);
    continue;
  }
  if (fixture.truncated) {
    assert.ok(Buffer.byteLength(output, 'utf8') <= 1024 * 1024, 'sanitizer output must stay within its byte limit');
    assert.ok(output.includes('[diagnostic output truncated at 1048576 bytes]'), 'truncated output must carry an explicit notice');
    continue;
  }
  if (fixture.inputTruncated) {
    assert.ok(Buffer.byteLength(fixture.input, 'utf8') > MAX_INPUT_BYTES,
      'input-bound fixture must exceed the declared sanitizer limit');
    assert.ok(output.includes(`[diagnostic input truncated at ${MAX_INPUT_BYTES} bytes]`),
      'oversized input must carry an explicit input truncation notice');
    assert.ok(Buffer.byteLength(output, 'utf8') <= 1024 * 1024,
      'oversized input must also remain within the output byte limit');
    continue;
  }
  for (const text of fixture.survives ?? []) {
    assert.ok(output.includes(text), `${fixture.name}: expected non-sensitive diagnostic text to survive`);
  }
  for (const value of fixture.input.match(/fixture-[^\s,;]+/g) ?? []) {
    assert.ok(!output.includes(value), `${fixture.name}: sensitive fixture value was not redacted`);
  }
  if (fixture.redactions !== undefined) {
    assert.equal((output.match(/\[REDACTED\]/g) ?? []).length, fixture.redactions, `${fixture.name}: expected redaction markers`);
  }
}

const EVENT_TIMEOUT_MS = 2000;

function startSanitizer(args = []) {
  assert.ok(existsSync(helperPath), 'diagnostic sanitizer helper must exist');
  const child = spawn(process.execPath, [helperPath, ...args], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, exited, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

async function waitBounded(promise, description, timeoutMs = EVENT_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${description} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assertGracefulStream(name, input, expected = []) {
  const run = startSanitizer();
  run.child.stdin.end(input);
  const outcome = await waitBounded(run.exited, `${name} sanitizer exit`);
  assert.deepEqual(outcome, { code: 0, signal: null }, `${name}: EOF must exit successfully`);
  for (const text of expected) assert.ok(run.stdout.includes(text), `${name}: expected ${JSON.stringify(text)} in output`);
  assert.ok(!run.stderr.includes('LOG_SANITIZATION_FAILED'), `${name}: graceful EOF must not become LOG_SANITIZATION_FAILED`);
  return run.stdout;
}

// These subprocess fixtures exercise the real sanitizer with a producer that closes stdin.
await assertGracefulStream('producer closes stdin at EOF', 'ordinary diagnostic\n', ['ordinary diagnostic']);
assert.equal(await assertGracefulStream('empty subprocess input', ''), '');
assert.equal(await assertGracefulStream('partial line at graceful EOF', 'partial diagnostic without newline'), 'partial diagnostic without newline');

// A named FIFO must use the explicit file-stream input mode: process.stdin under shell FIFO
// redirection on this host receives data but does not emit EOF after the writer closes.
{
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'culinary-redaction-fifo.'));
  const fifoPath = path.join(fixtureDir, 'events.fifo');
  const secret = 'fixture-fifo-docker-password';
  let sanitizer;
  let writer;
  try {
    execFileSync('mkfifo', [fifoPath]);
    sanitizer = startSanitizer(['--input-file', fifoPath]);
    sanitizer.child.stdin.end();
    const startup = await Promise.race([
      sanitizer.exited.then((outcome) => ({ exited: outcome })),
      new Promise((resolve) => setTimeout(() => resolve({ waitingForFifo: true }), 100)),
    ]);
    assert.deepEqual(startup, { waitingForFifo: true }, 'named FIFO mode must open the supplied path instead of consuming stdin');
    writer = spawn(process.execPath, ['-e', `
      const fs = require('node:fs');
      const fifo = process.argv[1];
      const timeout = setTimeout(() => process.exit(2), 3000);
      const stream = fs.createWriteStream(fifo);
      stream.once('open', () => clearTimeout(timeout));
      stream.end(${JSON.stringify(`{"Type":"container","Actor":{"Attributes":{"password":"${secret}"}}}\n`)});
    `, fifoPath], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let writerStderr = '';
    writer.stderr.setEncoding('utf8');
    writer.stderr.on('data', (chunk) => { writerStderr += chunk; });
    const writerOutcome = await waitBounded(new Promise((resolve) => {
      writer.once('close', (code, signal) => resolve({ code, signal }));
    }), 'named FIFO producer exit', 4000);
    assert.deepEqual(writerOutcome, { code: 0, signal: null }, `named FIFO producer failed: ${writerStderr.slice(0, 300)}`);
    const sanitizerOutcome = await waitBounded(sanitizer.exited, 'named FIFO sanitizer exit');
    assert.deepEqual(sanitizerOutcome, { code: 0, signal: null }, `named FIFO sanitizer did not exit cleanly: ${sanitizer.stderr.slice(0, 300)}`);
    assert.ok(sanitizer.stdout.includes('"password":"[REDACTED]"'), 'named FIFO JSON password must be redacted');
    assert.ok(!sanitizer.stdout.includes(secret), 'named FIFO event secret must not survive');
  } finally {
    if (writer && writer.exitCode === null && writer.signalCode === null) writer.kill('SIGKILL');
    if (sanitizer && sanitizer.child.exitCode === null && sanitizer.child.signalCode === null) sanitizer.child.kill('SIGKILL');
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

const eventOutput = await assertGracefulStream('PostgreSQL, Redis, and Docker event stream', [
  '2026-01-02 03:04:05 UTC [1] LOG: database system is ready; password=fixture-pg-event-secret\n',
  '1:M 02 Jan 2026 03:04:05.000 * Ready to accept connections token=fixture-redis-event-token\n',
  '{"Type":"container","Action":"start","Actor":{"Attributes":{"password":"fixture-docker-event-password","api_key":"fixture-docker-event-key"}}} password=fixture-docker-event-equals-password\n',
  'postgresql://fixture-event-user:fixture-event-password@127.0.0.1/db redis://:fixture-event-redis-password@127.0.0.1/0',
].join(''), ['database system is ready', 'Ready to accept connections', '"Action":"start"']);
for (const secret of [
  'fixture-pg-event-secret', 'fixture-redis-event-token', 'fixture-docker-event-password',
  'fixture-docker-event-key', 'fixture-docker-event-equals-password', 'fixture-event-user:fixture-event-password', 'fixture-event-redis-password',
]) {
  assert.ok(!eventOutput.includes(secret), `event stream leaked sensitive fixture value ${secret}`);
}

async function assertSignalOutcome(signal) {
  const run = startSanitizer();
  // Keeping stdin open leaves the real sanitizer waiting for the producer.
  await waitBounded(new Promise((resolve, reject) => {
    if (run.child.pid) resolve();
    else {
      run.child.once('spawn', resolve);
      run.child.once('error', reject);
    }
  }), `${signal} sanitizer spawn`);
  assert.equal(run.child.kill(signal), true, `${signal}: signal should be delivered to the live sanitizer`);
  const outcome = await waitBounded(run.exited, `${signal} sanitizer termination`);
  assert.deepEqual(outcome, { code: null, signal }, `${signal}: termination must remain distinguishable from a normal exit`);
  assert.ok(!run.stderr.includes('LOG_SANITIZATION_FAILED'), `${signal}: signal termination must not be reported as sanitizer failure`);
}

await assertSignalOutcome('SIGTERM');
await assertSignalOutcome('SIGKILL');

// An open producer exercises the timeout boundary against the real sanitizer.
// The fixture's explicit SIGTERM is the deterministic timeout outcome; KILL escalation
// is exercised through the runner's exact sourceable lifecycle helper fixture.
{
  const run = startSanitizer();
  await waitBounded(new Promise((resolve, reject) => {
    if (run.child.pid) resolve();
    else {
      run.child.once('spawn', resolve);
      run.child.once('error', reject);
    }
  }), 'timeout fixture sanitizer spawn');
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; }, 50);
  await new Promise((resolve) => setTimeout(resolve, 60));
  clearTimeout(timeout);
  assert.equal(timedOut, true, 'open producer must reach the bounded timeout');
  assert.equal(run.child.kill('SIGTERM'), true, 'timeout must attempt graceful SIGTERM');
  const outcome = await waitBounded(run.exited, 'timeout sanitizer termination');
  assert.deepEqual(outcome, { code: null, signal: 'SIGTERM' }, 'real sanitizer timeout must report SIGTERM distinctly');
  assert.ok(!run.stderr.includes('LOG_SANITIZATION_FAILED'), 'timeout termination must not be silently converted to LOG_SANITIZATION_FAILED');
}

console.log(`diagnostic redaction fixtures passed (${fixtures.length} synchronous cases and 7 subprocess cases)`);
