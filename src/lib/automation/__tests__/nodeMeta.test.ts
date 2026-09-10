import { describe, expect, it } from 'vitest';
import { describeNodeDetails } from '../nodeMeta';
import type { ActionNode, BranchNode, ConditionNode, LoopNode } from '../types';

describe('describeNodeDetails — resumo do node no canvas (§6)', () => {
  it('mostra campo/operador/valor reais de uma condição', () => {
    const node: ConditionNode = {
      id: 'c1', type: 'condition', logic: 'AND',
      rules: [{ field: 'trigger.count.variancePercentage', operator: 'greater_than', value: 10 }],
    };
    const lines = describeNodeDetails(node, 'count.item_counted');
    expect(lines).toEqual(['Divergência percentual do item maior que 10']);
  });

  it('branch usa o mesmo resumo de condition (mesma avaliação, saídas diferentes)', () => {
    const node: BranchNode = {
      id: 'b1', type: 'branch', logic: 'AND',
      rules: [{ field: 'trigger.count.variancePercentage', operator: 'greater_than', value: 10 }],
    };
    expect(describeNodeDetails(node, 'count.item_counted')).toEqual(['Divergência percentual do item maior que 10']);
  });

  it('nunca inventa uma condição quando não há regras configuradas', () => {
    const node: ConditionNode = { id: 'c1', type: 'condition', logic: 'AND', rules: [] };
    expect(describeNodeDetails(node, 'count.item_counted')).toEqual([]);
  });

  it('mostra apenas os parâmetros de ação que já têm valor preenchido', () => {
    const node: ActionNode = {
      id: 'a1', type: 'action', actionType: 'create_notification',
      config: { title: 'Divergência alta', severity: 'warning' },
    };
    const lines = describeNodeDetails(node, 'count.item_counted');
    expect(lines).toContain('Título: Divergência alta');
    expect(lines).toContain('Severidade: Atenção');
    // "Destinatário" não foi preenchido — não deve aparecer nenhuma linha para ele.
    expect(lines.some(l => l.startsWith('Destinatário'))).toBe(false);
  });

  it('ação de tipo desconhecido não quebra — retorna vazio em vez de lançar', () => {
    const node = { id: 'a1', type: 'action', actionType: 'tipo_nao_existente', config: {} } as ActionNode;
    expect(describeNodeDetails(node, 'count.item_counted')).toEqual([]);
  });

  it('loop só mostra o máximo quando o campo já foi preenchido', () => {
    const withField: LoopNode = { id: 'l1', type: 'loop', field: 'trigger.webhook.body.itens', maxIterations: 5 };
    expect(describeNodeDetails(withField, 'webhook.received')).toEqual(['Campo: trigger.webhook.body.itens', 'Máximo: 5 iteração(ões)']);

    const withoutField: LoopNode = { id: 'l1', type: 'loop', field: '', maxIterations: 5 };
    expect(describeNodeDetails(withoutField, 'webhook.received')).toEqual([]);
  });

  it('delay/trigger não têm detalhe extra — o resumo de uma linha do describeNode já basta', () => {
    expect(describeNodeDetails({ id: 't', type: 'trigger', triggerType: 'manual', config: {} }, 'manual')).toEqual([]);
    expect(describeNodeDetails({ id: 'd', type: 'delay', minutes: 30 }, 'manual')).toEqual([]);
  });
});
