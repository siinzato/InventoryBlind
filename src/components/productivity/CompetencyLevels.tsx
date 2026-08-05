import { Panel, PanelSection, Badge } from '../ui';
import { CompetencyKey, CompetencyLevel } from '../../lib/productivityService';

interface CompetencyLevelsProps {
  levels: Record<CompetencyKey, CompetencyLevel>;
}

const COMPETENCY_LABEL: Record<CompetencyKey, string> = {
  inventario_cego: 'Inventário Cego',
  recontagem: 'Recontagem',
  organizacao_estoque: 'Organização de Estoque',
  full_manager: 'Full Manager',
  etiquetagem: 'Etiquetagem',
  conferencia: 'Conferência',
  acuracidade: 'Acuracidade',
  produtividade: 'Produtividade',
};

const LEVEL_BADGE: Record<CompetencyLevel, 'neutral' | 'accent' | 'warning' | 'success'> = {
  Iniciante: 'neutral',
  Intermediário: 'accent',
  Avançado: 'warning',
  Especialista: 'success',
};

const LEVEL_PROGRESS: Record<CompetencyLevel, number> = {
  Iniciante: 25,
  Intermediário: 50,
  Avançado: 75,
  Especialista: 100,
};

export function CompetencyLevels({ levels }: CompetencyLevelsProps) {
  return (
    <Panel>
      <PanelSection padding="md">
        <p className="text-section mb-3">Competências</p>
        <div className="space-y-3">
          {(Object.keys(levels) as CompetencyKey[]).map(key => (
            <div key={key} className="flex items-center gap-3">
              <span className="text-sm text-fg-muted w-44 flex-shrink-0 truncate">{COMPETENCY_LABEL[key]}</span>
              <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${LEVEL_PROGRESS[levels[key]]}%` }} />
              </div>
              <Badge variant={LEVEL_BADGE[levels[key]]} className="flex-shrink-0">{levels[key]}</Badge>
            </div>
          ))}
        </div>
      </PanelSection>
    </Panel>
  );
}
