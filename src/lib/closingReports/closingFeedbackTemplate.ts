// Feedback de fechamento — template FIXO e determinístico. Mesma entrada, mesmo texto:
// nenhuma IA, nenhuma chamada externa, nenhuma variação por horário ou aleatoriedade.
//
// O texto documenta o RESULTADO OPERACIONAL do fechamento. Por decisão de produto ele
// nunca avalia a pessoa: não há juízo de desempenho, culpa, advertência, punição nem
// recomendação sobre o vínculo do funcionário — só os números e as ocorrências que já
// estão registradas no fechamento.

import { CLOSING_METRIC_ROWS, formatClosingDateTime, type ClosingDocument } from './closingDocumentModel';

export interface ClosingFeedbackInput {
  employeeName: string;
  role?: string;
  managerNote?: string;
}

const NOT_INFORMED = 'Não informado';

export function renderClosingFeedback(doc: ClosingDocument, input: ClosingFeedbackInput): string {
  const role = input.role?.trim() ? input.role.trim() : NOT_INFORMED;
  const note = input.managerNote?.trim() ? input.managerNote.trim() : 'Nenhuma observação complementar registrada.';

  const lines: string[] = [];

  lines.push('FEEDBACK DE FECHAMENTO DE INVENTÁRIO');
  lines.push('');
  lines.push(`Responsável: ${input.employeeName.trim()}`);
  lines.push(`Cargo/Função: ${role}`);
  lines.push(`Linha/Marca: ${doc.brandName}`);
  lines.push(`Fechamento: ${formatClosingDateTime(doc.closedAt)}`);
  lines.push('');
  lines.push('RESULTADOS DO FECHAMENTO');
  lines.push('');
  for (const row of CLOSING_METRIC_ROWS) {
    lines.push(`${row.label}: ${row.value(doc.metrics)}`);
  }
  lines.push('');
  lines.push('OCORRÊNCIAS REGISTRADAS');
  lines.push('');
  if (doc.categories.length === 0 && doc.unclassifiedObservations.length === 0) {
    lines.push('Nenhuma ocorrência registrada nas contagens deste fechamento.');
  } else {
    for (const category of doc.categories) {
      lines.push(`${category.name} — ${category.count} ${category.count === 1 ? 'registro' : 'registros'}`);
    }
    if (doc.unclassifiedObservations.length > 0) {
      const n = doc.unclassifiedObservations.length;
      lines.push(`Observações não classificadas — ${n} ${n === 1 ? 'registro' : 'registros'}`);
    }
  }
  lines.push('');
  lines.push('OBSERVAÇÃO DO GESTOR');
  lines.push('');
  lines.push(note);
  lines.push('');
  lines.push('CONCLUSÃO');
  lines.push('');
  lines.push(
    `Este feedback registra formalmente os resultados observados no fechamento da linha ${doc.brandName}, ` +
    'conforme dados consolidados pelo InventoryBlind.'
  );
  lines.push('');
  lines.push(
    'Os indicadores e ocorrências refletem exclusivamente os registros existentes no fechamento analisado.'
  );

  return lines.join('\n');
}
