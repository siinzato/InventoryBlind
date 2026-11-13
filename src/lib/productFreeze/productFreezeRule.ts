// Regra de reconciliação entre o catálogo e a fonte de saldo.
//
// Nasceu de uma pergunta concreta: por que a coluna "Saldo" sai em branco na
// folha de contagem impressa? Porque o produto não tem saldo no snapshot da
// fonte — e a célula vazia é lida pelo operador como "conte e escreva aqui",
// não como "este produto não existe mais".
//
// ── A distinção que muda tudo ────────────────────────────────────────────────
// Célula em branco tem DUAS causas, e tratá-las igual seria o erro caro:
//
//   `sumiu_da_fonte`  — o produto JÁ veio da fonte em alguma importação (tem
//                       vínculo gravado) e não veio na mais recente. É um fato
//                       observado: estava, deixou de estar. É esta a situação
//                       que justifica sugerir congelamento.
//
//   `nunca_veio`      — o produto nunca foi associado a nenhum registro da
//                       fonte. Pode ter sido excluído do ERP antes da primeira
//                       importação, pode ser cadastro só do InventoryBlind, ou
//                       pode ser falha de correspondência de SKU. O sistema NÃO
//                       sabe qual, e sugerir exclusão sobre essa incerteza seria
//                       apagar cadastro por falta de informação — o mesmo erro
//                       que a classe ABC ausente causava no risco.
//
// Por isso a regra devolve as duas categorias separadas e nomeadas. Quem chama
// decide o que fazer com cada uma; o que ela não faz é fundi-las.
//
// Módulo puro: sem I/O, sem Supabase. As leituras ficam no serviço.

/** Uma linha do catálogo confrontada com o snapshot da fonte. */
export interface ReconciliationInput {
  productId: string;
  sku: string;
  name: string;
  /** Já existe vínculo gravado com algum registro da fonte (de qualquer
   *  importação). Ausente = o produto nunca foi associado. */
  hasSourceLink: boolean;
  /** Quando a fonte foi vista com saldo para este produto, em ISO. `null` quando
   *  não há saldo nenhum registrado. */
  lastObservedAt: string | null;
  /** Já está congelado — não entra de novo na sugestão. */
  frozenAt: string | null;
}

export type ReconciliationStatus = 'presente' | 'sumiu_da_fonte' | 'nunca_veio' | 'congelado';

export interface ReconciliationRow extends ReconciliationInput {
  status: ReconciliationStatus;
  /** Dias desde a última vez que a fonte trouxe este produto. `null` para quem
   *  nunca veio — não há "desde quando" de algo que nunca aconteceu. */
  diasSemFonte: number | null;
}

export interface ReconciliationResult {
  /** Candidatos ao congelamento: vieram da fonte e pararam de vir. Ordenados do
   *  mais antigo para o mais recente — quem sumiu há mais tempo primeiro. */
  sumiramDaFonte: ReconciliationRow[];
  /** Nunca associados. Separados de propósito: NÃO são candidatos automáticos. */
  nuncaVieram: ReconciliationRow[];
  presentes: number;
  congelados: number;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function diasEntre(deISO: string, ateISO: string): number | null {
  const de = Date.parse(deISO);
  const ate = Date.parse(ateISO);
  if (!Number.isFinite(de) || !Number.isFinite(ate)) return null;
  return Math.max(0, Math.floor((ate - de) / MS_POR_DIA));
}

/**
 * Confronta o catálogo com o snapshot vigente da fonte.
 *
 * `snapshotObservedAt` é o instante da importação MAIS RECENTE. É ele que define
 * "não veio desta vez": o saldo de quem veio foi reescrito com esse instante, e
 * o de quem não veio ficou com o instante anterior. A importação não apaga a
 * linha de quem sumiu — por isso comparar por data, e não por ausência de linha,
 * é o que distingue "sumiu" de "nunca existiu".
 */
export function reconcileAgainstSource(
  rows: readonly ReconciliationInput[],
  snapshotObservedAt: string | null,
): ReconciliationResult {
  const sumiramDaFonte: ReconciliationRow[] = [];
  const nuncaVieram: ReconciliationRow[] = [];
  let presentes = 0;
  let congelados = 0;

  // Sem nenhuma importação concluída não há com o que confrontar. Devolver tudo
  // como "sumiu" aqui seria sugerir congelar o catálogo inteiro por falta de
  // dado — exatamente o contrário do que a ausência de dado significa.
  if (!snapshotObservedAt) {
    for (const row of rows) {
      if (row.frozenAt) congelados++;
      else presentes++;
    }
    return { sumiramDaFonte: [], nuncaVieram: [], presentes, congelados };
  }

  const limite = Date.parse(snapshotObservedAt);

  for (const row of rows) {
    if (row.frozenAt) {
      congelados++;
      continue;
    }

    if (!row.hasSourceLink) {
      nuncaVieram.push({ ...row, status: 'nunca_veio', diasSemFonte: null });
      continue;
    }

    const visto = row.lastObservedAt ? Date.parse(row.lastObservedAt) : NaN;

    // Vínculo sem saldo nenhum: veio da fonte um dia (o vínculo é prova disso),
    // mas não há snapshot de saldo. Conta como sumido, sem "desde quando".
    if (!Number.isFinite(visto)) {
      sumiramDaFonte.push({ ...row, status: 'sumiu_da_fonte', diasSemFonte: null });
      continue;
    }

    if (visto < limite) {
      sumiramDaFonte.push({
        ...row,
        status: 'sumiu_da_fonte',
        diasSemFonte: row.lastObservedAt ? diasEntre(row.lastObservedAt, snapshotObservedAt) : null,
      });
      continue;
    }

    presentes++;
  }

  // Mais tempo sem aparecer primeiro. `null` (sem data) vai ao topo: é o caso
  // com menos informação e o que mais merece olho humano.
  sumiramDaFonte.sort((a, b) => (b.diasSemFonte ?? Infinity) - (a.diasSemFonte ?? Infinity));
  nuncaVieram.sort((a, b) => a.sku.localeCompare(b.sku));

  return { sumiramDaFonte, nuncaVieram, presentes, congelados };
}
