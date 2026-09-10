// Heatmap Utilities

import type { HeatmapArea, HeatmapStats, CriticalityLevel, HeatmapFilters, BrandData, RiskLevel, RiskDiagnosis } from './heatmapTypes';
import type { BrandCountDetail } from './heatmapService';

// Calculate progress percentage
export const calculateProgress = (concluidos: number, totalSku: number): number => {
  if (totalSku === 0) return 0;
  return (concluidos / totalSku) * 100;
};

// Calculate accuracy percentage
export const calculateAccuracy = (concluidos: number, divergencias: number): number => {
  if (concluidos === 0) return 0;
  return ((concluidos - divergencias) / concluidos) * 100;
};

// Calculate pending SKUs
export const calculatePending = (totalSku: number, concluidos: number): number => {
  return totalSku - concluidos;
};

// Calculate risk score (0-100+)
export const calculateRiskScore = (area: HeatmapArea): number => {
  if (area.progresso === 0) return 0; // Não iniciado = sem risco calculado

  const divergenciasScore = area.divergencias * 2;
  const acuracidadeScore = (100 - area.acuracidade) * 1.5;
  const progressoScore = (100 - area.progresso) * 0.5;

  return Math.min(100, Math.round(divergenciasScore + acuracidadeScore + progressoScore));
};

// Get risk level based on score
export const getRiskLevel = (score: number): RiskLevel => {
  if (score === 0) return 'none';
  if (score <= 30) return 'low';
  if (score <= 60) return 'medium';
  if (score <= 80) return 'high';
  return 'critical';
};

// Get risk level label
export const getRiskLevelLabel = (level: RiskLevel): string => {
  switch (level) {
    case 'none': return 'Não avaliado';
    case 'low': return 'Baixo risco';
    case 'medium': return 'Risco médio';
    case 'high': return 'Alto risco';
    case 'critical': return 'Risco crítico';
  }
};

// Get risk level color class. Só as cores semânticas aprovadas (§5/§23) — antes
// "high" usava laranja, fora da paleta. Mesmo mapeamento de RiskBadge.tsx
// (crítico=danger/vermelho, alto=warning/âmbar, médio=accent/azul, baixo=
// success/verde), que já resolve um problema equivalente de 4 níveis sem
// precisar de uma 5ª cor.
export const getRiskLevelColor = (level: RiskLevel): string => {
  switch (level) {
    case 'none': return 'bg-surface-3 text-fg-muted border-edge';
    case 'low': return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30';
    case 'medium': return 'bg-accent/10 text-accent border-accent/30';
    case 'high': return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30';
    case 'critical': return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30';
  }
};

/** Risk surface for heatmap cards. Flat tint, not a gradient: the hue already
 *  encodes the risk level, so a gradient added no information and read as
 *  decoration. Border tints are kept subtler than the badge scale above so the
 *  card body stays calm while the badge carries the signal. */
export const getRiskGradient = (level: RiskLevel): string => {
  switch (level) {
    case 'none': return 'bg-surface-2 border-edge';
    case 'low': return 'bg-emerald-500/[0.07] border-emerald-500/20';
    case 'medium': return 'bg-accent/[0.07] border-accent/20';
    case 'high': return 'bg-amber-500/[0.07] border-amber-500/20';
    case 'critical': return 'bg-red-500/[0.07] border-red-500/25';
  }
};

