import { describe, expect, it } from 'vitest';
import {
  AGENT_BLUEPRINTS,
  agentStatus,
  buildAgentWorkflow,
  findAgentAutomation,
  templateForBlueprint,
} from '../agents';
import { validateWorkflow } from '../workflow';
import type { Automation } from '../types';

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    companyId: 'c1',
    name: 'Agente de Divergências',
    description: null,
    status: 'draft',
    triggerType: 'count.item_counted',
    workflow: { nodes: [], edges: [] },
    version: 1,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastExecutedAt: null,
    executionCount: 0,
    ...overrides,
  };
}

describe('agents — cada blueprint nativo reaproveita um template real, sem duplicar lógica', () => {
  it('todo AGENT_BLUEPRINTS aponta para um AUTOMATION_TEMPLATES existente', () => {
    for (const blueprint of AGENT_BLUEPRINTS) {
      expect(() => templateForBlueprint(blueprint)).not.toThrow();
    }
  });

  it('o workflow construído por cada agente passa na validação atual do engine', () => {
    for (const blueprint of AGENT_BLUEPRINTS) {
      const workflow = buildAgentWorkflow(blueprint);
      expect(validateWorkflow(workflow).valid).toBe(true);
    }
  });

  it('o agente de recontagem herda a proteção contra loop do template (countNumber === 1)', () => {
    const blueprint = AGENT_BLUEPRINTS.find(b => b.key === 'recontagem')!;
    const workflow = buildAgentWorkflow(blueprint);
    const condition = workflow.nodes.find(n => n.type === 'condition');
    expect(condition && 'rules' in condition ? condition.rules : []).toContainEqual(
      expect.objectContaining({ field: 'trigger.session.countNumber', operator: 'equals', value: 1 })
    );
  });
});

describe('findAgentAutomation', () => {
  it('encontra por nome exato, ignorando maiúsculas e espaços nas pontas', () => {
    const blueprint = AGENT_BLUEPRINTS[0];
    const match = findAgentAutomation(blueprint, [automation({ name: `  ${blueprint.name.toUpperCase()}  ` })]);
    expect(match).not.toBeNull();
  });

  it('não confunde uma automação comum com um agente nativo', () => {
    const blueprint = AGENT_BLUEPRINTS[0];
    const match = findAgentAutomation(blueprint, [automation({ name: 'Minha automação qualquer' })]);
    expect(match).toBeNull();
  });
});

describe('agentStatus — nunca inventa um status fora do que a automação já tem', () => {
  it('active → Ativo, draft/inactive → Inativo, error → Atenção', () => {
    expect(agentStatus(automation({ status: 'active' }))).toBe('active');
    expect(agentStatus(automation({ status: 'draft' }))).toBe('inactive');
    expect(agentStatus(automation({ status: 'inactive' }))).toBe('inactive');
    expect(agentStatus(automation({ status: 'error' }))).toBe('attention');
  });
});
