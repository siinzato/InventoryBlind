import { describe, expect, it } from 'vitest';
import { computeRecurrenceStat, computePillarAverages, pillarEligibleCount } from '../analyticsMath';
import type { RcaRecord } from '../../domainTypes';

const NOW = new Date('2026-09-02T12:00:00Z').getTime();
const DAY = 86400000;

function rcaRecord(overrides: Partial<RcaRecord> = {}): RcaRecord {
  return {
    id: 'r1', company_id: 'c1', source_module: 'import_count', source_item_id: 's1',
    product_id: null, sku: 'SKU-1', product_name: null, location: null,
    operator_user_id: null, operator_name: null, supplier_name: null, supplier_cnpj: null,
    divergence_qty: 1, process_area: null, cause_category: null, subcause_code: null,
    custom_cause_label: null, notes: null, severity: 'media', classification_status: 'classified',
    containment_needed: false, known_recurrence: false, financial_impact: null,
    manual_escalation: false, rca_case_id: null, classified_by: null, classified_by_email: null,
    occurred_at: new Date(NOW).toISOString(), created_at: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('computeRecurrenceStat — respeita recurrence_window_days (bug real corrigido)', () => {
  it('ignora registros ocorridos fora da janela configurada, mesmo vindo num lote maior', () => {
    const records = [
      rcaRecord({ sku: 'SKU-1', occurred_at: new Date(NOW - 5 * DAY).toISOString() }),
      rcaRecord({ sku: 'SKU-1', occurred_at: new Date(NOW - 10 * DAY).toISOString() }),
      // Fora da janela de 30 dias configurada — não pode contar para a reincidência.
      rcaRecord({ sku: 'SKU-1', occurred_at: new Date(NOW - 100 * DAY).toISOString() }),
    ];
    const stat = computeRecurrenceStat(records, 2, 30, NOW);
    expect(stat).not.toBeNull();
    expect(stat?.distinctSkus).toBe(1);
    // Só as 2 ocorrências dentro da janela contam — bateu o limiar de 2.
    expect(stat?.recurringSkus).toBe(1);
  });

  it('um SKU só reincidente por causa de um registro antigo deixa de contar quando a janela encolhe', () => {
    const records = [
      rcaRecord({ sku: 'SKU-2', occurred_at: new Date(NOW - 2 * DAY).toISOString() }),
      rcaRecord({ sku: 'SKU-2', occurred_at: new Date(NOW - 90 * DAY).toISOString() }),
    ];
    const stat = computeRecurrenceStat(records, 2, 30, NOW);
    expect(stat?.recurringSkus).toBe(0);
  });

  it('retorna null quando nenhum registro com SKU cai dentro da janela', () => {
    const records = [rcaRecord({ sku: 'SKU-3', occurred_at: new Date(NOW - 200 * DAY).toISOString() })];
    expect(computeRecurrenceStat(records, 2, 30, NOW)).toBeNull();
  });

  it('registros sem SKU nunca entram na contagem', () => {
    const records = [rcaRecord({ sku: null, occurred_at: new Date(NOW).toISOString() })];
    expect(computeRecurrenceStat(records, 1, 30, NOW)).toBeNull();
  });
});

describe('computePillarAverages — agrega os 4 fatores do CBC sem inventar dado', () => {
  it('retorna null quando não há nenhuma linha com dado suficiente', () => {
    expect(computePillarAverages([])).toBeNull();
  });

  it('calcula a média normalizada (0-100) de cada pilar entre os produtos avaliados', () => {
    const rows = [
      { accuracyHistory: { score: 40, max: 40 }, recency: { score: 25, max: 25 }, stability: { score: 20, max: 20 }, integrity: { score: 15, max: 15 } },
      { accuracyHistory: { score: 20, max: 40 }, recency: { score: 0, max: 25 }, stability: { score: 10, max: 20 }, integrity: { score: 0, max: 15 } },
    ];
    const result = computePillarAverages(rows);
    expect(result).toEqual({ accuracyHistory: 75, recency: 50, stability: 75, integrity: 50, sampleSize: 2 });
  });

  it('usa `weight` como teto quando a linha não gravou `max` (weight === max no CBC atual)', () => {
    const rows = [{
      accuracyHistory: { score: 20, weight: 40 }, recency: { score: 25, weight: 25 },
      stability: { score: 10, weight: 20 }, integrity: { score: 15, weight: 15 },
    }];
    expect(computePillarAverages(rows)).toEqual({
      accuracyHistory: 50, recency: 100, stability: 50, integrity: 100, sampleSize: 1,
    });
  });

  // Caso real do workspace: as linhas com has_sufficient_data = true vinham da versão anterior
  // do algoritmo (8 fatores), então não existe base para os 4 pilares atuais.
  it('ignora linhas com os fatores da versão anterior do CBC — não converte nem inventa pilar', () => {
    const legacyRow = {
      divergenceHistory: { score: 55, weight: 25 }, daysSinceLastCount: { score: 30, weight: 15 },
      recurrence: { score: 100, weight: 15 }, timeWithoutDivergence: { score: 100, weight: 15 },
      movementFrequency: { score: 100, weight: 10 }, quantityMoved: { score: 100, weight: 10 },
      averageStock: { score: 50, weight: 5 }, stockAdjustments: { score: 100, weight: 5 },
    };
    expect(computePillarAverages([legacyRow])).toBeNull();
    expect(pillarEligibleCount([legacyRow])).toBe(0);
  });

  it('conta como base apenas as linhas elegíveis quando o lote é misto', () => {
    const legacyRow = { divergenceHistory: { score: 55, weight: 25 } };
    const modernRow = {
      accuracyHistory: { score: 40, max: 40 }, recency: { score: 25, max: 25 },
      stability: { score: 20, max: 20 }, integrity: { score: 15, max: 15 },
    };
    expect(pillarEligibleCount([legacyRow, modernRow, legacyRow])).toBe(1);
    expect(computePillarAverages([legacyRow, modernRow, legacyRow])?.sampleSize).toBe(1);
  });
});
