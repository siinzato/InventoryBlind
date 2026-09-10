import { describe, expect, it } from 'vitest';
import type { ClosingReport, ClosingReportObservation } from '../closingReportTypes';
import type { ArchivedInventoryClosing } from '../closingReportService';
import {
  brandNameOptions,
  buildArchivedScopeRows,
  buildCompletedScopeRows,
  buildCurrentScopeRows,
  filterClosingRows,
  inventoryOptions,
  CURRENT_CYCLE_ID,
  EMPTY_CLOSING_FILTERS,
} from '../closingResultsScope';
import { buildClosingReportDocument, formatClosingDateTime } from '../closingDocumentModel';
import { renderClosingFeedback } from '../closingFeedbackTemplate';
import { buildClosingReportWordHtml, closingExportFilename } from '../closingReportExport';

const NOW = new Date('2026-09-08T12:00:00Z').getTime();

const report = (over: Partial<ClosingReport> = {}): ClosingReport => ({
  id: 'rep-1',
  companyId: 'az',
  brandId: 'brand-nillkin',
  cycleStart: null,
  version: 1,
  isCurrent: true,
  totalSku: 195,
  skusContados: 195,
  divergenciasEncontradas: 65,
  divergenciasRecontadas: 65,
  divergenciasReais: 110,
  accuracyInitial: 96.9,
  accuracyFinal: 43.6,
  categoryCounts: [
    { categoryId: 'cat-1', key: 'saldo_excesso', name: 'Saldo em excesso', count: 4 },
    { categoryId: 'cat-2', key: 'organizacao_vao', name: 'Organização do vão', count: 1 },
  ],
  unclassifiedCount: 3,
  summaryText: 'texto legado que a tela não usa mais',
  sourceCountRecordIds: ['c1'],
  generatedAt: '2026-08-31T15:56:00.000Z',
  generatedBy: null,
  createdAt: '2026-08-31T15:56:00.000Z',
  ...over,
});

const observation = (over: Partial<ClosingReportObservation> = {}): ClosingReportObservation => ({
  id: 'obs-1',
  reportId: 'rep-1',
  countRecordId: 'c1',
  observationText: 'Sobrou saldo no vão',
  matchedCategoryIds: ['cat-1'],
  isUnclassified: false,
  createdAt: '2026-08-31T15:00:00.000Z',
  ...over,
});

const LINES = [
  { id: 'brand-nillkin', brand: 'Nillkin', total_sku: 195, done_sku: 195 },
  { id: 'brand-ringke', brand: 'Ringke', total_sku: 193, done_sku: 0 },
];

describe('escopo Ciclo atual', () => {
  it('mostra só linha concluída do ciclo corrente e não mistura ciclo anterior', () => {
    const doCiclo = report();
    const deCicloAnterior = report({ id: 'rep-antigo', cycleStart: '2026-07-31T00:00:00.000Z' });

    // O escopo recebe apenas os relatórios do ciclo corrente (listCurrentReportsForCycle),
    // então um relatório de ciclo anterior nunca chega aqui — e a linha não concluída
    // continua fora da lista.
    const rows = buildCurrentScopeRows(LINES, [doCiclo]);
    expect(rows.map(r => r.brandName)).toEqual(['Nillkin']);
    expect(rows[0].inventoryId).toBe(CURRENT_CYCLE_ID);
    expect(rows[0].report?.id).toBe('rep-1');
    expect(rows.some(r => r.report?.id === deCicloAnterior.id)).toBe(false);
  });

  it('linha concluída sem relatório entra na lista (legado) sem inventar indicador', () => {
    const rows = buildCurrentScopeRows(LINES, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].report).toBeNull();
    expect(rows[0].skusContados).toBeNull();
    expect(rows[0].accuracyFinal).toBeNull();
  });
});

describe('escopo Concluídos', () => {
  it('mostra fechamentos de ciclos anteriores, do mais recente para o mais antigo', () => {
    const antigo = report({ id: 'rep-antigo', cycleStart: '2026-06-30T00:00:00.000Z', generatedAt: '2026-07-01T10:00:00.000Z' });
    const recente = report({ id: 'rep-recente', generatedAt: '2026-08-31T15:56:00.000Z' });

    const rows = buildCompletedScopeRows([antigo, recente], new Map([['brand-nillkin', 'Nillkin']]));
    expect(rows.map(r => r.report?.id)).toEqual(['rep-recente', 'rep-antigo']);
    expect(rows[1].inventoryLabel).toContain('Ciclo desde');
  });

  it('não inventa nome para linha que saiu do cadastro', () => {
    const rows = buildCompletedScopeRows([report({ brandId: 'apagada' })], new Map());
    expect(rows[0].brandName).toBe('Linha removida do cadastro');
  });
});

