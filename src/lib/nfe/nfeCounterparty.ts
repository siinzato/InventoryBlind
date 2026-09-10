// Identifica a contraparte de uma NF-e comparando o CNPJ do workspace contra
// emitente/destinatário — nunca por razão social. Pura: recebe os CNPJs já
// resolvidos (fiscal_entities) e os dados já parseados do XML.

import { normalizeCnpj } from '../fiscalEntities/cnpjUtils';

export interface NfeCounterpartySource {
  supplierName: string | null;
  supplierCnpj: string | null;
  destName: string | null;
  destCnpj: string | null;
  destCpf: string | null;
}

export type NfeCounterpartyRole = 'emit' | 'dest' | 'unknown';

export interface NfeCounterparty {
  name: string | null;
  cnpj: string | null;
  cpf: string | null;
  /** 'emit': o workspace é o destinatário, a contraparte é o emitente.
   *  'dest': o workspace é o emitente, a contraparte é o destinatário.
   *  'unknown': não foi possível confirmar com os CNPJs cadastrados no
   *  workspace — o resultado ainda é o melhor palpite (emitente), mas não
   *  deve ser exibido como confirmado. */
  role: NfeCounterpartyRole;
}

/**
 * @param workspaceCnpjs CNPJs normalizados (14 dígitos) das empresas fiscais
 *   ativas do workspace. Uma lista vazia (nenhuma empresa cadastrada) sempre
 *   resulta em 'unknown' — a comparação nunca é inventada sem dado real.
 */
export function resolveNfeCounterparty(
  parsed: NfeCounterpartySource,
  workspaceCnpjs: string[],
): NfeCounterparty {
  const normEmit = normalizeCnpj(parsed.supplierCnpj ?? '');
  const normDest = normalizeCnpj(parsed.destCnpj ?? '');
  const normWorkspaceCnpjs = new Set(workspaceCnpjs.map(normalizeCnpj));
  const isWorkspaceEmit = normEmit.length === 14 && normWorkspaceCnpjs.has(normEmit);
  const isWorkspaceDest = normDest.length === 14 && normWorkspaceCnpjs.has(normDest);

  if (isWorkspaceDest && !isWorkspaceEmit) {
    return { name: parsed.supplierName, cnpj: parsed.supplierCnpj, cpf: null, role: 'emit' };
  }
  if (isWorkspaceEmit && !isWorkspaceDest) {
    return { name: parsed.destName, cnpj: parsed.destCnpj, cpf: parsed.destCpf, role: 'dest' };
  }
  return { name: parsed.supplierName, cnpj: parsed.supplierCnpj, cpf: null, role: 'unknown' };
}
