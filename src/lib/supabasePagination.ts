// Leitura paginada do PostgREST.
//
// O problema que isto resolve não dá erro e não dá aviso: uma consulta sem
// `.range()` volta no máximo 1.000 linhas e parece completa. O catálogo desta
// base tem 4.628 produtos, então todo cálculo feito sobre "todos os produtos"
// estava rodando sobre 21,6% deles — e, nos recálculos de Confidence Score e
// de Risco, gravando o resultado truncado. As duas tabelas de score ficaram
// com exatamente 1.000 linhas, que foi como o teto se tornou visível.
//
// O padrão do laço veio de `abcCurve/abcCurveService.ts`, que já paginava —
// inclusive a exigência de ORDENAÇÃO ESTÁVEL: sem um critério de desempate
// determinístico, linhas empatadas podem repetir ou sumir na virada do bloco.
// Quem chama é responsável por ordenar; este módulo só percorre.
//
// O retorno é `{ rows, error }` de propósito, e não uma exceção: cada chamador
// já tratava o erro do Supabase do seu jeito (log e lista vazia, log e zero,
// etc.) e esse comportamento foi preservado.

/** Teto de linhas por resposta do PostgREST. Não é configuração nossa. */
export const SUPABASE_PAGE = 1000;

/** Trava de segurança: 500 blocos = 500 mil linhas. Nenhuma leitura de tela
 *  legítima chega perto disso; se chegar, é laço sem fim e precisa aparecer. */
const MAX_PAGES = 500;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Percorre a consulta em blocos de 1.000 até o fim.
 *
 * `build` recebe os limites do bloco e devolve a consulta já com `.range()`:
 *
 *     const { rows, error } = await fetchAllPages<{ id: string }>('CBC/products',
 *       (from, to) => supabase.from('products').select('id')
 *         .eq('company_id', companyId).order('id').range(from, to));
 *
 * O bloco incompleto encerra o laço — é o sinal de que a tabela acabou.
 *
 * `maxRows` é para quem JÁ tinha um teto proposital. Atenção: `.limit(2000)`
 * não entrega 2.000 — o teto do servidor corta em 1.000 antes, e era assim que
 * um limite deliberado virava um limite falso.
 */
export async function fetchAllPages<T>(
  label: string,
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  maxRows?: number
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * SUPABASE_PAGE;
    if (maxRows !== undefined && from >= maxRows) return { rows, error: null };
    const ate = maxRows !== undefined ? Math.min(from + SUPABASE_PAGE, maxRows) - 1 : from + SUPABASE_PAGE - 1;
    const { data, error } = await build(from, ate);
    // Erro no meio da leitura devolve o que já veio MAIS o erro: o chamador
    // decide se descarta. Entregar parcial silenciosamente seria repetir o bug.
    if (error) return { rows, error };
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < ate - from + 1) return { rows, error: null };
  }
  console.error(`[${label}] leitura paginada atingiu ${MAX_PAGES} blocos (${MAX_PAGES * SUPABASE_PAGE} linhas) e foi interrompida — verifique o filtro da consulta.`);
  return { rows, error: { message: `Leitura interrompida em ${MAX_PAGES * SUPABASE_PAGE} linhas.` } };
}
