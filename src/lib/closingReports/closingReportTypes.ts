// Tipos de domínio do resumo de fechamento de linha/marca — mirrors o padrão
// camelCase-domain-type-over-snake_case-row já usado em physicalCountTypes.ts.

export interface ClosingCategory {
  id: string;
  companyId: string;
  key: string;
  name: string;
  keywords: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClosingCategoryMatch {
  categoryIds: string[];
  isUnclassified: boolean;
}

export interface CategoryCountSnapshot {
  categoryId: string;
  key: string;
  name: string;
  count: number;
}

export interface ClosingReport {
  id: string;
  companyId: string;
  brandId: string;
  cycleStart: string | null;
  version: number;
  isCurrent: boolean;
  totalSku: number;
  skusContados: number;
  divergenciasEncontradas: number;
  divergenciasRecontadas: number;
  divergenciasReais: number;
  accuracyInitial: number | null;
  accuracyFinal: number | null;
  categoryCounts: CategoryCountSnapshot[];
  unclassifiedCount: number;
  summaryText: string;
  sourceCountRecordIds: string[];
  generatedAt: string;
  generatedBy: string | null;
  createdAt: string;
}

export interface ClosingReportObservation {
  id: string;
  reportId: string;
  countRecordId: string;
  observationText: string;
  matchedCategoryIds: string[];
  isUnclassified: boolean;
  createdAt: string;
}

export interface ClosingReportWithObservations {
  report: ClosingReport;
  observations: ClosingReportObservation[];
}

export type ClosingReportGenerationResult =
  | { status: 'generated' | 'already_current'; report: ClosingReport; observations: ClosingReportObservation[] }
  | { status: 'skipped_pending'; }
  | { status: 'error'; message: string };
