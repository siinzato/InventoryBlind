// Ponte entre a taxonomia canônica (product_brands / product_lines /
// product_brand_associations) e o resto do sistema.
//
// Duas responsabilidades, ambas mínimas e sem estado de domínio próprio:
//
//  1. `requestActiveCycleSync` — pede a reconciliação do inventário ativo REUTILIZANDO
//     `syncActiveCycleItems`. Não existe segunda implementação de sincronização aqui.
//     Chamadas em sequência (uma por produto revisado, por exemplo) são COALESCIDAS em
//     uma execução só: enquanto uma roda, as demais apenas marcam que é preciso repetir
//     ao final. Sem intervalo, sem polling.
//
//  2. `notifyTaxonomyChanged` — avisa quem mantém cópia desses dados em estado React
//     (hoje o App, que alimenta Dashboard e Ranking) de que é hora de reler. É um aviso
//     sem payload: quem escuta decide o que recarregar.
//
// Garantia importante: nunca cria inventário. Se a empresa não tem ciclo ativo, não há o
// que reconciliar e a função sai sem efeito — classificar produto não pode abrir um
// inventário por conta própria.

import { getActiveCycle, syncActiveCycleItems } from '../inventoryCycle/inventoryCycleService';

type Listener = () => void;

const listeners = new Set<Listener>();

/** Registra um ouvinte e devolve a função de cancelamento (padrão de `useEffect`). */
export function subscribeTaxonomyChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Um ouvinte que falha não impede os demais de serem avisados. */
export function notifyTaxonomyChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.error('[taxonomySync] ouvinte falhou:', err);
    }
  }
}

/** Execução em curso por empresa — a chave isola workspaces. */
const running = new Map<string, Promise<void>>();
/** Empresas que receberam novo pedido enquanto a sua sincronização rodava. */
const rerun = new Set<string>();

/**
 * Reconcilia o inventário ativo com a classificação atual dos produtos.
 *
 * Idempotente por construção: `syncActiveCycleItems` já preserva contagem, `counted_at`,
 * `counted_by`, observação e status de item contado, e o índice único
 * `(cycle_id, product_id)` impede SKU duplicado. Rodar duas vezes seguidas não muda nada.
 */
export async function requestActiveCycleSync(companyId: string, userId: string | null = null): Promise<void> {
  if (!companyId) return;

  const current = running.get(companyId);
  if (current) {
    // Já existe uma rodada em andamento: ela repetirá ao terminar, e quem chamou agora
    // espera o mesmo resultado. Uma sincronização, não uma por produto.
    rerun.add(companyId);
    return current;
  }

  const run = (async () => {
    try {
      do {
        rerun.delete(companyId);
        const cycle = await getActiveCycle(companyId);
        if (!cycle) return;
        await syncActiveCycleItems(companyId, userId);
      } while (rerun.has(companyId));
    } finally {
      running.delete(companyId);
      rerun.delete(companyId);
    }
  })();

  running.set(companyId, run);
  return run;
}
