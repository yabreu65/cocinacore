import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runQualityGate, runTests } from '../cocina-quality-gate.mjs';

const root = '/repo';
const guardianPath = path.join(root, '.githooks', 'gga-codex-pre-commit');
const nvmrc = '22.22.3\n';
const validReportData = {
  success: true,
  numTotalTestSuites: 2,
  numPassedTestSuites: 2,
  numFailedTestSuites: 0,
  numPendingTestSuites: 0,
  numTotalTests: 3,
  numPassedTests: 3,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [{ assertionResults: [
    { status: 'passed' }, { status: 'passed' }, { status: 'passed' },
  ] }],
};
const validReport = JSON.stringify(validReportData);

function harness({ version = 'v22.22.3', testResult = { status: 0 }, report = validReport, guardianResult = { status: 0 }, hookExists = true } = {}) {
  const files = new Map([
    [path.join(root, '.nvmrc'), nvmrc],
    [guardianPath, '#!/bin/sh\nGGA_PROVIDER=codex gga run --no-cache\n'],
  ]);
  const calls = [];
  const reports = new Map();
  let reportCounter = 0;
  const fsApi = {
    readFileSync(file) {
      if (!files.has(file)) throw new Error(`missing file: ${file}`);
      return files.get(file);
    },
    mkdtempSync(prefix) { return `${prefix}${++reportCounter}`; },
    writeFileSync(file, contents) { reports.set(file, contents); files.set(file, contents); },
    rmSync() {},
    existsSync(file) { return hookExists && file === guardianPath; },
    accessSync(file) {
      if (!hookExists || file !== guardianPath) throw new Error('not executable');
    },
    realpathSync(file) { return file; },
  };
  const spawnSync = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === guardianPath) return guardianResult;
    if (command === process.execPath) {
      if (testResult.onSpawn) return testResult.onSpawn({ args, options, reports });
      if (report !== null) {
        const reportArgument = args.find((argument) => argument.startsWith('--outputFile='));
        const reportPath = reportArgument?.slice('--outputFile='.length);
        if (reportPath) {
          reports.set(reportPath, report);
          files.set(reportPath, report);
        }
      }
      return testResult;
    }
    throw new Error(`unexpected process: ${command}`);
  };
  return {
    calls,
    reports,
    options: {
      cwd: root,
      processInfo: { version, execPath: process.execPath },
      fsApi,
      pathApi: path,
      osApi: { tmpdir: () => '/tmp' },
      spawnSync,
    },
  };
}

const guardianCalls = (h) => h.calls.filter((call) => call.command === guardianPath).length;

test('Vitest-only stage passes without authorizing or invoking Guardian', () => {
  const h = harness();
  const result = runTests({ ...h.options, spawn: h.options.spawnSync });
  assert.deepEqual(result, {
    testStatus: 'TEST_PASS',
    guardianStatus: null,
    allowed: false,
    reason: null,
  });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].command, process.execPath);
  assert.equal(h.calls[0].args.includes('run'), true);
  assert.equal(guardianCalls(h), 0);
});

test('valid local Vitest report then Guardian success allows', async () => {
  const h = harness();
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'TEST_PASS');
  assert.equal(result.guardianStatus, 'GUARDIAN_PASS');
  assert.equal(result.allowed, true);
  const vitest = h.calls.find((call) => call.command === process.execPath);
  assert.ok(vitest);
  assert.equal(vitest.args.includes('--passWithNoTests'), true);
  assert.equal(vitest.args.includes('--reporter=json'), true);
  assert.equal(guardianCalls(h), 1);
});

test('Vitest assertion failures block Guardian as TEST_FAIL', async () => {
  const h = harness({
    testResult: { status: 1 },
    report: JSON.stringify({
      ...validReportData,
      success: false,
      numTotalTestSuites: 1,
      numPassedTestSuites: 0,
      numFailedTestSuites: 1,
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      testResults: [{ assertionResults: [{ status: 'passed' }, { status: 'failed' }] }],
    }),
  });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'TEST_FAIL');
  assert.equal(result.allowed, false);
  assert.equal(guardianCalls(h), 0);
});

test('runner startup failure without report is INFRA_UNAVAILABLE and blocks Guardian', async () => {
  const h = harness({ testResult: { status: null, error: Object.assign(new Error('ERR_REQUIRE_ESM'), { code: 'ERR_REQUIRE_ESM' }) }, report: null });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(result.allowed, false);
  assert.equal(guardianCalls(h), 0);
});

