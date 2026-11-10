// Modelo canônico do documento de fechamento — fonte ÚNICA de PDF, Word e feedback.
// Puro e sem I/O: só reorganiza o que já está persistido no ClosingReport e nas
// observações. Nenhum indicador é recalculado aqui; nenhuma observação é reclassificada
// (a classificação vive em observationClassifier.ts e roda apenas na geração).

import type { ClosingReport, ClosingReportObservation } from './closingReportTypes';
import type { InventoryCountRecord } from '../supabase';
import { pct, plural } from '../formatPtBr';

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

/** Uma contagem do ciclo, como ela foi registrada. Nada aqui é recalculado. */
export interface ClosingDocumentSession {
  countNumber: number;
  /** `manual` ou `import` — como a contagem entrou no sistema. */
  source: string;
  /** Operadores que contaram, já sem os vazios. Pode vir lista vazia. */
  operators: string[];
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  skusContados: number;
  divergenciasReais: number;
  accuracyFinal: number | null;
}

export interface ClosingDocument {
  brandName: string;
  /** URL/dataURL do logo da marca, quando houver. Opcional em todo consumidor: falha ou
   *  ausência do logo nunca impede a exportação. */
  brandLogo?: string | null;
  /** ISO real do fechamento (report.generatedAt) — nunca "agora". */
  closedAt: string;
  /** Universo da linha no fechamento (report.totalSku). */
  totalSku: number;
  /** Início da PRIMEIRA contagem e fim da ÚLTIMA — a janela real de trabalho na linha,
   *  que não é a mesma coisa que a data de fechamento. null quando nenhuma contagem do
   *  ciclo tem o horário registrado (contagens antigas não têm). */
  startedAt: string | null;
  finishedAt: string | null;
  /** Soma das durações registradas — tempo efetivamente contando, não o intervalo entre
   *  início e fim (que inclui as paradas). null quando nenhuma contagem tem duração. */
  countingSeconds: number | null;
  sessions: ClosingDocumentSession[];
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

/** Só a hora, para a linha de período onde a data já foi dita. */
export function formatClosingTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/** Duração em linguagem de quem lê, não em segundos. */
export function formatClosingDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} ${plural(totalMin, 'minuto', 'minutos')}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hora = `${h} ${plural(h, 'hora', 'horas')}`;
  return m === 0 ? hora : `${hora} e ${m} ${plural(m, 'minuto', 'minutos')}`;
}

export function formatAccuracy(value: number | null): string {
  return value !== null ? pct(value) : '—';
}

/** Nomes de operador sem vazios e sem repetição, preservando a ordem de lançamento.
 *  A comparação ignora caixa e espaço de sobra, mas o nome exibido é o que foi digitado. */
function dedupeOperators(raw: (string | null)[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const nome = value?.trim();
    if (!nome) continue;
    const chave = nome.toLocaleLowerCase('pt-BR');
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(nome);
  }
  return out;
}

export interface BuildClosingDocumentInput {
  brandName: string;
  report: ClosingReport;
  observations: ClosingReportObservation[];
  brandLogo?: string | null;
  /** Contagens do ciclo (ver listClosingCycleRecords). Opcional: sem elas o documento
   *  sai como saía antes, sem a seção de sessões — exportar nunca depende desta leitura. */
  records?: InventoryCountRecord[];
}

/** Monta o documento a partir dos dados já gravados. A ordem das categorias é a do
 *  próprio relatório (category_counts), preservando o que foi persistido na geração. */
export function buildClosingReportDocument(input: BuildClosingDocumentInput): ClosingDocument {
  const { brandName, report, observations, brandLogo = null, records = [] } = input;

  const sessions: ClosingDocumentSession[] = records.map(r => ({
    countNumber: r.count_number,
    source: r.source,
    // Um operador em branco não vira string vazia na folha: ou tem nome, ou não entra.
    // E repetido não vira "Victor e Victor": na prática a mesma pessoa é lançada nos dois
    // campos quando conta sozinha — 27 dos 30 registros atuais são assim.
    operators: dedupeOperators([r.operator_1, r.operator_2]),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationSeconds: r.duration_seconds,
    skusContados: r.skus_contados,
    divergenciasReais: r.divergencias_reais,
    accuracyFinal: r.accuracy_final,
  }));

  // Contagens antigas não têm horário gravado; a janela sai do que existe, e sai null
  // quando não existe nenhuma — em vez de inventar a data de criação como se fosse início.
  const inicios = sessions.map(s => s.startedAt).filter((v): v is string => !!v).sort();
  const fins = sessions.map(s => s.finishedAt).filter((v): v is string => !!v).sort();
  const duracoes = sessions.map(s => s.durationSeconds).filter((v): v is number => v !== null);

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
    totalSku: report.totalSku,
    startedAt: inicios[0] ?? null,
    finishedAt: fins.length > 0 ? fins[fins.length - 1] : null,
    countingSeconds: duracoes.length > 0 ? duracoes.reduce((a, b) => a + b, 0) : null,
    sessions,
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
