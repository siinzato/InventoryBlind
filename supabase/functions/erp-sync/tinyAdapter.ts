// Tiny ERP adapter — implements ErpAdapter for the Tiny API (v3, OAuth2).
// Sem TINY_API_KEY configurado (nenhuma credencial real disponível ainda),
// cada ajuste retorna pending:true — nunca finge sucesso. O contrato
// (idempotência, payload, resposta) já está pronto; quando a credencial
// existir, basta configurar o secret e trocar o corpo de pushAdjustment por
// uma chamada fetch() real ao endpoint de ajuste de estoque do Tiny.
import type { ErpAdapter, ErpAdjustment, ErpAdjustmentResult } from '../../../src/lib/erp/erpAdapter.ts';

export class TinyErpAdapter implements ErpAdapter {
  readonly provider = 'tiny';

  async pushAdjustment(adjustment: ErpAdjustment): Promise<ErpAdjustmentResult> {
    const apiKey = Deno.env.get('TINY_API_KEY');
    const requestPayload = {
      sku: adjustment.sku,
      ean: adjustment.ean,
      quantidade: adjustment.finalQuantity,
      idempotencyKey: adjustment.idempotencyKey,
    };

    if (!apiKey) {
      return {
        itemId: adjustment.itemId,
        success: false,
        pending: true,
        errorMessage: 'Credenciais Tiny não configuradas nesta instância.',
        requestPayload,
        responsePayload: null,
      };
    }

    // Chamada real ao Tiny — pendente de credenciais reais para testar de
    // ponta a ponta (ver Pendências no plano). Estrutura pronta: só falta
    // apontar para o endpoint real de ajuste de estoque do Tiny API v3.
    try {
      const res = await fetch('https://api.tiny.com.br/api2/produto.alterar.estoque.php', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestPayload),
      });
      const responsePayload = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          itemId: adjustment.itemId,
          success: false,
          pending: false,
          errorMessage: `Tiny respondeu ${res.status}`,
          requestPayload,
          responsePayload,
        };
      }
      return {
        itemId: adjustment.itemId,
        success: true,
        pending: false,
        errorMessage: null,
        requestPayload,
        responsePayload,
      };
    } catch (err) {
      return {
        itemId: adjustment.itemId,
        success: false,
        pending: false,
        errorMessage: err instanceof Error ? err.message : 'Falha de rede ao chamar o Tiny',
        requestPayload,
        responsePayload: null,
      };
    }
  }
}
