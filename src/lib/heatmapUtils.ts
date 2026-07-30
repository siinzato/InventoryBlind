// Heatmap Utilities

import type { HeatmapArea, HeatmapStats, CriticalityLevel, HeatmapFilters, BrandData, RiskLevel, RiskDiagnosis } from './heatmapTypes';

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

// Get risk level color class
export const getRiskLevelColor = (level: RiskLevel): string => {
  switch (level) {
    case 'none': return 'bg-zinc-100 text-zinc-600 border-zinc-300';
    case 'low': return 'bg-emerald-100 text-emerald-700 border-emerald-300';
    case 'medium': return 'bg-amber-100 text-amber-700 border-amber-300';
    case 'high': return 'bg-orange-100 text-orange-700 border-orange-300';
    case 'critical': return 'bg-red-100 text-red-700 border-red-300';
  }
};

// Get risk bg gradient for cards
export const getRiskGradient = (level: RiskLevel): string => {
  switch (level) {
    case 'none': return 'bg-gradient-to-br from-zinc-50 to-zinc-100 border-zinc-200';
    case 'low': return 'bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-300';
    case 'medium': return 'bg-gradient-to-br from-amber-50 to-amber-100 border-amber-300';
    case 'high': return 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-300';
    case 'critical': return 'bg-gradient-to-br from-red-50 to-red-100 border-red-300';
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

// Get background color class based on criticality
export const getCriticalityBgClass = (level: CriticalityLevel): string => {
  switch (level) {
    case 'success': return 'bg-emerald-100 border-emerald-300';
    case 'warning': return 'bg-amber-100 border-amber-300';
    case 'danger': return 'bg-orange-100 border-orange-300';
    case 'critical': return 'bg-red-100 border-red-300';
    case 'neutral': return 'bg-zinc-100 border-zinc-300';
    default: return 'bg-zinc-100 border-zinc-300';
  }
};

// Get text color class based on criticality
export const getCriticalityTextClass = (level: CriticalityLevel): string => {
  switch (level) {
    case 'success': return 'text-emerald-700';
    case 'warning': return 'text-amber-700';
    case 'danger': return 'text-orange-700';
    case 'critical': return 'text-red-700';
    case 'neutral': return 'text-zinc-500';
    default: return 'text-zinc-700';
  }
};

// Get progress bar class
export const getProgressBgClass = (level: CriticalityLevel): string => {
  switch (level) {
    case 'success': return 'bg-emerald-500';
    case 'warning': return 'bg-amber-500';
    case 'danger': return 'bg-orange-500';
    case 'critical': return 'bg-red-500';
    case 'neutral': return 'bg-zinc-400';
    default: return 'bg-zinc-400';
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

// Generate mock heatmap data from brands
export const generateMockHeatmapData = (brands: BrandData[]): HeatmapArea[] => {
  return brands.map((brand, index) => {
    const concluidos = brand.done_sku;
    const totalSku = brand.total_sku;
    const divergencias = brand.divergences;
    const progresso = calculateProgress(concluidos, totalSku);
    const acuracidade = calculateAccuracy(concluidos, divergencias);

    const locaisFisicos: { id: string; nome: string; descricao: string }[] = [];

    // Generate mock physical locations based on brand
    const ruas = ['A', 'B', 'C', 'D'];
    const ruaBase = ruas[index % ruas.length];
    const vao = Math.floor(index / 2) + 1;

    const tipos = ['linha', 'rua', 'vao', 'setor', 'excesso'] as const;

    return {
      id: `area-${brand.id}`,
      nome: brand.brand,
      tipo: tipos[index % tipos.length],
      marcaId: brand.id,
      marcaNome: brand.brand,
      totalSku,
      concluidos,
      divergencias,
      acuracidade: parseFloat(acuracidade.toFixed(1)),
      progresso: parseFloat(progresso.toFixed(1)),
      responsavel: ['Ana', 'João', 'Maria', 'Carlos', 'Pedro', 'Lucia'][index % 6],
      ultimaAtualizacao: brand.updated_at || new Date().toISOString(),
      observacoes: '',
      produtosDivergentes: divergencias > 0
        ? Array(Math.min(divergencias, 5)).fill(0).map((_, i) => `SKU-${brand.brand.slice(0, 3).toUpperCase()}-${1000 + i}`)
        : [],
      locaisFisicos: locaisFisicos.length > 0 ? locaisFisicos : [
        { id: `lf-${brand.id}-1`, nome: `Rua ${ruaBase}`, descricao: `Corredor principal, vao ${vao}` },
        { id: `lf-${brand.id}-2`, nome: `Vão ${vao}`, descricao: `Altura: 3 prateleiras` },
        { id: `lf-${brand.id}-3`, nome: `Prateleira ${vao + 1}`, descricao: `Estoque de reserva` }
      ]
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
