// Fontes de saldo alimentadas por PLANILHA, dentro do mesmo modelo de conexão
// das integrações por API.
//
// Uma fonte por upload é uma `integration_connections` como qualquer outra — é
// o que dá a ela company_id/RLS, mapeamento (integration_entity_links), saldo
// normalizado (integration_stock_levels) e histórico (integration_sync_runs)
// sem infraestrutura paralela. O que ela NÃO tem é credencial, connector,
// cursor ou sincronização automática: o arquivo é a leitura.
//
// Essa diferença importa para as telas que hoje tratam "conexão" como
// "integração por API" (Integrações, Hub, Entidades Fiscais, canal de origem de
// devolução, cartões do Dashboard). Elas continuam vendo só as conexões de API
// porque `listConnections()` filtra por esta lista; a tela de Fonte de Saldo lê
// a própria conexão pelo provider_key.

export const TINY_STOCK_SHEET_PROVIDER_KEY = 'tiny_stock_sheet';

/** Providers cuja conexão é alimentada por upload de planilha. */
export const SHEET_SOURCE_PROVIDER_KEYS: readonly string[] = [TINY_STOCK_SHEET_PROVIDER_KEY];

export function isSheetSourceProvider(providerKey: string): boolean {
  return SHEET_SOURCE_PROVIDER_KEYS.includes(providerKey);
}
