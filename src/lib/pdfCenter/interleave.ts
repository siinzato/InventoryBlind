// Lógica pura de intercalação (A1,B1,A2,B2... / A1,B1,C1,A2,B2,C2... / blocos
// como "2 páginas de A para 1 de B"). Não sabe nada de PDF — recebe só
// contagens de página por documento e devolve a ordem final como pares
// (docKey, pageIndex 0-based). Quem monta o PDF de saída (pdfOps.ts) resolve
// cada par para a página real.

export interface InterleaveDocInput {
  key: string;
  pageCount: number;
}

export interface InterleaveConfig {
  /** Ordem de ciclo dos documentos, ex.: ['A','B'] ou ['A','B','C']. */
  order: string[];
  /** Páginas consumidas por documento em cada ciclo — default 1 para quem não
   *  aparecer aqui. Permite "2 de A para 1 de B": `{ A: 2, B: 1 }`. */
  blockSizes?: Record<string, number>;
  /** Documento que inicia a sequência — precisa estar em `order`. Default
   *  `order[0]`. */
  startDoc?: string;
  /** 'keep': continua emitindo os documentos que ainda têm página, pulando os
   *  esgotados, até todos acabarem. 'stopAtShortest': para assim que o
   *  primeiro documento do padrão esgota, sem começar um ciclo parcial. */
  leftover: 'keep' | 'stopAtShortest';
}

export interface InterleaveEntry {
  docKey: string;
  pageIndex: number;
}

export interface InterleaveResult {
  sequence: InterleaveEntry[];
  warnings: string[];
}

export function computeInterleaveOrder(docs: InterleaveDocInput[], config: InterleaveConfig): InterleaveResult {
  const warnings: string[] = [];
  const byKey = new Map(docs.map(d => [d.key, d]));

  const missing = config.order.filter(key => !byKey.has(key));
  if (missing.length > 0) {
    return { sequence: [], warnings: [`Documento(s) não encontrados no padrão: ${missing.join(', ')}.`] };
  }
  if (config.order.length === 0) {
    return { sequence: [], warnings: ['Nenhum documento no padrão de intercalação.'] };
  }

  const startIdx = config.startDoc ? config.order.indexOf(config.startDoc) : 0;
  if (startIdx < 0) {
    return { sequence: [], warnings: [`Documento inicial "${config.startDoc}" não está no padrão.`] };
  }
  const rotatedOrder = [...config.order.slice(startIdx), ...config.order.slice(0, startIdx)];

  const nextIndex = new Map<string, number>(docs.map(d => [d.key, 0]));
  const sequence: InterleaveEntry[] = [];

  const remaining = (key: string) => (byKey.get(key)?.pageCount ?? 0) - (nextIndex.get(key) ?? 0);
  const blockSizeOf = (key: string) => Math.max(1, config.blockSizes?.[key] ?? 1);

  const exhaustedDocs = new Set<string>();

  while (true) {
    if (config.leftover === 'stopAtShortest') {
      const someExhausted = rotatedOrder.some(key => remaining(key) < blockSizeOf(key));
      if (someExhausted) break;
    } else {
      const allExhausted = rotatedOrder.every(key => remaining(key) <= 0);
      if (allExhausted) break;
    }

    let emittedThisCycle = false;
    for (const key of rotatedOrder) {
      const block = blockSizeOf(key);
      const available = remaining(key);
      const take = config.leftover === 'stopAtShortest' ? block : Math.min(block, available);

      if (take <= 0) {
        if (!exhaustedDocs.has(key) && byKey.get(key)!.pageCount > 0) {
          exhaustedDocs.add(key);
          warnings.push(`"${key}" ficou sem páginas antes dos demais — restante continuou sem ele.`);
        }
        continue;
      }

      const startPage = nextIndex.get(key)!;
      for (let i = 0; i < take; i++) {
        sequence.push({ docKey: key, pageIndex: startPage + i });
      }
      nextIndex.set(key, startPage + take);
      emittedThisCycle = true;
    }

    if (!emittedThisCycle) break;
  }

  if (config.leftover === 'stopAtShortest') {
    const droppedDocs = rotatedOrder.filter(key => remaining(key) > 0);
    if (droppedDocs.length > 0) {
      const totalDropped = droppedDocs.reduce((sum, key) => sum + remaining(key), 0);
      warnings.push(`${totalDropped} página(s) restante(s) em ${droppedDocs.join(', ')} não foram incluídas (parar junto ao menor documento).`);
    }
  }

  return { sequence, warnings };
}
