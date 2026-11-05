// Transformar uma contagem divergente num ajuste para o ERP — só as regras.
//
// ── Por que este módulo existe ──────────────────────────────────────────────
// Contar não altera o saldo. O livro-razão já dizia isso e já alertava quando uma
// contagem divergente nunca virou ajuste, mas não oferecia saída nenhuma: quem via o
// alerta precisava sair da tela e refazer o raciocínio em outro lugar. Este módulo é
// a decisão que faltava — e é só a decisão. Nada aqui lê ou escreve no banco.
//
// ── O que ele NÃO faz ───────────────────────────────────────────────────────
// Não envia nada ao ERP. O envio tem dono há muito tempo: a Edge Function
// `integration-stock-write`, que relê o saldo real no provedor, passa pela guarda
// (`stockWriteGuard`) e recusa o que não sobreviver. Duplicar qualquer parte disso
// aqui criaria um segundo caminho de escrita sem guarda — exatamente o que o
// cabeçalho de `outboundStockWriter.ts` diz que não pode existir.
//
// ── Por que escrita absoluta ────────────────────────────────────────────────
// Uma contagem afirma um fato absoluto: há 47 peças na prateleira. É isso que vai
// ao ERP — "passe a ser 47" —, e não "tire 3". A diferença importa quando o saldo
// do ERP mudou entre contar e enviar: a ordem absoluta é conferida contra o saldo
// relido no provedor e a guarda recusa se eles não baterem, enquanto uma ordem por
// diferença seria aplicada por cima sem ninguém perceber. A logística reversa usa
// diferença porque lá o evento é conhecido (+N devolvidos); aqui não é.

import type { LedgerEntry } from './ledgerDomain';

/** Por que não dá para enviar. Código próprio em vez de só uma frase porque a tela
 *  precisa distinguir o que o usuário resolve (ligar a integração, vincular o
 *  produto) do que é só ausência de trabalho a fazer (contagem sem divergência). */
export type SendBlock =
  | { code: 'sem_divergencia' }
  | { code: 'numeros_incompletos' }
  | { code: 'sem_permissao' }
  | { code: 'sem_conexao' }
  | { code: 'produto_sem_vinculo' }
  | { code: 'deposito_sem_vinculo' };

export const BLOCK_MESSAGE: Record<SendBlock['code'], string> = {
  sem_divergencia:
    'Esta contagem bateu com o sistema. Não há ajuste a enviar.',
  numeros_incompletos:
    'Esta contagem não registrou o que o sistema marcava na época, então não dá para dizer ao ERP qual deve ser o saldo.',
  sem_permissao:
    'Enviar ajuste ao ERP é permitido a proprietário, administrador e gerente.',
  sem_conexao:
    'Nenhuma integração com ERP está ativa. O ajuste só pode ser enviado depois que a conexão estiver configurada.',
  produto_sem_vinculo:
    'Este produto ainda não está vinculado ao cadastro do ERP. Sem o vínculo, o ajuste iria para o item errado ou para nenhum.',
  deposito_sem_vinculo:
    'Nenhum depósito do ERP está vinculado. Sem saber em qual depósito escrever, o ajuste não é enviado.',
};

/** Onde o ajuste será escrito, do lado do ERP. Montado por quem lê o banco. */
export interface AdjustmentTarget {
  connectionId: string;
  connectionName: string;
  externalProductId: string | null;
  externalWarehouseId: string | null;
}

/** O ajuste proposto, pronto para virar linha em `integration_stock_adjustments`. */
export interface AdjustmentDraft {
  /** O que o sistema marcava quando a contagem aconteceu. */
  previousQuantity: number;
  /** O que foi contado na prateleira — e o que o ERP passará a registrar. */
  countedQuantity: number;
  /** Guardada, não derivada: é o que foi pedido, e se o provedor depois relatar
   *  outro número é preciso saber o que se pediu, não o que os números atuais
   *  sugerem. Mesma razão da coluna no banco. */
  deltaQuantity: number;
  /** Trava contra enviar duas vezes o mesmo ajuste ao ERP de um cliente — o
   *  duplicado mais caro do sistema inteiro. Derivada da chave do lançamento, que
   *  é o id da contagem: apertar o botão de novo encontra a linha que já existe em
   *  vez de criar outra. */
  idempotencyKey: string;
}

/** `contagem:<id>` e `inventario:<id>` já são únicos entre si e estáveis no tempo.
 *  O prefixo separa estes ajustes dos criados por outras origens, que usam o seu
 *  próprio (`return_item:<id>` na logística reversa). */
export function buildIdempotencyKey(entryKey: string): string {
  return `ledger_count:${entryKey}`;
}

/** Monta o ajuste a partir do lançamento de contagem. `null` quando o lançamento não
 *  carrega os dois números — o razão mostra contagens antigas sem snapshot do
 *  sistema, e inventar o saldo anterior seria pior do que não oferecer o botão. */
export function draftFromCount(entry: LedgerEntry): AdjustmentDraft | null {
  if (entry.source !== 'contagem' && entry.source !== 'inventario') return null;
  if (entry.quantity === null || entry.divergence === null) return null;
  if (!Number.isFinite(entry.quantity) || !Number.isFinite(entry.divergence)) return null;

  return {
    previousQuantity: entry.quantity - entry.divergence,
    countedQuantity: entry.quantity,
    deltaQuantity: entry.divergence,
    idempotencyKey: buildIdempotencyKey(entry.key),
  };
}

/** O primeiro impedimento, ou `null` se dá para enviar.
 *
 *  A ordem é a da pergunta que o usuário faz: primeiro se há trabalho (divergência),
 *  depois se ele pode fazê-lo, depois se o ERP está pronto para receber. Mostrar
 *  "produto sem vínculo" a quem nem tem permissão seria mandar resolver o problema
 *  errado. */
export function blockReason(
  entry: LedgerEntry | null,
  target: AdjustmentTarget | null,
  canSend: boolean
): SendBlock | null {
  if (!entry) return { code: 'sem_divergencia' };

  const draft = draftFromCount(entry);
  if (!draft) return { code: 'numeros_incompletos' };
  if (draft.deltaQuantity === 0) return { code: 'sem_divergencia' };

  if (!canSend) return { code: 'sem_permissao' };
  if (!target) return { code: 'sem_conexao' };
  if (!target.externalProductId) return { code: 'produto_sem_vinculo' };
  if (!target.externalWarehouseId) return { code: 'deposito_sem_vinculo' };
  return null;
}

/** A frase que descreve a ordem, na linguagem de quem aperta o botão. Fica no domínio
 *  e não na tela porque é a mesma frase gravada em `reason`, que o ERP guarda e um
 *  auditor lê meses depois — as duas precisam dizer a mesma coisa. */
export function describeDraft(draft: AdjustmentDraft): string {
  return `Ajuste de contagem física: de ${draft.previousQuantity} para ${draft.countedQuantity}.`;
}