test('Node version mismatch is INFRA_UNAVAILABLE without starting children', async () => {
  const h = harness({ version: 'v20.0.0' });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(result.guardianStatus, null);
  assert.equal(h.calls.length, 0);
});

test('test runner timeout is INFRA_UNAVAILABLE and blocks Guardian', async () => {
  const h = harness({ testResult: { status: null, signal: 'SIGTERM', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) } });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(guardianCalls(h), 0);
});

test('test runner interruption is INFRA_UNAVAILABLE and blocks Guardian', async () => {
  const h = harness({ testResult: { status: null, signal: 'SIGINT' } });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(guardianCalls(h), 0);
});

test('zero collected tests is INFRA_UNAVAILABLE and blocks Guardian', async () => {
  const h = harness({ report: JSON.stringify({
    ...validReportData,
    numTotalTestSuites: 0,
    numPassedTestSuites: 0,
    numTotalTests: 0,
    numPassedTests: 0,
    testResults: [{ assertionResults: [] }],
  }) });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(guardianCalls(h), 0);
});

test('missing report is INFRA_UNAVAILABLE and blocks Guardian', async () => {
  const h = harness({ report: null });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(guardianCalls(h), 0);
});

test('malformed JSON report is INFRA_UNAVAILABLE and blocks Guardian', async () => {
  const h = harness({ report: '{not valid JSON' });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(result.allowed, false);
  assert.equal(guardianCalls(h), 0);
});

test('each runner invocation gets a fresh report path and cannot reuse stale output', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cocina-quality-gate-test-'));
  const cwd = path.join(temporaryRoot, 'repo');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, '.nvmrc'), nvmrc);
  const reportPaths = [];
  let runnerInvocations = 0;
  const calls = [];
  const fsApi = {
    readFileSync: (...args) => fs.readFileSync(...args),
    mkdtempSync: (...args) => fs.mkdtempSync(...args),
    writeFileSync: (...args) => fs.writeFileSync(...args),
    rmSync: (...args) => fs.rmSync(...args),
    existsSync: (file) => file.endsWith('/.githooks/gga-codex-pre-commit'),
    accessSync: () => {},
    realpathSync: (file) => file,
  };
  const options = {
    cwd,
    processInfo: { version: 'v22.22.3', execPath: process.execPath },
    fsApi,
    pathApi: path,
    osApi: { tmpdir: () => temporaryRoot },
    spawnSync: (command, args, spawnOptions) => {
      calls.push({ command, args, options: spawnOptions });
      if (command === path.join(cwd, '.githooks', 'gga-codex-pre-commit')) return { status: 0 };
      if (command !== process.execPath) throw new Error(`unexpected process: ${command}`);
      runnerInvocations += 1;
      const reportArgument = args.find((argument) => argument.startsWith('--outputFile='));
      const reportPath = reportArgument?.slice('--outputFile='.length);
      assert.ok(reportPath);
      reportPaths.push(reportPath);
      if (runnerInvocations === 1) fs.writeFileSync(reportPath, validReport);
      return { status: 0 };
    },
  };

  try {
    const firstResult = await runQualityGate(options);
    const secondResult = await runQualityGate(options);
    const vitestCalls = calls.filter((call) => call.command === process.execPath);
    assert.equal(firstResult.testStatus, 'TEST_PASS');
    assert.equal(secondResult.testStatus, 'INFRA_UNAVAILABLE');
    assert.equal(reportPaths.length, 2);
    assert.notEqual(reportPaths[0], reportPaths[1]);
    assert.equal(vitestCalls[0].command, process.execPath);
    assert.equal(vitestCalls[0].args.includes('run'), true);
    assert.equal(vitestCalls[0].args.includes('--reporter=json'), true);
    assert.equal(vitestCalls[0].args.includes('--passWithNoTests'), true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('Guardian nonzero exit fails closed after TEST_PASS', async () => {
  const h = harness({ guardianResult: { status: 7 } });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'TEST_PASS');
  assert.equal(result.guardianStatus, 'GUARDIAN_FAIL');
  assert.equal(result.allowed, false);
});

test('missing Guardian hook fails closed after TEST_PASS', async () => {
  const h = harness({ hookExists: false });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'TEST_PASS');
  assert.equal(result.guardianStatus, 'GUARDIAN_FAIL');
  assert.equal(result.allowed, false);
  assert.equal(guardianCalls(h), 0);
});

