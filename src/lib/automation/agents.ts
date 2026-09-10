// Agentes — camada de negócio sobre o motor de automações já existente.
//
// Um "Agente" NÃO é uma entidade nova no banco: é um AUTOMATION_TEMPLATES já
// existente, reapresentado com nome/objetivo/escopo de negócio. Criar um agente
// chama exatamente `template.build()` + `createAutomation()`, os mesmos usados
// pela aba Templates — nada fica marcado como "agente" no banco, e uma
// automação de agente é indistinguível de uma montada à mão (mesma garantia que
// os templates já davam, ver comentário no topo de templates.ts).
//
// Identidade: um agente "instalado" é reconhecido por NOME exato (sem
// distinguir maiúsculas/espaços) contra a lista de automações já carregada —
// mesma ausência de tabela extra que o resto do módulo já aceita para
// templates. Renomear a automação faz ela deixar de aparecer como o agente
// nativo correspondente; é um efeito aceito, não um bug.
//
// Só dois agentes nativos têm gatilho com fonte real de evento E ação
// compatível já validados pelo registry: Divergências (count.item_counted) e
// Recontagem (count.session_finalized, com a mesma proteção contra loop que o
// template 'auto_recount' já implementa via countNumber===1 + a proteção de
// profundidade do próprio engine). Risco, Produtividade e Auditoria foram
// avaliados e NÃO têm hoje nenhum emissor real de evento (nenhuma migration
// depois da 054 chama `automation_emit_event` a partir desses módulos) — ver
// relatório da tarefa.

import { findTemplate, type AutomationTemplate } from './templates';
import { validateWorkflow } from './workflow';
import type { Automation, AutomationWorkflow } from './types';

export interface AgentBlueprint {
  key: string;
  name: string;
  /** O que o agente monitora/decide, em uma frase de negócio. */
  objective: string;
  /** Campos/critério que ele avalia, em uma frase de negócio. */
  scope: string;
  templateKey: string;
}

export const AGENT_BLUEPRINTS: AgentBlueprint[] = [
  {
    key: 'divergencias',
    name: 'Agente de Divergências',
    objective: 'Monitorar divergências relevantes entre a contagem física e o saldo do ERP.',
    scope: 'Item contado com divergência percentual acima do limite configurado.',
    templateKey: 'critical_divergence',
  },
  {
    key: 'recontagem',
    name: 'Agente de Recontagem',
    objective: 'Decidir automaticamente quando uma nova contagem é necessária.',
    scope: 'Contagem finalizada com percentual de itens divergentes acima do limite — protegido contra reagir à própria recontagem que criou.',
    templateKey: 'auto_recount',
  },
];

export function templateForBlueprint(blueprint: AgentBlueprint): AutomationTemplate {
  const template = findTemplate(blueprint.templateKey);
  if (template == null) throw new Error(`Template "${blueprint.templateKey}" não encontrado para o agente "${blueprint.name}".`);
  return template;
}

export function buildAgentWorkflow(blueprint: AgentBlueprint, threshold?: number): AutomationWorkflow {
  return templateForBlueprint(blueprint).build({ threshold });
}

/** Automação instalada para este agente, se houver — por nome exato
 *  (case-insensitive, sem espaços nas pontas). */
export function findAgentAutomation(blueprint: AgentBlueprint, automations: Automation[]): Automation | null {
  const target = blueprint.name.trim().toLowerCase();
  return automations.find(a => a.name.trim().toLowerCase() === target) ?? null;
}

export type AgentStatus = 'active' | 'inactive' | 'attention';

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  attention: 'Atenção',
};

/** Status do agente é o status real da automação — 'error' (workflow ficou
 *  inválido enquanto ativa) é o único caso que vira "Atenção"; nunca calculado
 *  à parte da automação de verdade. */
export function agentStatus(automation: Automation): AgentStatus {
  if (automation.status === 'error') return 'attention';
  if (automation.status === 'active') return 'active';
  return 'inactive';
}

export function agentIsValid(automation: Automation): boolean {
  return validateWorkflow(automation.workflow).valid;
}