describe('escopo Arquivados', () => {
  const archived: ArchivedInventoryClosing[] = [
    {
      snapshotId: 'snap-1', snapshotName: 'Inventário Agosto 2026',
      startDate: '2026-08-20T00:00:00.000Z', endDate: '2026-08-31T00:00:00.000Z',
      brand: 'Nillkin', totalSku: 195, doneSku: 195, divergences: 110, accuracy: 43.6, status: 'completed',
    },
    {
      snapshotId: 'snap-0', snapshotName: 'Inventário Julho 2026',
      startDate: '2026-07-01T00:00:00.000Z', endDate: '2026-07-31T00:00:00.000Z',
      brand: 'Ringke', totalSku: 100, doneSku: 90, divergences: 4, accuracy: 95.5, status: 'completed',
    },
  ];

  it('usa o histórico real e nunca traz relatório de fechamento associado', () => {
    const rows = buildArchivedScopeRows(archived);
    expect(rows.map(r => r.inventoryLabel)).toEqual(['Inventário Agosto 2026', 'Inventário Julho 2026']);
    expect(rows.every(r => r.report === null)).toBe(true);
    expect(rows[0].skusContados).toBe(195);
    expect(rows[0].accuracyFinal).toBe(43.6);
    expect(rows[0].contextLabel).toBe('Arquivado');
  });

  it('arquivado sem closing_report não força geração — a linha simplesmente não tem relatório', () => {
    const rows = buildArchivedScopeRows(archived);
    expect(rows.every(r => r.report === null && r.brandId === null)).toBe(true);
  });

  it('snapshot sem detalhamento por linha não gera nenhuma linha fabricada', () => {
    expect(buildArchivedScopeRows([])).toEqual([]);
  });

  it('filtro de inventário respeita o snapshot', () => {
    const rows = buildArchivedScopeRows(archived);
    expect(inventoryOptions(rows).map(o => o.value)).toEqual(['snap-1', 'snap-0']);

    const filtered = filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, inventoryId: 'snap-0' });
    expect(filtered.map(r => r.brandName)).toEqual(['Ringke']);
  });
});

describe('filtros', () => {
  const rows = buildArchivedScopeRows([
    {
      snapshotId: 'snap-1', snapshotName: 'Inventário Agosto 2026',
      startDate: null, endDate: '2026-08-31T00:00:00.000Z',
      brand: 'Nillkin', totalSku: 1, doneSku: 1, divergences: 0, accuracy: 100, status: 'completed',
    },
    {
      snapshotId: 'snap-0', snapshotName: 'Inventário Janeiro 2025',
      startDate: null, endDate: '2025-01-31T00:00:00.000Z',
      brand: 'Ringke', totalSku: 1, doneSku: 1, divergences: 0, accuracy: 100, status: 'completed',
    },
  ]);

  it('não altera o dataset original', () => {
    const snapshot = [...rows];
    const filtered = filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, search: 'nillkin' });
    expect(filtered).toHaveLength(1);
    expect(rows).toEqual(snapshot);
    expect(filtered).not.toBe(rows);
  });

  it('busca respeita o escopo recebido (só filtra o que já está nele)', () => {
    expect(filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, search: 'ringke' }).map(r => r.brandName)).toEqual(['Ringke']);
    expect(filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, search: 'agosto' }).map(r => r.brandName)).toEqual(['Nillkin']);
    expect(filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, search: 'inexistente' })).toEqual([]);
  });

  it('período corta pela data real do registro', () => {
    // 31/08/2026 está a 8 dias de NOW; 31/01/2025 está fora de qualquer janela curta.
    expect(filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, period: '30d' }, NOW).map(r => r.brandName)).toEqual(['Nillkin']);
    expect(filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, period: 'year' }, NOW).map(r => r.brandName)).toEqual(['Nillkin']);
    expect(filterClosingRows(rows, { ...EMPTY_CLOSING_FILTERS, period: 'all' }, NOW)).toHaveLength(2);
  });

  it('opções de linha/marca vêm apenas das linhas presentes', () => {
    expect(brandNameOptions(rows)).toEqual(['Nillkin', 'Ringke']);
  });
});

