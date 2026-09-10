import { Panel } from '@xyflow/react';
import { AlertTriangle, Check } from 'lucide-react';
import type { AutomationWorkflow } from '../../../lib/automation/types';
import type { ValidationProblem } from '../../../lib/automation/workflow';

interface Props {
  workflow: AutomationWorkflow;
  problems: ValidationProblem[];
  valid: boolean;
}

/** Resumo do fluxo — tudo derivado do workflow e da validação já existentes,
 *  nada novo é calculado ou persistido (§9). Vive dentro do canvas (Panel do
 *  React Flow), ao lado da barra de ferramentas. */
export function FlowStatusBar({ workflow, problems, valid }: Props) {
  const conditions = workflow.nodes.filter(n => n.type === 'condition' || n.type === 'branch' || n.type === 'switch').length;
  const actions = workflow.nodes.filter(n => n.type === 'action' || n.type === 'agent').length;
  const triggers = workflow.nodes.filter(n => n.type === 'trigger').length;
  const errors = problems.filter(p => p.severity === 'error').length;
  const warnings = problems.filter(p => p.severity === 'warning').length;

  return (
    <Panel position="top-left">
      <div className="flex items-center gap-3 rounded-container border border-edge bg-surface-2 px-3 py-1.5 text-xs text-fg-muted shadow-panel">
        <span className={`flex items-center gap-1 font-medium ${valid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {valid ? <Check size={12} /> : <AlertTriangle size={12} />}
          {valid ? 'Fluxo válido' : 'Fluxo inválido'}
        </span>
        <span className="h-3 w-px bg-edge" />
        <span>{triggers} gatilho{triggers === 1 ? '' : 's'}</span>
        <span>{conditions} condição(ões)</span>
        <span>{actions} ação(ões)</span>
        {errors > 0 && <span className="text-red-600 dark:text-red-400">{errors} erro{errors === 1 ? '' : 's'}</span>}
        {warnings > 0 && <span className="text-amber-600 dark:text-amber-400">{warnings} aviso(s)</span>}
      </div>
    </Panel>
  );
}