// Generate automatic diagnosis
export const generateDiagnosis = (area: HeatmapArea): RiskDiagnosis => {
  const issues: string[] = [];
  const factors: { name: string; impact: 'alta' | 'média' | 'baixa'; value: string }[] = [];
  let recommendation = '';

  // Check accuracy
  if (area.acuracidade < 50) {
    issues.push('Acuracidade crítica');
    factors.push({ name: 'Acuracidade', impact: 'alta', value: `${area.acuracidade.toFixed(1)}%` });
  } else if (area.acuracidade < 70) {
    issues.push('Acuracidade abaixo do ideal');
    factors.push({ name: 'Acuracidade', impact: 'média', value: `${area.acuracidade.toFixed(1)}%` });
  } else if (area.acuracidade < 90) {
    factors.push({ name: 'Acuracidade', impact: 'baixa', value: `${area.acuracidade.toFixed(1)}%` });
  }

  // Check divergences
  if (area.divergencias > 20) {
    issues.push('Muitas divergências');
    factors.push({ name: 'Divergências', impact: 'alta', value: `${area.divergencias}` });
  } else if (area.divergencias > 10) {
    issues.push('Divergências significativas');
    factors.push({ name: 'Divergências', impact: 'média', value: `${area.divergencias}` });
  } else if (area.divergencias > 0) {
    factors.push({ name: 'Divergências', impact: 'baixa', value: `${area.divergencias}` });
  }

  // Check progress
  const pending = calculatePending(area.totalSku, area.concluidos);
  if (area.progresso < 30 && area.progresso > 0) {
    issues.push('Progresso lento');
    factors.push({ name: 'Progresso', impact: 'média', value: `${area.progresso.toFixed(1)}%` });
  } else if (area.progresso < 70 && area.progresso >= 30) {
    factors.push({ name: 'Progresso', impact: 'baixa', value: `${area.progresso.toFixed(1)}%` });
  }

  // Generate recommendation
  const score = calculateRiskScore(area);
  const riskLevel = getRiskLevel(score);

  if (riskLevel === 'critical') {
    recommendation = `A área "${area.nome}" está em situação crítica. Ação imediata necessária: pare a contagem atual, investigue as causas das ${area.divergencias} divergências, realize recontagem completa e revise o processo de contagem com a equipe.`;
  } else if (riskLevel === 'high') {
    recommendation = `A área "${area.nome}" requer atenção prioritária. Recomenda-se: investigar as principais divergências, realizar recontagem seletiva dos itens com problemas e reforçar a equipe nesta área.`;
  } else if (riskLevel === 'medium') {
    recommendation = `A área "${area.nome}" precisa de atenção. Sugerimos: revisar os produtos divergentes, investigar padrões de erro e monitorar a evolução da acuracidade.`;
  } else if (riskLevel === 'low') {
    recommendation = `A área "${area.nome}" está em bom estado. Continue monitorando e mantenha o padrão atual de trabalho.`;
  } else {
    recommendation = `A área "${area.nome}" ainda não foi iniciada. Planeje a contagem e designe um responsável.`;
  }

  // Suggested actions
  const actions: string[] = [];
  if (area.divergencias > 10) {
    actions.push('Recontagem obrigatória');
  }
  if (area.acuracidade < 70) {
    actions.push('Auditoria do processo');
  }
  if (area.progresso < 50 && area.progresso > 0) {
    actions.push('Reforço de equipe');
  }
  if (area.progresso === 0) {
    actions.push('Iniciar contagem');
  }
  if (actions.length === 0) {
    actions.push('Monitoramento contínuo');
  }

  return {
    riskScore: score,
    riskLevel,
    issues,
    factors,
    recommendation,
    suggestedActions: actions,
  };
};

