// Cria o ajuste de contagem e entrega ao caminho de envio que já existe.
//
// ── A fronteira deste módulo ────────────────────────────────────────────────
// Ele faz duas coisas: descobre se o ERP está pronto para receber este produto, e
// grava a linha em `integration_stock_adjustments`. O envio em si é `runStockWrite`,
// que chama a Edge Function `integration-stock-write` — a única porta por onde um
// saldo muda dentro do ERP do cliente, porque é a única que relê o saldo real no
// provedor e passa pela guarda antes de escrever.
//
// Reaproveitar essa porta não é economia de código: um segundo caminho de escrita
// seria um caminho sem guarda, e a guarda é o que separa um engano de um galpão de
// pedidos cancelados.
//
// ── Por que o INSERT vem do cliente, sem migration ──────────────────────────
// A policy de INSERT de `integration_stock_adjustments` (migration 044) já autoriza
// exatamente owner/admin/manager, e `integration_entity_links` já é legível pela
// empresa. Não havia nada a mudar no banco — só faltava alguém usar.

import { supabase } from '../supabase';
import { runStockWrite } from '../integrations/integrationOperations';
import {
  BLOCK_MESSAGE, describeDraft, draftFromCount,
  type AdjustmentDraft, type AdjustmentTarget,
} from './adjustmentDomain';
import type { LedgerEntry } from './ledgerDomain';

/** Onde este produto cairia no ERP. `null` quando não há conexão ativa.
 *
 *  Os vínculos vêm separados em vez de um `ok: boolean` porque a tela precisa dizer
 *  QUAL vínculo falta: "vincule o produto" e "vincule um depósito" são dois
 *  trabalhos diferentes, em duas telas diferentes. */
export async function fetchAdjustmentTarget(
  companyId: string,
  productId: string
): Promise<AdjustmentTarget | null> {
  const { data: conexao, error } = await supabase
    .from('integration_connections')
    .select('id, display_name')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!conexao) return null;

  const [{ data: produto }, { data: deposito }] = await Promise.all([
    supabase.from('integration_entity_links').select('external_id')
      .eq('connection_id', conexao.id).eq('entity_type', 'product')
      .eq('internal_id', productId).limit(1).maybeSingle(),
    // O primeiro depósito vinculado, pela mesma ordem que a logística reversa usa.
    // Escolher outro critério aqui faria dois ajustes do mesmo produto irem para
    // depósitos diferentes dependendo de qual tela os criou.
    supabase.from('integration_entity_links').select('external_id')
      .eq('connection_id', conexao.id).eq('entity_type', 'warehouse')
      .order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ]);

  return {
    connectionId: conexao.id as string,
    connectionName: (conexao.display_name as string) ?? 'ERP',
    externalProductId: (produto?.external_id as string) ?? null,
    externalWarehouseId: (deposito?.external_id as string) ?? null,
  };
}

export interface SendResult {
  /** `true` quando o ERP aceitou. `false` cobre recusa da guarda e falha de
   *  comunicação — a frase em `message` distingue as duas. */
  ok: boolean;
  message: string;
  /** O ajuste existe no banco mesmo quando o envio não passou. É isso que permite
   *  reenviar depois pela fila de Integrações, em vez de recontar. */
  adjustmentId: string | null;
  /** O ajuste já existia: o botão foi apertado de novo, ou a contagem já tinha sido
   *  enviada antes. Não é erro, e a tela diz isso com outras palavras. */
  jaExistia: boolean;
}

/** Procura o ajuste desta contagem. A chave de idempotência é derivada do id da
 *  contagem, então ela responde "esta contagem específica já virou ajuste?" — e é
 *  a mesma trava UNIQUE do banco que impede o duplicado caro. */
async function acharExistente(idempotencyKey: string): Promise<{ id: string; status: string } | null> {
  const { data, error } = await supabase
    .from('integration_stock_adjustments')
    .select('id, sync_status')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, status: (data.sync_status as string) ?? '' } : null;
}

async function criar(
  companyId: string,
  productId: string,
  sku: string,
  draft: AdjustmentDraft,
  target: AdjustmentTarget
): Promise<string> {
  const { data, error } = await supabase
    .from('integration_stock_adjustments')
    .insert({
      company_id: companyId,
      connection_id: target.connectionId,
      product_id: productId,
      external_product_id: target.externalProductId,
      sku,
      external_warehouse_id: target.externalWarehouseId,
      origin: 'physical_count',
      previous_quantity: draft.previousQuantity,
      counted_quantity: draft.countedQuantity,
      delta_quantity: draft.deltaQuantity,
      // Absoluta: a contagem afirma quantas peças existem, e é esse número que o ERP
      // passa a registrar. Ver o cabeçalho de adjustmentDomain.ts.
      write_kind: 'absolute',
      movement_reason: 'count_adjustment',
      reason: describeDraft(draft),
      // Quem aperta o botão já é owner/admin/manager — a mesma lista que a policy de
      // INSERT exige. Pedir uma segunda aprovação da mesma pessoa seria cerimônia,
      // não controle. É o que a logística reversa já faz.
      approved_at: new Date().toISOString(),
      sync_status: 'pending',
      idempotency_key: draft.idempotencyKey,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Cria o ajuste (se ainda não existir) e manda enviar.
 *
 *  Recusa da guarda e falha de rede voltam como `ok: false` com a frase do envio, em
 *  vez de exceção: o ajuste ficou gravado nos dois casos, e tratar isso como falha
 *  total faria a tela sugerir recontar o produto sem necessidade. */
export async function sendCountAdjustment(params: {
  companyId: string;
  productId: string;
  sku: string;
  entry: LedgerEntry;
  target: AdjustmentTarget;
}): Promise<SendResult> {
  const draft = draftFromCount(params.entry);
  if (!draft) {
    return { ok: false, message: BLOCK_MESSAGE.numeros_incompletos, adjustmentId: null, jaExistia: false };
  }

  const existente = await acharExistente(draft.idempotencyKey);
  const jaExistia = existente !== null;

  // Já confirmado pelo ERP: reenviar seria pedir ao provedor que escrevesse de novo
  // um saldo que ele já tem. A trava UNIQUE pararia o duplicado, mas parar antes é
  // mais honesto com quem apertou o botão.
  if (existente && (existente.status === 'confirmed' || existente.status === 'sent')) {
    return {
      ok: true,
      message: 'Esta contagem já tinha sido enviada ao ERP. Nada foi enviado de novo.',
      adjustmentId: existente.id,
      jaExistia: true,
    };
  }

  const adjustmentId = existente
    ? existente.id
    : await criar(params.companyId, params.productId, params.sku, draft, params.target);

  const resultado = await runStockWrite(params.target.connectionId, { adjustmentIds: [adjustmentId] });

  if (resultado.ok && resultado.sent > 0) {
    return {
      ok: true,
      message: `Ajuste enviado: o saldo no ${params.target.connectionName} passa a ser ${draft.countedQuantity}.`,
      adjustmentId,
      jaExistia,
    };
  }

  // Recusado pela guarda, ou falhou na comunicação. A frase do envio é mais
  // específica do que qualquer texto genérico daqui — ela diz qual regra barrou.
  //
  // Sem mencionar a fila: quem exibe esta frase acrescenta essa parte, e dizer as
  // duas coisas aqui produziria "o ajuste foi registrado... o ajuste fica
  // registrado" na tela.
  return {
    ok: false,
    message: resultado.message ?? 'O ERP não aceitou o ajuste agora.',
    adjustmentId,
    jaExistia,
  };
}