describe('modelo canônico do documento', () => {
  const observations = [
    observation(),
    observation({ id: 'obs-2', matchedCategoryIds: ['cat-2'], observationText: 'Produto fora do vão' }),
    observation({ id: 'obs-3', matchedCategoryIds: [], isUnclassified: true, observationText: 'Sem categoria' }),
  ];

  it('copia os 6 indicadores persistidos, sem recalcular', () => {
    const doc = buildClosingReportDocument({ brandName: 'Nillkin', report: report(), observations });
    expect(doc.metrics).toEqual({
      skusContados: 195,
      divergenciasEncontradas: 65,
      divergenciasRecontadas: 65,
      divergenciasReais: 110,
      accuracyInitial: 96.9,
      accuracyFinal: 43.6,
    });
    expect(doc.closedAt).toBe('2026-08-31T15:56:00.000Z');
  });

  it('agrupa observações por categoria real e separa as não classificadas', () => {
    const doc = buildClosingReportDocument({ brandName: 'Nillkin', report: report(), observations });
    expect(doc.categories.map(c => [c.name, c.count, c.observations.length])).toEqual([
      ['Saldo em excesso', 4, 1],
      ['Organização do vão', 1, 1],
    ]);
    expect(doc.unclassifiedObservations).toEqual(['Sem categoria']);
  });

  it('PDF e Word saem do mesmo documento: o Word mostra os indicadores do modelo', () => {
    const doc = buildClosingReportDocument({ brandName: 'Nillkin', report: report(), observations });
    const html = buildClosingReportWordHtml(doc);
    expect(html).toContain('Relatório de Fechamento de Inventário');
    expect(html).toContain('Nillkin');
    expect(html).toContain('195');
    expect(html).toContain('43.6%');
    expect(html).toContain('Saldo em excesso');
    expect(closingExportFilename(doc, 'pdf')).toBe('fechamento-nillkin-2026-08-31.pdf');
    expect(closingExportFilename(doc, 'doc')).toBe('fechamento-nillkin-2026-08-31.doc');
  });

  it('exportar não altera o relatório nem o documento de origem', () => {
    const original = report();
    const doc = buildClosingReportDocument({ brandName: 'Nillkin', report: original, observations });
    const before = JSON.stringify({ original, doc });
    buildClosingReportWordHtml(doc);
    closingExportFilename(doc, 'pdf');
    expect(JSON.stringify({ original, doc })).toBe(before);
  });

  it('data/hora do fechamento é a persistida, formatada em pt-BR', () => {
    expect(formatClosingDateTime('2026-08-31T15:56:00.000Z')).toMatch(/^31\/08\/2026 às \d{2}:\d{2}$/);
  });
});

describe('feedback ao responsável', () => {
  const doc = buildClosingReportDocument({
    brandName: 'Nillkin',
    report: report(),
    observations: [observation(), observation({ id: 'obs-3', matchedCategoryIds: [], isUnclassified: true })],
  });

  it('é determinístico: mesma entrada, mesmo texto', () => {
    const input = { employeeName: 'Victor', role: 'Conferente', managerNote: 'Repassar no alinhamento.' };
    expect(renderClosingFeedback(doc, input)).toBe(renderClosingFeedback(doc, input));
  });

  it('traz a estrutura fixa com os dados reais do fechamento', () => {
    const text = renderClosingFeedback(doc, { employeeName: 'Victor', role: 'Conferente' });
    expect(text.startsWith('FEEDBACK DE FECHAMENTO DE INVENTÁRIO')).toBe(true);
    expect(text).toContain('Responsável: Victor');
    expect(text).toContain('Cargo/Função: Conferente');
    expect(text).toContain('Linha/Marca: Nillkin');
    expect(text).toContain('SKUs contados: 195');
    expect(text).toContain('Acuracidade final: 43.6%');
    expect(text).toContain('Saldo em excesso — 4 registros');
    expect(text).toContain('OBSERVAÇÃO DO GESTOR');
    expect(text).toContain('CONCLUSÃO');
  });

  it('campos opcionais vazios não quebram o texto', () => {
    const text = renderClosingFeedback(doc, { employeeName: 'Victor' });
    expect(text).toContain('Cargo/Função: Não informado');
    expect(text).toContain('Nenhuma observação complementar registrada.');
  });

  it('não emite juízo sobre a pessoa', () => {
    const text = renderClosingFeedback(doc, {
      employeeName: 'Victor',
      managerNote: 'Conversamos sobre o processo do vão.',
    }).toLowerCase();
    for (const proibido of ['bom funcionário', 'mau desempenho', 'culpa', 'advertência', 'punição', 'desligamento', 'erro do responsável']) {
      expect(text).not.toContain(proibido);
    }
  });
});
