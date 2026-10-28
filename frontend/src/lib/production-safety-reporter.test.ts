import { describe, expect, it } from 'vitest';
import { summarizeProductionTests } from '../../e2e/reporters/production-safety-reporter';

const testResult = (
  title: string,
  status: 'passed' | 'failed' | 'skipped',
  annotations: Array<{ type: string; description: string }> = []
) => ({
  title,
  status,
  annotations,
});

describe('production acceptance safety reporter', () => {
  it('marks a complete read-only acceptance as PASS', () => {
    const summary = summarizeProductionTests([
      testResult('authenticated user receives read-only Today U1 lunch recommendations', 'passed'),
      testResult(
        'U1 coverage preserves the requested 7-day horizon and honest uncertainty',
        'passed'
      ),
      testResult('U2 waste prevention returns a bounded read-only report', 'passed'),
      testResult(
        'U3 adaptive proposal is read-only and tied to the authenticated meal plan',
        'passed'
      ),
      testResult('U4 shopping suggestions are read-only for both supported horizons', 'passed'),
      testResult('protected M4 endpoints reject anonymous requests', 'passed'),
    ]);

    expect(Object.values(summary.modules).every(({ status }) => status === 'PASS')).toBe(true);
  });

  it('marks partial annotations with safe reason codes', () => {
    const summary = summarizeProductionTests([
      testResult(
        'U1 coverage preserves the requested 7-day horizon and honest uncertainty',
        'passed',
        [{ type: 'partial', description: 'La cobertura productiva no tiene agenda suficiente.' }]
      ),
      testResult('U2 waste prevention returns a bounded read-only report', 'passed', [
        {
          type: 'partial',
          description: 'No hubo evidencia productiva suficiente de vencimientos.',
        },
      ]),
      testResult(
        'U3 adaptive proposal is read-only and tied to the authenticated meal plan',
        'passed',
        [{ type: 'partial', description: 'No existe un menú persistido compatible.' }]
      ),
    ]);

    expect(summary.modules.u1_7).toEqual({ status: 'PARTIAL', reason: 'COVERAGE_UNKNOWN' });
    expect(summary.modules.u1_14).toEqual({ status: 'PARTIAL', reason: 'COVERAGE_UNKNOWN' });
    expect(summary.modules.u2).toEqual({ status: 'PARTIAL', reason: 'NO_EXPIRATION_EVIDENCE' });
    expect(summary.modules.u3).toEqual({ status: 'PARTIAL', reason: 'NO_PERSISTED_MEAL_PLAN' });
  });

  it('does not confuse HTTP-contract success with functional evidence', () => {
    const summary = summarizeProductionTests([
      testResult('U4 shopping suggestions are read-only for both supported horizons', 'passed', [
        {
          type: 'partial',
          description: 'El menú productivo no permite calcular compras con evidencia completa.',
        },
      ]),
    ]);

    expect(summary.modules.u4_7).toEqual({ status: 'PARTIAL', reason: 'NO_PERSISTED_MEAL_PLAN' });
    expect(summary.modules.u4_14).toEqual({ status: 'PARTIAL', reason: 'NO_PERSISTED_MEAL_PLAN' });
  });

  it('marks skipped and failed modules conservatively', () => {
    const summary = summarizeProductionTests([
      testResult(
        'U1 coverage preserves the requested 7-day horizon and honest uncertainty',
        'skipped'
      ),
      testResult('protected M4 endpoints reject anonymous requests', 'failed'),
    ]);

    expect(summary.modules.u1_7).toEqual({ status: 'BLOCKED', reason: 'TEST_SKIPPED' });
    expect(summary.modules.security).toEqual({ status: 'FAIL', reason: 'TEST_FAILED' });
  });
});