function reportWith(changes = {}) {
  return JSON.stringify({ ...validReportData, ...changes });
}

const rejectedReports = [
  ['zero passed assertions', reportWith({ numPassedTests: 0, numPendingTests: 3, numTodoTests: 0, testResults: [{ assertionResults: [
    { status: 'skipped' }, { status: 'pending' }, { status: 'disabled' },
  ] }] })],
  ['inconsistent suite arithmetic', reportWith({ numTotalTestSuites: 3 })],
  ['inconsistent test arithmetic', reportWith({ numPendingTests: 1 })],
  ['negative count', reportWith({ numPassedTests: -1 })],
  ['missing count', JSON.stringify(Object.fromEntries(Object.entries(validReportData).filter(([key]) => key !== 'numTodoTests')))],
  ['assertion summary mismatch', reportWith({ numPassedTests: 2 })],
  ['unknown assertion status', reportWith({ testResults: [{ assertionResults: [
    { status: 'passed' }, { status: 'passed' }, { status: 'passed' }, { status: 'mystery' },
  ] }] })],
  ['missing assertion status', reportWith({ testResults: [{ assertionResults: [
    { status: 'passed' }, { status: 'passed' }, {},
  ] }] })],
  ['empty test results', reportWith({ testResults: [] })],
  ['unsuccessful report', reportWith({ success: false })],
];

for (const [name, report] of rejectedReports) {
  test(`${name} report suppresses Guardian`, async () => {
    const h = harness({ report });
    const result = await runQualityGate(h.options);
    assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
    assert.equal(result.allowed, false);
    assert.equal(guardianCalls(h), 0);
  });
}

test('assertion failure with consistent report is TEST_FAIL and suppresses Guardian', async () => {
  const h = harness({
    testResult: { status: 1 },
    report: reportWith({
      success: false,
      numTotalTests: 3,
      numPassedTests: 2,
      numFailedTests: 1,
      testResults: [{ assertionResults: [
        { status: 'passed' }, { status: 'passed' }, { status: 'failed' },
      ] }],
    }),
  });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'TEST_FAIL');
  assert.equal(guardianCalls(h), 0);
});

test('nonzero child with passing report is infrastructure failure', async () => {
  const h = harness({ testResult: { status: 2 } });
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.equal(guardianCalls(h), 0);
});

