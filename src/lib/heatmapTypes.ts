// Heatmap Types

export type AreaType = 'linha' | 'rua' | 'vao' | 'setor' | 'excesso';

export type CriticalityLevel = 'success' | 'warning' | 'danger' | 'critical' | 'neutral';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export type ViewMode = 'grid' | 'list' | 'ranking';

export type StatusFilter = 'all' | 'concluido' | 'andamento' | 'pendente';

export type SortOption = 'divergencia_desc' | 'acuracidade_asc' | 'progresso_desc' | 'nome' | 'risk_desc';

export interface RiskFactor {
  name: string;
  impact: 'alta' | 'média' | 'baixa';
  value: string;
}

export interface RiskDiagnosis {
  riskScore: number;
  riskLevel: RiskLevel;
  issues: string[];
  factors: RiskFactor[];
  recommendation: string;
  suggestedActions: string[];
}

export interface HeatmapArea {
  id: string;
  nome: string;
  tipo: AreaType;
  marcaId?: string;
  marcaNome?: string;
  totalSku: number;
  concluidos: number;
  divergencias: number;
  acuracidade: number;
  progresso: number;
  responsavel: string;
  ultimaAtualizacao: string;
  observacoes: string;
  produtosDivergentes: string[];
  locaisFisicos: LocalFisico[];
  marcadoRecontagem?: boolean;
}

export interface LocalFisico {
  id: string;
  nome: string;
  descricao: string;
}

export interface HeatmapFilters {
  status: StatusFilter;
  marca: string;
  criticidade: CriticalityLevel | 'all';
  ordenacao: SortOption;
  busca: string;
}

export interface HeatmapStats {
  areasCriticas: number;
  areasSaudaveis: number;
  areasNaoIniciadas: number;
  maiorPontoRisco: string | null;
  mediaAcuracidade: number;
  totalAreas: number;
  totalDivergencias: number;
  mediaGeracaoRisco: number;
  areasParaRecontagem: number;
}
