import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GATE_TIMEOUT_MS = 10 * 60 * 1000;
const GUARDIAN_TIMEOUT_MS = 10 * 60 * 1000;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

function infra(reason) {
  return { testStatus: 'INFRA_UNAVAILABLE', guardianStatus: null, allowed: false, reason };
}

const reportCountFields = [
  'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites',
  'numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests',
];

function parseReport(reportText) {
  const report = JSON.parse(reportText);
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Vitest JSON report must be an object');
  }
  if (typeof report.success !== 'boolean') throw new Error('Vitest JSON report is missing success status');
  for (const field of reportCountFields) {
    if (!Number.isInteger(report[field]) || report[field] < 0) {
      throw new Error(`Vitest JSON report has invalid ${field}`);
    }
  }
  if (report.numTotalTestSuites !== report.numPassedTestSuites + report.numFailedTestSuites + report.numPendingTestSuites) {
    throw new Error('Vitest JSON report has inconsistent suite counts');
  }
  if (report.numTotalTests !== report.numPassedTests + report.numFailedTests + report.numPendingTests + report.numTodoTests) {
    throw new Error('Vitest JSON report has inconsistent test counts');
  }
  if (!Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new Error('Vitest JSON report has no test result files');
  }

  const assertionCounts = { passed: 0, failed: 0, pending: 0, todo: 0 };
  for (const testResult of report.testResults) {
    if (!testResult || typeof testResult !== 'object' || !Array.isArray(testResult.assertionResults)) {
      throw new Error('Vitest JSON report contains malformed assertion results');
    }
    for (const assertion of testResult.assertionResults) {
      if (!assertion || typeof assertion !== 'object' || typeof assertion.status !== 'string') {
        throw new Error('Vitest JSON report contains an assertion without status');
      }
      switch (assertion.status) {
        case 'passed': assertionCounts.passed += 1; break;
        case 'failed': assertionCounts.failed += 1; break;
        case 'skipped':
        case 'pending':
        case 'disabled': assertionCounts.pending += 1; break;
        case 'todo': assertionCounts.todo += 1; break;
        default: throw new Error(`Vitest JSON report has unknown assertion status: ${assertion.status}`);
      }
    }
  }
  if (assertionCounts.passed !== report.numPassedTests
    || assertionCounts.failed !== report.numFailedTests
    || assertionCounts.pending !== report.numPendingTests
    || assertionCounts.todo !== report.numTodoTests) {
    throw new Error('Vitest JSON report assertion statuses contradict summary counts');
  }
  if (report.success !== (report.numFailedTests === 0 && report.numFailedTestSuites === 0)) {
    throw new Error('Vitest JSON report success status contradicts failure counts');
  }
  return {
    suites: report.numTotalTestSuites,
    failedSuites: report.numFailedTestSuites,
    tests: report.numTotalTests,
    failedTests: report.numFailedTests,
    passedTests: report.numPassedTests,
  };
}

