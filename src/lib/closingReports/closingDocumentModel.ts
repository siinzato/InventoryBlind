// Modelo canônico do documento de fechamento — fonte ÚNICA de PDF, Word e feedback.
// Puro e sem I/O: só reorganiza o que já está persistido no ClosingReport e nas
// observações. Nenhum indicador é recalculado aqui; nenhuma observação é reclassificada
// (a classificação vive em observationClassifier.ts e roda apenas na geração).

import type { ClosingReport, ClosingReportObservation } from './closingReportTypes';

export interface ClosingDocumentCategory {
  categoryId: string;
  name: string;
  count: number;
  observations: string[];
}

export interface ClosingDocumentMetrics {
  skusContados: number;
  divergenciasEncontradas: number;
  divergenciasRecontadas: number;
  divergenciasReais: number;
  accuracyInitial: number | null;
  accuracyFinal: number | null;
}

export interface ClosingDocument {
  brandName: string;
  /** URL/dataURL do logo da marca, quando houver. Opcional em todo consumidor: falha ou
   *  ausência do logo nunca impede a exportação. */
  brandLogo?: string | null;
  /** ISO real do fechamento (report.generatedAt) — nunca "agora". */
  closedAt: string;
  metrics: ClosingDocumentMetrics;
  categories: ClosingDocumentCategory[];
  unclassifiedObservations: string[];
}

export function formatClosingDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${date} às ${time}`;
  } catch {
    return iso;
  }
}

export function formatAccuracy(value: number | null): string {
  return value !== null ? `${value.toFixed(1)}%` : '—';
}

export interface BuildClosingDocumentInput {
  brandName: string;
  report: ClosingReport;
  observations: ClosingReportObservation[];
  brandLogo?: string | null;
}

/** Monta o documento a partir dos dados já gravados. A ordem das categorias é a do
 *  próprio relatório (category_counts), preservando o que foi persistido na geração. */
export function buildClosingReportDocument(input: BuildClosingDocumentInput): ClosingDocument {
  const { brandName, report, observations, brandLogo = null } = input;

  const categories: ClosingDocumentCategory[] = report.categoryCounts.map(c => ({
    categoryId: c.categoryId,
    name: c.name,
    count: c.count,
    observations: observations
      .filter(o => o.matchedCategoryIds.includes(c.categoryId))
      .map(o => o.observationText),
  }));

  return {
    brandName,
    brandLogo,
    closedAt: report.generatedAt,
    metrics: {
      skusContados: report.skusContados,
      divergenciasEncontradas: report.divergenciasEncontradas,
      divergenciasRecontadas: report.divergenciasRecontadas,
      divergenciasReais: report.divergenciasReais,
      accuracyInitial: report.accuracyInitial,
      accuracyFinal: report.accuracyFinal,
    },
    categories,
    unclassifiedObservations: observations.filter(o => o.isUnclassified).map(o => o.observationText),
  };
}

/** Rótulos dos 6 indicadores, na ordem canônica usada em tela, PDF, Word e feedback. */
export const CLOSING_METRIC_ROWS: { label: string; value: (m: ClosingDocumentMetrics) => string }[] = [
  { label: 'SKUs contados', value: m => String(m.skusContados) },
  { label: 'Divergências encontradas', value: m => String(m.divergenciasEncontradas) },
  { label: 'Divergências recontadas', value: m => String(m.divergenciasRecontadas) },
  { label: 'Divergências reais', value: m => String(m.divergenciasReais) },
  { label: 'Acuracidade inicial', value: m => formatAccuracy(m.accuracyInitial) },
  { label: 'Acuracidade final', value: m => formatAccuracy(m.accuracyFinal) },
];
