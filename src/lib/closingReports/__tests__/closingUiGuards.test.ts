// Guardas de fonte para o que não é função pura — mesmo mecanismo de
// migrationGuards.test.ts (import.meta.glob raw). Não substitui teste de componente
// (o projeto não tem essa infra); pega exatamente as regressões que esta tarefa
// existiu para corrigir: a tabela voltar a oferecer "Ver resultado"/"Gerado", o modal
// voltar a oferecer regeneração, e visualizar um fechamento gravado voltar a chamar
// generateClosingReport.

import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob('/src/components/counting/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const EXPORTS = import.meta.glob('/src/lib/closingReports/closingReportExport.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function source(fragment: string): string {
  const key = Object.keys(SOURCES).find(p => p.endsWith(fragment));
  return key ? SOURCES[key] : '';
}

const PAGE = source('counting/ClosingResultsPage.tsx');
const MODAL = source('counting/closing/ClosingSummaryModal.tsx');
const COUNT_MODAL = source('counting/closing/CountClosingSummaryModal.tsx');
const EXPORT_MODULE = EXPORTS[Object.keys(EXPORTS)[0]] ?? '';

describe('Resultados por Linha — tabela', () => {
  it('os arquivos existem e não estão vazios', () => {
    expect(PAGE.length).toBeGreaterThan(0);
    expect(MODAL.length).toBeGreaterThan(0);
  });

  it('não renderiza mais "Gerado", "Ver resultado" nem "Gerar resumo"', () => {
    expect(PAGE).not.toContain('Gerado');
    expect(PAGE).not.toContain('Ver resultado');
    expect(PAGE).not.toContain('Gerar resumo');
  });

  it('a ação da linha é "Visualizar fechamento"', () => {
    expect(PAGE).toContain('Visualizar fechamento');
  });

  it('não existe mais coluna Status na tabela', () => {
    expect(PAGE).not.toMatch(/<Th>Status<\/Th>/);
  });

  it('tem o controle de escopo com os três conjuntos', () => {
    expect(PAGE).toContain('SegmentedControl');
    expect(PAGE).toContain('CLOSING_SCOPE_OPTIONS');
  });
});

describe('abertura read-only', () => {
  it('relatório existente abre pelas observações dele, sem gerar', () => {
    expect(PAGE).toContain('getObservationsForReport(row.report.id)');
    // O caminho do relatório existente vem ANTES de qualquer geração.
    expect(PAGE.indexOf('getObservationsForReport(row.report.id)')).toBeLessThan(PAGE.indexOf('generateClosingReport('));
  });

  it('generateClosingReport só é alcançado no fallback de legado e nunca com force', () => {
    expect(PAGE).toContain('} else if (row.brandId) {');
    expect(PAGE.match(/generateClosingReport\(/g) ?? []).toHaveLength(1);
    expect(PAGE).not.toContain('force: true');
  });

  it('linha arquivada não passa pelo caminho de geração', () => {
    expect(PAGE).toContain("if (row.scope === 'archived')");
  });
});

describe('modal de fechamento', () => {
  it('usa o título novo com a data do fechamento', () => {
    expect(MODAL).toContain('Fechamento da linha');
    expect(MODAL).toContain('formatClosingDateTime(report.generatedAt)');
    expect(MODAL).not.toContain('Resumo de fechamento');
  });

  it('não tem mais summaryText, "Gerenciar categorias" nem "Reprocessar resumo"', () => {
    expect(MODAL).not.toContain('summaryText');
    expect(MODAL).not.toContain('Gerenciar categorias');
    expect(MODAL).not.toContain('Reprocessar resumo');
  });

  it('tem exportação e preparação de feedback', () => {
    expect(MODAL).toContain('Exportar relatório');
    expect(MODAL).toContain('Exportar em PDF');
    expect(MODAL).toContain('Exportar em Word');
    expect(MODAL).toContain('Preparar feedback ao responsável');
  });

  it('preserva os 6 indicadores pela lista canônica e as categorias expansíveis', () => {
    expect(MODAL).toContain('CLOSING_METRIC_ROWS');
    expect(MODAL).toContain('report.categoryCounts.map');
    expect(MODAL).toContain('Observações não classificadas');
  });

  it('o fluxo de contagem continua com reprocessar e gerenciar categorias', () => {
    expect(COUNT_MODAL).toContain('Reprocessar resumo');
    expect(COUNT_MODAL).toContain('Gerenciar categorias');
  });
});

describe('exportação', () => {
  it('exportar é leitura: o módulo não fala com o banco', () => {
    expect(EXPORT_MODULE.length).toBeGreaterThan(0);
    expect(EXPORT_MODULE).not.toContain("from '../supabase'");
    expect(EXPORT_MODULE).not.toContain('.update(');
    expect(EXPORT_MODULE).not.toContain('.insert(');
  });

  it('PDF e Word partem do modelo canônico', () => {
    expect(EXPORT_MODULE).toContain("from './closingDocumentModel'");
    expect(EXPORT_MODULE).toContain('downloadClosingReportPdf(doc: ClosingDocument)');
    expect(EXPORT_MODULE).toContain('downloadClosingReportWord(doc: ClosingDocument)');
  });

  it('não usa biblioteca nova de PDF nem de Word', () => {
    expect(EXPORT_MODULE).toContain("import('jspdf')");
    expect(EXPORT_MODULE).not.toContain("from 'docx'");
  });
});