test('Vitest receives a unique temporary config, report, and cache location', async () => {
  const h = harness();
  const result = await runQualityGate(h.options);
  const vitest = h.calls.find((call) => call.command === process.execPath);
  assert.equal(result.testStatus, 'TEST_PASS');
  assert.ok(vitest.args.includes('run'));
  assert.ok(vitest.args.includes('--reporter=json'));
  assert.ok(vitest.args.includes('--passWithNoTests'));
  assert.match(vitest.options.env.NODE_OPTIONS, /--experimental-require-module/);
  const configArgument = vitest.args.find((argument) => argument.startsWith('--config='));
  const reportArgument = vitest.args.find((argument) => argument.startsWith('--outputFile='));
  assert.ok(configArgument);
  assert.ok(reportArgument);
  const configPath = configArgument.slice('--config='.length);
  const reportPath = reportArgument.slice('--outputFile='.length);
  assert.notEqual(configPath, reportPath);
  assert.match(configPath, /^\/tmp\/cocina-quality-gate-\d+\//);
  assert.match(reportPath, /^\/tmp\/cocina-quality-gate-\d+\//);
  const configText = h.reports.get(configPath);
  assert.match(configText, /frontend\/vitest\.config\.ts/);
  assert.match(configText, /cacheDir/);
  assert.match(configText, /vite-cache/);
  assert.doesNotMatch(configText, /node_modules\/\.vite/);
});

test('generated config preserves fixture options and isolates config, report, and cache per invocation', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cocina-quality-gate-config-test-'));
  const cwd = path.join(temporaryRoot, 'repo');
  const fixtureDirectory = path.join(temporaryRoot, 'fixture');
  const frontendDirectory = path.join(cwd, 'frontend');
  fs.mkdirSync(frontendDirectory, { recursive: true });
  fs.mkdirSync(fixtureDirectory, { recursive: true });
  fs.writeFileSync(path.join(cwd, '.nvmrc'), nvmrc);
  const sharedCache = path.join(frontendDirectory, 'node_modules', '.vite');
  const fixtureConfigPath = path.join(fixtureDirectory, 'vitest.config.mjs');
  fs.writeFileSync(fixtureConfigPath, `export default {
    resolve: { alias: { '@fixture': '/fixture/src' } },
    plugins: [{ name: 'fixture-plugin' }],
    test: {
      include: ['src/**/*.spec.ts'],
      exclude: ['src/ignored/**'],
      cache: { dir: ${JSON.stringify(sharedCache)} },
      coverage: { reporter: ['text', 'json'], reportsDirectory: 'coverage-fixture', exclude: ['src/generated/**'] },
    },
  };`);

  const spawned = [];
  const fsApi = {
    readFileSync: (...args) => fs.readFileSync(...args),
    mkdtempSync: (...args) => fs.mkdtempSync(...args),
    writeFileSync: (...args) => fs.writeFileSync(...args),
    // Keep the actual generated config alive for inspection after the controlled spawn.
    rmSync: () => {},
    existsSync: (file) => file.endsWith('/.githooks/gga-codex-pre-commit') || fs.existsSync(file),
    accessSync: () => {},
    realpathSync: (file) => file,
  };
  const options = {
    cwd,
    originalConfigPath: fixtureConfigPath,
    processInfo: { version: 'v22.22.3', execPath: process.execPath },
    fsApi,
    pathApi: path,
    osApi: { tmpdir: () => temporaryRoot },
    spawnSync: (command, args, spawnOptions) => {
      if (command.endsWith('/.githooks/gga-codex-pre-commit')) return { status: 0 };
      spawned.push({ command, args, spawnOptions });
      const configPath = args.find((argument) => argument.startsWith('--config='))?.slice('--config='.length);
      const reportPath = args.find((argument) => argument.startsWith('--outputFile='))?.slice('--outputFile='.length);
      assert.ok(configPath && reportPath);
      assert.equal(path.isAbsolute(configPath), true);
      assert.equal(path.isAbsolute(reportPath), true);
      assert.equal(path.dirname(configPath), path.dirname(reportPath));
      assert.equal(fs.existsSync(configPath), true);
      fs.writeFileSync(reportPath, validReport);
      return { status: 0 };
    },
  };

  try {
    const result = await runQualityGate(options);
    assert.equal(result.testStatus, 'TEST_PASS');
    assert.equal(spawned.length, 1);
    const { command, args } = spawned[0];
    assert.equal(command, process.execPath);
    assert.equal(args.includes('run'), true);
    assert.equal(args.includes('--passWithNoTests'), true);
    assert.equal(args.includes('--reporter=json'), true);
    const configPath = args.find((argument) => argument.startsWith('--config=')).slice('--config='.length);
    const reportPath = args.find((argument) => argument.startsWith('--outputFile=')).slice('--outputFile='.length);
    assert.equal(args.includes(`--outputFile=${reportPath}`), true);

    const loaded = await import(`${pathToFileURL(configPath).href}?test=${Date.now()}`);
    const config = loaded.default;
    assert.deepEqual(config.resolve.alias, { '@fixture': '/fixture/src' });
    assert.deepEqual(config.test.include, ['src/**/*.spec.ts']);
    assert.deepEqual(config.test.exclude, ['src/ignored/**']);
    assert.deepEqual(config.test.coverage, {
      reporter: ['text', 'json'],
      reportsDirectory: 'coverage-fixture',
      exclude: ['src/generated/**'],
    });
    assert.deepEqual(config.plugins, [{ name: 'fixture-plugin' }]);
    assert.equal(config.test.outputFile.json, reportPath);
    assert.equal(path.basename(reportPath), 'vitest-report.json');
    assert.equal(path.isAbsolute(config.cacheDir), true);
    assert.equal(path.dirname(config.cacheDir), path.dirname(configPath));
    assert.notEqual(config.cacheDir, sharedCache);
    assert.notEqual(path.resolve(config.test.cache.dir), path.resolve(sharedCache));
    assert.equal(path.resolve(config.test.cache.dir), path.resolve(config.cacheDir));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('cleanup failure overrides a valid report and suppresses Guardian', async () => {
  const h = harness();
  h.options.fsApi.rmSync = () => { throw new Error('cannot remove temp directory'); };
  const result = await runQualityGate(h.options);
  assert.equal(result.testStatus, 'INFRA_UNAVAILABLE');
  assert.match(result.reason, /clean up/i);
  assert.equal(guardianCalls(h), 0);
});
