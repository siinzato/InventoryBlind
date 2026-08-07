// Auditoria Cruzada — cálculo puro sobre inventory_count_records (021_count_management.sql)
// + approved_by/approved_at (034_inventory_audit.sql). Reconstrói a cadeia contagem→
// recontagem→aprovação e sinaliza quando a mesma pessoa acumula mais de uma etapa, sem
// nenhuma tabela nova além das 2 colunas já migradas.
//
// Duas fontes de identidade são comparadas, por serem independentes uma da outra:
// - created_by (uuid do usuário logado que registrou o lançamento no sistema)
// - operator_1 (nome digitado livremente do operador físico que contou)
// Uma supervisora pode logar e registrar por vários operadores físicos diferentes, então só
// o cruzamento das duas dá sinal confiável de sobreposição de papéis.

import type { InventoryCountRecord } from './supabase';

function sameIdentity(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface CountChain {
  rootId: string;
  brandId: string;
  createdAt: string;
  contadorUserId: string | null;
  contadorName: string | null;
  hasRecount: boolean;
  recontadorUserId: string | null;
  recontadorName: string | null;
  isApproved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  sameUserCountAndRecount: boolean;
  sameOperatorNameCountAndRecount: boolean;
  sameUserCountAndApproval: boolean;
  independent: boolean;
}

/** Agrupa os registros em cadeias (1 contagem raiz + suas recontagens ligadas por
 *  linked_count_id) e calcula os sinais de sobreposição de papel por cadeia. */
export function buildCountChains(records: InventoryCountRecord[]): CountChain[] {
  const roots = records.filter(r => r.linked_count_id === null);
  const byLinked = new Map<string, InventoryCountRecord[]>();
  for (const r of records) {
    if (!r.linked_count_id) continue;
    const list = byLinked.get(r.linked_count_id) ?? [];
    list.push(r);
    byLinked.set(r.linked_count_id, list);
  }

  return roots.map(root => {
    const recounts = (byLinked.get(root.id) ?? []).sort((a, b) => b.count_number - a.count_number);
    const lastRecount = recounts[0] ?? null;

    const sameUserCountAndRecount = !!lastRecount && sameIdentity(root.created_by, lastRecount.created_by);
    const sameOperatorNameCountAndRecount = !!lastRecount && sameIdentity(root.operator_1, lastRecount.operator_1);
    const approverRef = root.approved_by ?? lastRecount?.approved_by ?? null;
    const sameUserCountAndApproval = sameIdentity(root.created_by, approverRef) || (!!lastRecount && sameIdentity(lastRecount.created_by, approverRef));

    return {
      rootId: root.id,
      brandId: root.brand_id,
      createdAt: root.created_at,
      contadorUserId: root.created_by,
      contadorName: root.operator_1,
      hasRecount: !!lastRecount,
      recontadorUserId: lastRecount?.created_by ?? null,
      recontadorName: lastRecount?.operator_1 ?? null,
      isApproved: !!approverRef,
      approvedBy: approverRef,
      approvedAt: root.approved_at ?? lastRecount?.approved_at ?? null,
      sameUserCountAndRecount,
      sameOperatorNameCountAndRecount,
      sameUserCountAndApproval,
      independent: !!lastRecount && !sameUserCountAndRecount && !sameOperatorNameCountAndRecount && !sameUserCountAndApproval,
    };
  });
}

export interface CrossCheckSummary {
  totalChains: number;
  chainsWithRecount: number;
  pctRecontagens: number;
  chainsIndependentAmongRecounted: number;
  pctAuditoriasIndependentes: number;
  chainsApproved: number;
  pctAprovadas: number;
  reliabilityIndex: number;
}

/** Índice de confiabilidade: média ponderada dos 3 indicadores pedidos — independência pesa
 *  mais (é o sinal antifraude direto), cobertura de recontagem em seguida, aprovação por
 *  último (é a etapa mais nova, ainda opcional no fluxo). Heurística simples e documentada,
 *  pronta para ser recalibrada quando houver dados suficientes para validar os pesos. */
export function computeCrossCheckSummary(chains: CountChain[]): CrossCheckSummary {
  const totalChains = chains.length;
  const withRecount = chains.filter(c => c.hasRecount);
  const chainsWithRecount = withRecount.length;
  const chainsIndependentAmongRecounted = withRecount.filter(c => c.independent).length;
  const chainsApproved = chains.filter(c => c.isApproved).length;

  const pctRecontagens = totalChains > 0 ? (chainsWithRecount / totalChains) * 100 : 0;
  const pctAuditoriasIndependentes = chainsWithRecount > 0 ? (chainsIndependentAmongRecounted / chainsWithRecount) * 100 : 0;
  const pctAprovadas = totalChains > 0 ? (chainsApproved / totalChains) * 100 : 0;

  const reliabilityIndex = totalChains > 0
    ? pctAuditoriasIndependentes * 0.5 + pctRecontagens * 0.3 + pctAprovadas * 0.2
    : 0;

  return {
    totalChains, chainsWithRecount, pctRecontagens,
    chainsIndependentAmongRecounted, pctAuditoriasIndependentes,
    chainsApproved, pctAprovadas, reliabilityIndex,
  };
}
