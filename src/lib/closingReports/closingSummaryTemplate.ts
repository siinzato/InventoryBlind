// Montagem determinística do texto de resumo de fechamento — mesmo estilo de
// countManagementUtils.ts::generateCountInsight (template por concatenação,
// nunca texto gerado por IA/aleatório).

import type { CategoryCountSnapshot } from './closingReportTypes';

export interface ClosingSummaryInput {
  brandName: string;
  totalSku: number;
  skusContados: number;
  divergenciasEncontradas: number;
  divergenciasRecontadas: number;
  divergenciasReais: number;
  accuracyFinal: number | null;
  categoryCounts: CategoryCountSnapshot[];
  unclassifiedCount: number;
}

export function renderClosingSummary(input: ClosingSummaryInput): string {
  const lines: string[] = [];
  lines.push(`Resumo de fechamento — ${input.brandName}`);
  lines.push('');
  lines.push(`Foram concluídos ${input.skusContados} SKUs. Durante as contagens, foram identificados:`);
  lines.push('');

  const categoryLines = input.categoryCounts
    .filter(c => c.count > 0)
    .map(c => `- Problemas com ${c.name.toLowerCase()} — ${c.count} registro${c.count === 1 ? '' : 's'}`);
  lines.push(...categoryLines);

  if (input.unclassifiedCount > 0) {
    lines.push(`- Observações não classificadas — ${input.unclassifiedCount}`);
  }

  if (categoryLines.length === 0 && input.unclassifiedCount === 0) {
    lines.push('- Nenhuma observação registrada nas contagens deste ciclo.');
  }

  lines.push('');
  lines.push(
    `Divergências reais confirmadas: ${input.divergenciasReais}. ` +
      (input.accuracyFinal !== null ? `Acuracidade final: ${input.accuracyFinal.toFixed(1)}%.` : 'Acuracidade final: —.')
  );

  return lines.join('\n');
}