// Get top critical areas
export const getTopCriticalAreas = (areas: HeatmapArea[], limit: number = 5): HeatmapArea[] => {
  return areas
    .filter(a => a.progresso > 0)
    .map(a => ({ ...a, riskScore: calculateRiskScore(a) }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, limit);
};

// Determine criticality level based on accuracy and divergences
export const getCriticalityLevel = (area: HeatmapArea): CriticalityLevel => {
  const score = calculateRiskScore(area);
  const level = getRiskLevel(score);

  // Map risk level to criticality for backward compatibility
  switch (level) {
    case 'critical':
    case 'high':
      return 'critical';
    case 'medium':
      return 'danger';
    case 'low':
      return 'warning';
    case 'none':
    default:
      if (area.progresso === 0) return 'neutral';
      return 'success';
  }
};

// Get background color class based on criticality. "danger" (risco médio,
// abaixo de "critical") agrupado com "warning" em âmbar — laranja não é uma
// cor aprovada (§5/§23), e reservar o vermelho só para "critical" (o nível
// mais grave) preserva a distinção que mais importa: o pior caso continua
// visualmente único.
export const getCriticalityBgClass = (level: CriticalityLevel): string => {
  switch (level) {
    case 'success': return 'bg-emerald-500/10 border-emerald-500/30';
    case 'warning': return 'bg-amber-500/10 border-amber-500/30';
    case 'danger': return 'bg-amber-500/10 border-amber-500/30';
    case 'critical': return 'bg-red-500/10 border-red-500/30';
    case 'neutral': return 'bg-surface-3 border-edge';
    default: return 'bg-surface-3 border-edge';
  }
};

// Get text color class based on criticality
export const getCriticalityTextClass = (level: CriticalityLevel): string => {
  switch (level) {
    case 'success': return 'text-emerald-700 dark:text-emerald-400';
    case 'warning': return 'text-amber-700 dark:text-amber-400';
    case 'danger': return 'text-amber-700 dark:text-amber-400';
    case 'critical': return 'text-red-700 dark:text-red-400';
    case 'neutral': return 'text-fg-muted';
    default: return 'text-fg-muted';
  }
};

// Get progress bar class
export const getProgressBgClass = (level: CriticalityLevel): string => {
  switch (level) {
    case 'success': return 'bg-emerald-500';
    case 'warning': return 'bg-amber-500';
    case 'danger': return 'bg-amber-500';
    case 'critical': return 'bg-red-500';
    case 'neutral': return 'bg-fg-subtle';
    default: return 'bg-fg-subtle';
  }
};

// Filter heatmap areas
export const filterHeatmapAreas = (areas: HeatmapArea[], filters: HeatmapFilters): HeatmapArea[] => {
  let filtered = [...areas];

  // Search filter
  if (filters.busca) {
    const search = filters.busca.toLowerCase();
    filtered = filtered.filter(area =>
      area.nome.toLowerCase().includes(search) ||
      area.marcaNome?.toLowerCase().includes(search) ||
      area.responsavel.toLowerCase().includes(search)
    );
  }

  // Status filter
  if (filters.status !== 'all') {
    filtered = filtered.filter(area => {
      if (filters.status === 'concluido') return area.progresso === 100;
      if (filters.status === 'andamento') return area.progresso > 0 && area.progresso < 100;
      if (filters.status === 'pendente') return area.progresso === 0;
      return true;
    });
  }

  // Brand filter
  if (filters.marca) {
    filtered = filtered.filter(area => area.marcaId === filters.marca);
  }

  // Criticality filter
  if (filters.criticidade !== 'all') {
    filtered = filtered.filter(area => getCriticalityLevel(area) === filters.criticidade);
  }

  // Sorting
  filtered.sort((a, b) => {
    switch (filters.ordenacao) {
      case 'divergencia_desc':
        return b.divergencias - a.divergencias;
      case 'acuracidade_asc':
        return a.acuracidade - b.acuracidade;
      case 'progresso_desc':
        return b.progresso - a.progresso;
      case 'risk_desc':
        return calculateRiskScore(b) - calculateRiskScore(a);
      case 'nome':
      default:
        return a.nome.localeCompare(b.nome);
    }
  });

  return filtered;
};

// Calculate heatmap statistics
export const calculateHeatmapStats = (areas: HeatmapArea[]): HeatmapStats => {
  const totalAreas = areas.length;
  const areasCriticas = areas.filter(a => {
    const score = calculateRiskScore(a);
    const level = getRiskLevel(score);
    return level === 'critical' || level === 'high';
  }).length;
  const areasSaudaveis = areas.filter(a => {
    const score = calculateRiskScore(a);
    return getRiskLevel(score) === 'low';
  }).length;
  const areasNaoIniciadas = areas.filter(a => a.progresso === 0).length;

  // Find highest risk area
  const areasWithProgress = areas.filter(a => a.progresso > 0);
  let maiorPontoRisco: string | null = null;
  if (areasWithProgress.length > 0) {
    const sorted = [...areasWithProgress].sort((a, b) => calculateRiskScore(b) - calculateRiskScore(a));
    if (sorted[0] && calculateRiskScore(sorted[0]) >= 60) {
      maiorPontoRisco = sorted[0].nome;
    }
  }

  const totalDivergencias = areas.reduce((sum, a) => sum + a.divergencias, 0);
  const avgAreas = areas.filter(a => a.progresso > 0);
  const mediaAcuracidade = avgAreas.length > 0
    ? avgAreas.reduce((sum, a) => sum + a.acuracidade, 0) / avgAreas.length
    : 0;

  // Calculate average risk score
  const mediaGeracaoRisco = avgAreas.length > 0
    ? avgAreas.reduce((sum, a) => sum + calculateRiskScore(a), 0) / avgAreas.length
    : 0;

  // Areas marked for recount
  const areasParaRecontagem = areas.filter(a => a.marcadoRecontagem).length;

  return {
    areasCriticas,
    areasSaudaveis,
    areasNaoIniciadas,
    maiorPontoRisco,
    mediaAcuracidade,
    totalAreas,
    totalDivergencias,
    mediaGeracaoRisco,
    areasParaRecontagem,
  };
};

/** Monta as áreas do heatmap a partir das marcas reais.
 *
 *  Substituiu generateMockHeatmapData, que fabricava responsável, SKUs divergentes e
 *  locais físicos a partir do ÍNDICE da marca no array — nomes de uma lista fixa
 *  (Ana/João/Maria…), SKUs `SKU-ABC-1000` e endereços `Rua A / Vão 2` que nunca
 *  existiram no banco. As métricas sempre foram reais; o que estava inventado era a
 *  atribuição ao redor delas, que é justamente o que alguém usa para decidir com quem
 *  falar e onde ir recontar.
 *
 *  `details` vem de heatmapService.getBrandCountDetails. Marca sem contagem registrada
 *  fica com os campos vazios — a tela já trata isso ("Não definido", listas escondidas),
 *  que é a leitura correta de "ainda não foi contado". */
export const buildHeatmapAreas = (
  brands: BrandData[],
  details?: Map<string, BrandCountDetail>
): HeatmapArea[] => {
  return brands.map(brand => {
    const concluidos = brand.done_sku;
    const totalSku = brand.total_sku;
    const divergencias = brand.divergences;
    const progresso = calculateProgress(concluidos, totalSku);
    const acuracidade = calculateAccuracy(concluidos, divergencias);
    const detail = details?.get(brand.id);

    return {
      id: `area-${brand.id}`,
      nome: brand.brand,
      // Uma área do heatmap é uma MARCA, não um endereço do armazém. O tipo ciclava
      // entre linha/rua/vão/setor/excesso pelo índice, o que rotulava a mesma marca de
      // forma diferente só por ter mudado de posição na lista.
      tipo: 'setor',
      marcaId: brand.id,
      marcaNome: brand.brand,
      totalSku,
      concluidos,
      divergencias,
      acuracidade: parseFloat(acuracidade.toFixed(1)),
      progresso: parseFloat(progresso.toFixed(1)),
      responsavel: detail?.responsavel ?? '',
      ultimaAtualizacao: detail?.ultimaAtualizacao || brand.updated_at || '',
      observacoes: detail?.observacoes ?? '',
      produtosDivergentes: detail?.produtosDivergentes ?? [],
      locaisFisicos: detail?.locaisFisicos ?? [],
    };
  });
};

// Format date for display
export const formatDateTime = (dateStr: string): string => {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'N/A';
  }
};
