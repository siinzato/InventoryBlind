// Resolvedor de canal de origem da devolução — puro e determinístico.
//
// Reaproveita a mesma entidade já usada pela tela de Integrações como "conta
// de canal" (IntegrationConnection: provider_key + external_account_id +
// fiscal_entity_id) — não existe cadastro de pedidos nem tabela nova aqui.
//
// Nunca decide por nome de produto, nome de cliente, razão social ou texto
// livre da NF-e. O único identificador estrutural usado para casar uma conta
// de canal é intermediaryIdCadIntTran (grupo infIntermed da NF-e) contra
// IntegrationConnection.externalAccountId — o CNPJ do intermediador sozinho
// não distingue contas diferentes do mesmo intermediador (ex.: várias contas
// Mercado Livre sob o mesmo CNPJ), então só é devolvido como evidência bruta,
// nunca usado para filtrar.

import type { IntegrationConnection } from '../integrations/types';
import type { ParsedNfe } from '../nfe/nfeTypes';

export type OriginChannelSource = 'confirmada' | 'mapeada' | 'manual' | 'ambigua' | 'nao_identificada';

export interface OriginChannelResult {
  connection: IntegrationConnection | null;
  source: OriginChannelSource;
  /** idCadIntTran usado no match, quando houve. */
  externalIdentifierUsed: string | null;
  /** Evidência bruta do intermediador, só para exibição — nunca usada no match. */
  intermediaryCnpj: string | null;
  /** Quando ambígua: as conexões candidatas, para o usuário escolher. */
  candidates: IntegrationConnection[];
}

function normalizeIdentifier(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.toUpperCase();
}

/** Só as evidências relevantes do XML — nunca o objeto inteiro, para deixar
 *  explícito no tipo que produto/cliente/razão social nunca entram aqui. */
export type OriginChannelEvidence = Pick<ParsedNfe, 'intermediaryCnpj' | 'intermediaryIdCadIntTran'>;

export function resolveOriginChannel(
  evidence: OriginChannelEvidence,
  activeConnections: IntegrationConnection[],
): OriginChannelResult {
  const idCadIntTran = normalizeIdentifier(evidence.intermediaryIdCadIntTran);
  const intermediaryCnpj = evidence.intermediaryCnpj;

  if (idCadIntTran) {
    const matches = activeConnections.filter(
      c => normalizeIdentifier(c.externalAccountId) === idCadIntTran
    );
    if (matches.length === 1) {
      return {
        connection: matches[0],
        source: 'mapeada',
        externalIdentifierUsed: idCadIntTran,
        intermediaryCnpj,
        candidates: [],
      };
    }
    if (matches.length > 1) {
      return {
        connection: null,
        source: 'ambigua',
        externalIdentifierUsed: idCadIntTran,
        intermediaryCnpj,
        candidates: matches,
      };
    }
  }

  return {
    connection: null,
    source: 'nao_identificada',
    externalIdentifierUsed: idCadIntTran,
    intermediaryCnpj,
    candidates: [],
  };
}

/** Rótulo de exibição do resultado, no vocabulário pedido — nunca um pill
 *  colorido genérico, o chamador decide a apresentação visual. */
export function describeOriginChannel(
  result: OriginChannelResult,
  providerName: (providerKey: string) => string,
): string {
  if (!result.connection) return 'Canal não identificado';
  const label = `${providerName(result.connection.providerKey)} — ${result.connection.displayName}`;
  switch (result.source) {
    case 'confirmada':
      return `${label} — informado pela integração`;
    case 'mapeada':
      return `${label} — identificado pelo intermediador`;
    default:
      return label;
  }
}
