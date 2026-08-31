// BlindAI — motor de situações operacionais do painel do Dashboard. Mesmo espírito de
// warehouseInsightsEngine.ts (Warehouse Digital Twin): nenhum score é recalculado aqui,
// só lido dos módulos que já o calculam (Risco, Confidence, ABC/XYZ, RCA) e ranqueado em
// cards "o que está acontecendo → por quê → o que fazer". Diferente do motor do Twin, este
// não é 100% puro porque orquestra a busca cross-módulo ele mesmo — o volume de chamadas é
// pequeno (5 leituras já existentes, em paralelo) e não justifica um arquivo de serviço
// separado só para um Promise.all.

import { getCompanyRiskSummary, getRiskBandMigrations } from './riskService';
import { getCompanySummary as getCbcCompanySummary } from './cbcService';
import { getMatrixCounts } from './abcXyzService';
import { listRecords as listRcaRecords } from './rcaService';
import { computeParetoBuckets, groupByDimension, CAUSE_LABEL } from './rcaAlgorithm';
import type { BlindAISituation } from './supabase';

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export async function getBlindAISituations(companyId: string): Promise<BlindAISituation[]> {
  const since90d = new Date(Date.now() - 90 * 86400000).toISOString();

  const [riskSummary, riskMigrations, cbcSummary, abcXyzMatrix, rcaRecords] = await Promise.all([
    getCompanyRiskSummary(companyId),
    getRiskBandMigrations(companyId),
    getCbcCompanySummary(companyId),
    getMatrixCounts(companyId),
    listRcaRecords(companyId, { from: since90d }),
  ]);

  const situations: BlindAISituation[] = [];

  // ⚠️ Risco crítico concentrado
  if (riskSummary && riskSummary.total_scored > 0) {
    const criticalPct = pct(riskSummary.critico_count, riskSummary.total_scored);
    if (riskSummary.critico_count >= 3 || criticalPct >= 15) {
      situations.push({
        id: 'risk-critical-concentration',
        icon: '⚠️',
        severity: criticalPct >= 30 ? 'critical' : 'warning',
        title: 'Risco crítico concentrado',
        evidence: `${riskSummary.critico_count} produto${riskSummary.critico_count === 1 ? '' : 's'} em risco crítico — ${criticalPct}% do total avaliado`,
        reasons: [
          `Risco médio da empresa: ${riskSummary.avg_risk != null ? Math.round(riskSummary.avg_risk) : '—'}`,
          `${riskSummary.alto_count} produto${riskSummary.alto_count === 1 ? '' : 's'} também em risco alto`,
        ],
        recommendation: 'Priorizar recontagem dos itens em risco crítico antes dos demais.',
        module: 'risk',
        actionLabel: 'Ver Inventário por Risco',
      });
    }
  }

  // ⚠️ Piora de risco (migração de faixa)
  const worsened = riskMigrations.filter(m => m.direction === 'up');
  if (worsened.length >= 3) {
    situations.push({
      id: 'risk-worsening-trend',
      icon: '⚠️',
      severity: worsened.length >= 10 ? 'critical' : 'warning',
      title: 'Piora de risco detectada',
      evidence: `${worsened.length} produtos migraram para uma faixa de risco pior desde o último recômputo`,
      reasons: ['Comparação entre as duas últimas atualizações de risco de cada produto'],
      recommendation: 'Revisar os produtos que pioraram de faixa e priorizar recontagem.',
      module: 'risk',
      actionLabel: 'Ver Inventário por Risco',
    });
  }

  // 🎯 Contagens de confiança em atraso
  if (cbcSummary && cbcSummary.overdue_count > 0) {
    situations.push({
      id: 'cbc-overdue',
      icon: '🎯',
      severity: cbcSummary.overdue_count >= 10 ? 'critical' : 'warning',
      title: 'Contagens em atraso',
      evidence: `${cbcSummary.overdue_count} produto${cbcSummary.overdue_count === 1 ? '' : 's'} passaram da data recomendada de próxima contagem`,
      reasons: [
        ...(cbcSummary.avg_confidence != null ? [`Confiança média da empresa: ${Math.round(cbcSummary.avg_confidence)}`] : []),
        `${cbcSummary.critico_count} produto${cbcSummary.critico_count === 1 ? '' : 's'} em confiança crítica`,
      ],
      recommendation: 'Agendar recontagem destes produtos para restaurar a confiança do saldo.',
      module: 'cbc',
      actionLabel: 'Ver Confidence Score',
    });
  }

  // 📊 Alto valor + baixa previsibilidade (classe AZ)
  const totalClassified = Object.values(abcXyzMatrix).reduce((sum, c) => sum + c.count, 0);
  if (abcXyzMatrix.AZ.count >= 3) {
    const azPct = pct(abcXyzMatrix.AZ.count, totalClassified);
    situations.push({
      id: 'abcxyz-az-concentration',
      icon: '📊',
      severity: azPct >= 15 ? 'critical' : 'warning',
      title: 'Itens de alto valor e baixa previsibilidade',
      evidence: `${abcXyzMatrix.AZ.count} SKUs classificados como A/Z (alto valor, demanda instável) — ${azPct}% do catálogo classificado`,
      reasons: [
        'Alto valor movimentado combinado com maior variação de demanda',
        'Maior exposição a divergência e ruptura de estoque',
      ],
      recommendation: 'Priorizar auditoria e contagem cíclica frequente destes SKUs.',
      module: 'abcxyz',
      actionLabel: 'Ver Classificação ABC/XYZ',
    });
  }

  // 🔥 Padrão de causa predominante (RCA)
  if (rcaRecords.length >= 5) {
    const paretoBuckets = computeParetoBuckets(rcaRecords);
    const top = paretoBuckets[0];
    if (top && top.pctOfTotal >= 25) {
      situations.push({
        id: 'rca-top-cause-pattern',
        icon: '🔥',
        severity: top.pctOfTotal >= 45 ? 'critical' : 'warning',
        title: 'Padrão de divergência identificado',
        evidence: `${CAUSE_LABEL[top.category]} concentra ${Math.round(top.pctOfTotal)}% das divergências registradas nos últimos 90 dias`,
        reasons: [`${top.count} de ${rcaRecords.length} registros de causa analisados`],
        recommendation: 'Investigar a causa raiz predominante antes de agir sobre os demais casos.',
        module: 'rca',
        actionLabel: 'Ver Root Cause Analysis',
      });
    }

    // 🔥 Concentração em poucos SKUs
    const skuBuckets = groupByDimension(rcaRecords, 'sku').filter(b => b.key !== 'sem-sku');
    const topSkus = skuBuckets.slice(0, 7);
    const topSkusCount = topSkus.reduce((sum, b) => sum + b.count, 0);
    const topSkusPct = pct(topSkusCount, rcaRecords.length);
    if (topSkus.length >= 3 && topSkusPct >= 30) {
      situations.push({
        id: 'rca-sku-concentration',
        icon: '🔥',
        severity: topSkusPct >= 55 ? 'critical' : 'warning',
        title: 'Divergências concentradas em poucos SKUs',
        evidence: `${topSkus.length} SKUs concentram ${topSkusPct}% das divergências registradas nos últimos 90 dias`,
        reasons: topSkus.slice(0, 3).map(b => `${b.label}: ${b.count} ocorrência${b.count === 1 ? '' : 's'}`),
        recommendation: 'Priorizar recontagem e investigação destes SKUs específicos.',
        module: 'rca',
        actionLabel: 'Ver Root Cause Analysis',
      });
    }

    // 📈 Aumento de divergências na última semana
    const last7 = rcaRecords.filter(r => Date.now() - new Date(r.occurred_at).getTime() <= 7 * 86400000).length;
    const prev7 = rcaRecords.filter(r => {
      const age = Date.now() - new Date(r.occurred_at).getTime();
      return age > 7 * 86400000 && age <= 14 * 86400000;
    }).length;
    if (prev7 >= 3 && last7 > prev7) {
      const increasePct = pct(last7 - prev7, prev7);
      if (increasePct >= 30) {
        situations.push({
          id: 'rca-weekly-increase',
          icon: '📈',
          severity: increasePct >= 80 ? 'critical' : 'warning',
          title: 'Aumento de divergências na última semana',
          evidence: `${last7} divergências nos últimos 7 dias, ${increasePct}% acima da semana anterior (${prev7})`,
          reasons: ['Comparação entre os registros de causa dos últimos 7 e dos 7 dias anteriores'],
          recommendation: 'Verificar se alguma mudança recente de processo ou operador explica o aumento.',
          module: 'rca',
          actionLabel: 'Ver Root Cause Analysis',
        });
      }
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 };
  return situations.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 6);
}
