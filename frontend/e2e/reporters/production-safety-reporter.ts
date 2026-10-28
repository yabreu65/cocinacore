import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export const PRODUCTION_MODULES = [
  'today',
  'u1_7',
  'u1_14',
  'u2',
  'u3',
  'u4_7',
  'u4_14',
  'security',
] as const;

export type ProductionModule = (typeof PRODUCTION_MODULES)[number];
export type ModuleStatus = 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';
export type ReasonCode =
  | 'ASSERTIONS_PASSED'
  | 'COVERAGE_UNKNOWN'
  | 'NO_EXPIRATION_EVIDENCE'
  | 'NO_PERSISTED_MEAL_PLAN'
  | 'PARTIAL_ANNOTATION'
  | 'TEST_FAILED'
  | 'TEST_SKIPPED';

export interface ModuleResult {
  status: ModuleStatus;
  reason: ReasonCode;
}

export interface ProductionAcceptanceSummary {
  schemaVersion: 1;
  syntheticWrites: 'disabled';
  modules: Record<ProductionModule, ModuleResult>;
}

type Annotation = { type?: string; description?: string };
type SummaryStatus = TestResult['status'] | 'skipped' | 'did_not_run';
type SummaryTest = { title: string; status: SummaryStatus; annotations?: Annotation[] };

const INITIAL_RESULT: ModuleResult = { status: 'BLOCKED', reason: 'TEST_SKIPPED' };

function modulesForTitle(title: string): ProductionModule[] {
  if (title.includes('Today U1')) return ['today'];
  if (title.includes('U1 coverage')) return ['u1_7', 'u1_14'];
  if (title.includes('U2 waste prevention')) return ['u2'];
  if (title.includes('U3 adaptive proposal')) return ['u3'];
  if (title.includes('U4 shopping suggestions')) return ['u4_7', 'u4_14'];
  if (title.includes('protected M4 endpoints')) return ['security'];
  return [];
}

function reasonForAnnotation(description: string): ReasonCode {
  const normalized = description.toLowerCase();
  if (normalized.includes('cobertura')) return 'COVERAGE_UNKNOWN';
  if (normalized.includes('vencimientos')) return 'NO_EXPIRATION_EVIDENCE';
  if (normalized.includes('menú') || normalized.includes('menu')) return 'NO_PERSISTED_MEAL_PLAN';
  return 'PARTIAL_ANNOTATION';
}

function resultForTest(result: {
  status: SummaryStatus;
  annotations?: Annotation[];
}): ModuleResult {
  if (result.status === 'skipped' || result.status === 'did_not_run') return INITIAL_RESULT;
  if (result.status !== 'passed') return { status: 'FAIL', reason: 'TEST_FAILED' };

  const partial = (result.annotations ?? []).find((annotation) => annotation.type === 'partial');
  return partial
    ? { status: 'PARTIAL', reason: reasonForAnnotation(partial.description ?? '') }
    : { status: 'PASS', reason: 'ASSERTIONS_PASSED' };
}

export function summarizeProductionTests(
  tests: ReadonlyArray<SummaryTest>
): ProductionAcceptanceSummary {
  const modules = Object.fromEntries(
    PRODUCTION_MODULES.map((module) => [module, { ...INITIAL_RESULT }])
  ) as Record<ProductionModule, ModuleResult>;

  for (const test of tests) {
    const result = resultForTest(test);
    for (const moduleName of modulesForTitle(test.title)) modules[moduleName] = result;
  }

  return { schemaVersion: 1, syntheticWrites: 'disabled', modules };
}

export default class ProductionSafetyReporter implements Reporter {
  private readonly tests: Array<{
    title: string;
    status: TestResult['status'];
    annotations: Annotation[];
  }> = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.tests.push({ title: test.title, status: result.status, annotations: result.annotations });
  }

  async onEnd(): Promise<void> {
    const summary = summarizeProductionTests(this.tests);
    const outputPath =
      process.env.PRODUCTION_ACCEPTANCE_SUMMARY_PATH ??
      'test-results/production-acceptance-summary.json';
    await mkdir(path.dirname(outputPath), { recursive: true });
    const content = `${JSON.stringify(summary, null, 2)}\n`;
    await writeFile(outputPath, content, 'utf8');
    console.log(`PRODUCTION_ACCEPTANCE_SUMMARY ${JSON.stringify(summary)}`);
  }
}
