import { describe, expect, it } from 'vitest';
import { evaluateDiagnosticEligibility, LOW_SKU_THRESHOLD, NEW_WORKSPACE_DAYS, type DiagnosticEligibilityInput } from '../dashboardDiagnosticRule';

const NOW = new Date('2026-08-24T12:00:00Z');

function input(overrides: Partial<DiagnosticEligibilityInput> = {}): DiagnosticEligibilityInput {
  return {
    diagnosticCompleted: false, companyCreatedAt: null, productCount: null, hasBlockedFeatureInterest: false, now: NOW,
    ...overrides,
  };
}

describe('evaluateDiagnosticEligibility', () => {
  it('workspace maduro, plano completo, sem gatilho: não elegível (ex.: AZ)', () => {
    const result = evaluateDiagnosticEligibility(input({
      companyCreatedAt: '2026-01-01T00:00:00Z', productCount: LOW_SKU_THRESHOLD + 1000,
    }));
    expect(result.eligible).toBe(false);
  });

  it('workspace recém-criado é elegível', () => {
    const createdAt = new Date(NOW.getTime() - (NEW_WORKSPACE_DAYS - 1) * 86400000).toISOString();
    const result = evaluateDiagnosticEligibility(input({ companyCreatedAt: createdAt }));
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain('new_workspace');
  });

  it('poucos SKUs é elegível', () => {
    const result = evaluateDiagnosticEligibility(input({ productCount: LOW_SKU_THRESHOLD - 1 }));
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain('low_sku_count');
  });

  it('interesse em função bloqueada é elegível', () => {
    const result = evaluateDiagnosticEligibility(input({ hasBlockedFeatureInterest: true }));
    expect(result.eligible).toBe(true);
    expect(result.reasons).toContain('blocked_feature_interest');
  });

  it('diagnóstico concluído nunca é elegível, mesmo com gatilho', () => {
    const result = evaluateDiagnosticEligibility(input({ diagnosticCompleted: true, hasBlockedFeatureInterest: true }));
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('workspace com idade desconhecida nunca dispara por essa condição', () => {
    const result = evaluateDiagnosticEligibility(input({ companyCreatedAt: null, productCount: null }));
    expect(result.eligible).toBe(false);
  });

  it('workspace além do limite de dias não é mais "recém-criado"', () => {
    const createdAt = new Date(NOW.getTime() - (NEW_WORKSPACE_DAYS + 1) * 86400000).toISOString();
    const result = evaluateDiagnosticEligibility(input({ companyCreatedAt: createdAt }));
    expect(result.reasons).not.toContain('new_workspace');
  });
});