export function runTests({ cwd, processInfo, fsApi, pathApi, osApi, spawn, originalConfigPath }) {
  let expectedVersion;
  try {
    expectedVersion = fsApi.readFileSync(pathApi.join(cwd, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
  } catch (error) {
    return infra(`Unable to read repository .nvmrc: ${error.message}`);
  }
  if (!expectedVersion || processInfo.version !== `v${expectedVersion}`) {
    return infra(`Node version mismatch: expected v${expectedVersion || '(empty)'}, running ${processInfo.version}`);
  }

  let runDirectory;
  let result;
  try {
    runDirectory = fsApi.mkdtempSync(pathApi.join(osApi.tmpdir(), 'cocina-quality-gate-'));
    const reportPath = pathApi.join(runDirectory, 'vitest-report.json');
    const configPath = pathApi.join(runDirectory, 'vitest.config.mjs');
    const cachePath = pathApi.join(runDirectory, 'vite-cache');
    if (fsApi.existsSync(reportPath)) throw new Error('fresh Vitest report path already exists');
    const originalConfigUrl = pathToFileURL(originalConfigPath ?? pathApi.resolve(cwd, 'frontend', 'vitest.config.ts')).href;
    const tempConfig = [
      `import originalConfig from ${JSON.stringify(originalConfigUrl)};`,
      `const reportPath = ${JSON.stringify(reportPath)};`,
      `export default { ...originalConfig, cacheDir: ${JSON.stringify(cachePath)}, test: {`,
      '  ...originalConfig.test,',
      `  cache: { ...originalConfig.test?.cache, dir: ${JSON.stringify(cachePath)} },`,
      '  outputFile: { ...originalConfig.test?.outputFile, json: reportPath },',
      '} };',
      '',
    ].join('\n');
    fsApi.writeFileSync(configPath, tempConfig, 'utf8');
    const child = spawn(processInfo.execPath, [
      pathApi.join(cwd, 'frontend', 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      `--config=${configPath}`,
      '--reporter=json',
      `--outputFile=${reportPath}`,
      '--passWithNoTests',
    ], { cwd: pathApi.join(cwd, 'frontend'), encoding: 'utf8', timeout: GATE_TIMEOUT_MS, stdio: 'inherit' });
    if (child.error || child.signal) {
      const detail = child.error?.code || child.signal || child.error?.message || 'unknown child-process failure';
      result = infra(`Vitest did not complete: ${detail}`);
    } else {
      let counts;
      try {
        counts = parseReport(fsApi.readFileSync(reportPath, 'utf8'));
      } catch (error) {
        result = infra(`Missing or invalid fresh Vitest JSON report: ${error.message}`);
      }
      if (counts) {
        if (counts.tests === 0 || counts.suites === 0 || counts.passedTests === 0) {
          result = infra('Vitest collected zero tests, suites, or passed assertions');
        } else if (counts.failedTests > 0 || counts.failedSuites > 0) {
          result = { testStatus: 'TEST_FAIL', guardianStatus: null, allowed: false, reason: 'Vitest reported failed tests or suites' };
        } else if (child.status !== 0) {
          result = infra(`Vitest exited with status ${child.status}`);
        } else {
          result = { testStatus: 'TEST_PASS', guardianStatus: null, allowed: false, reason: null };
        }
      }
    }
  } catch (error) {
    result = infra(`Unable to prepare or run Vitest: ${error.message}`);
  }

  if (runDirectory) {
    try {
      fsApi.rmSync(runDirectory, { recursive: true, force: true });
    } catch (error) {
      return infra(`Unable to clean up quality-gate temporary directory: ${error.message}`);
    }
  }
  return result ?? infra('Vitest gate did not produce a result');
}

function runGuardian({ cwd, fsApi, pathApi, spawn, wrapperPath }) {
  let commonDirResult;
  try {
    commonDirResult = spawn('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', timeout: 10_000 });
  } catch (error) {
    return { status: 'GUARDIAN_FAIL', reason: `Unable to resolve Git common directory: ${error.message}` };
  }
  if (commonDirResult.error || commonDirResult.signal || commonDirResult.status !== 0) {
    return { status: 'GUARDIAN_FAIL', reason: 'Unable to resolve Git common directory' };
  }

  const commonDir = pathApi.resolve(cwd, commonDirResult.stdout.trim());
  const hookPath = pathApi.join(commonDir, 'hooks', 'pre-commit');
  try {
    if (!fsApi.existsSync(hookPath)) throw new Error('shared hook is missing');
    fsApi.accessSync(hookPath, fsApi.constants?.X_OK ?? 1);
    if (fsApi.realpathSync(hookPath) === fsApi.realpathSync(wrapperPath)) {
      throw new Error('shared hook resolves to this project wrapper');
    }
  } catch (error) {
    return { status: 'GUARDIAN_FAIL', reason: `Invalid shared Guardian hook: ${error.message}` };
  }

  let result;
  try {
    result = spawn(hookPath, [], { cwd, encoding: 'utf8', timeout: GUARDIAN_TIMEOUT_MS, stdio: 'inherit' });
  } catch (error) {
    return { status: 'GUARDIAN_FAIL', reason: `Unable to start shared Guardian hook: ${error.message}` };
  }
  if (result.error || result.signal || result.status !== 0) {
    return { status: 'GUARDIAN_FAIL', reason: `Shared Guardian hook failed (${result.error?.code || result.signal || result.status})` };
  }
  return { status: 'GUARDIAN_PASS', reason: null };
}

export async function runQualityGate(options = {}) {
  const cwd = options.cwd ?? repositoryRoot;
  const processInfo = options.processInfo ?? process;
  const fsApi = options.fsApi ?? fs;
  const pathApi = options.pathApi ?? path;
  const osApi = options.osApi ?? os;
  const spawn = options.spawnSync ?? spawnSync;
  const testResult = runTests({
    cwd, processInfo, fsApi, pathApi, osApi, spawn,
    originalConfigPath: options.originalConfigPath,
  });
  if (testResult.testStatus !== 'TEST_PASS') return testResult;

  const guardian = runGuardian({
    cwd,
    fsApi,
    pathApi,
    spawn,
    wrapperPath: options.wrapperPath ?? pathApi.join(cwd, '.githooks', 'pre-commit'),
  });
  return {
    testStatus: 'TEST_PASS',
    guardianStatus: guardian.status,
    allowed: guardian.status === 'GUARDIAN_PASS',
    reason: guardian.reason,
  };
}

async function main() {
  const result = await runQualityGate();
  console.log(`TEST: ${result.testStatus}${result.reason ? ` — ${result.reason}` : ''}`);
  if (result.guardianStatus) console.log(`GUARDIAN: ${result.guardianStatus}${result.reason ? ` — ${result.reason}` : ''}`);
  if (!result.allowed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`INFRA_UNAVAILABLE — ${error.message}`);
    process.exitCode = 1;
  });
}
