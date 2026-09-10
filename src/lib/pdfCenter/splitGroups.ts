// Lógica pura de divisão/extração (spec §5) — decide QUAIS páginas vão para
// CADA arquivo de saída. Não toca em pdf-lib; `pdfLibOps.ts` só percorre os
// grupos aqui calculados e monta um PDF por grupo.

export type SplitMode = 'extract' | 'removeSelection' | 'onePerFile' | 'everyN' | 'oddEven';

export interface SplitParams {
  /** 0-based, usado por 'extract' e 'removeSelection'. */
  selectedIndices?: number[];
  /** usado por 'everyN'. */
  everyN?: number;
}

export interface SplitGroupsResult {
  /** Cada item é um arquivo de saída: lista ordenada de índices 0-based. */
  groups: number[][];
  warnings: string[];
}

export function computeSplitGroups(totalPages: number, mode: SplitMode, params: SplitParams = {}): SplitGroupsResult {
  if (totalPages <= 0) return { groups: [], warnings: ['O documento não tem páginas.'] };

  const all = Array.from({ length: totalPages }, (_, i) => i);

  switch (mode) {
    case 'extract': {
      const indices = params.selectedIndices ?? [];
      if (indices.length === 0) return { groups: [], warnings: ['Nenhuma página selecionada para extrair.'] };
      return { groups: [indices], warnings: [] };
    }

    case 'removeSelection': {
      const excluded = new Set(params.selectedIndices ?? []);
      if (excluded.size === 0) return { groups: [all], warnings: ['Nenhuma página selecionada para remover — o restante é o documento inteiro.'] };
      const remaining = all.filter(i => !excluded.has(i));
      if (remaining.length === 0) return { groups: [], warnings: ['Todas as páginas foram selecionadas para remoção — não sobrou nenhuma página.'] };
      return { groups: [remaining], warnings: [] };
    }

    case 'onePerFile':
      return { groups: all.map(i => [i]), warnings: [] };

    case 'everyN': {
      const n = Math.max(1, Math.floor(params.everyN ?? 1));
      const groups: number[][] = [];
      for (let i = 0; i < totalPages; i += n) groups.push(all.slice(i, i + n));
      return { groups, warnings: [] };
    }

    case 'oddEven': {
      // 0-based par = página ímpar (1ª, 3ª...) na numeração que o usuário vê.
      const odd = all.filter(i => i % 2 === 0);
      const even = all.filter(i => i % 2 === 1);
      const groups = even.length > 0 ? [odd, even] : [odd];
      return { groups, warnings: even.length === 0 ? ['O documento só tem páginas ímpares.'] : [] };
    }

    default:
      return { groups: [], warnings: ['Modo de divisão desconhecido.'] };
  }
}
