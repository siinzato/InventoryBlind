import { describe, expect, it } from 'vitest';
import {
  LEVEL_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  computeCanvasSize,
  computeLayout,
  computeLevels,
  edgeEndpoints,
  outputsFor,
} from '../layout';
import type { AutomationWorkflow } from '../types';

function linear(): AutomationWorkflow {
  return {
    nodes: [
      { id: 't', type: 'trigger', triggerType: 'count.item_counted', config: {} },
      { id: 'c', type: 'condition', logic: 'AND', rules: [] },
      { id: 'a', type: 'action', actionType: 'create_alert', config: {} },
    ],
    edges: [
      { from: 't', to: 'c', branch: 'next' },
      { from: 'c', to: 'a', branch: 'next' },
    ],
  };
}

/** Losango: um branch cujas duas pernas voltam ao mesmo bloco. É a forma que mais
 *  aparece na prática e a que quebra layouts ingênuos. */
function diamond(): AutomationWorkflow {
  return {
    nodes: [
      { id: 't', type: 'trigger', triggerType: 'count.session_finalized', config: {} },
      { id: 'b', type: 'branch', logic: 'AND', rules: [] },
      { id: 'sim', type: 'action', actionType: 'create_alert', config: {} },
      { id: 'nao', type: 'action', actionType: 'create_alert', config: {} },
      { id: 'fim', type: 'action', actionType: 'create_alert', config: {} },
    ],
    edges: [
      { from: 't', to: 'b', branch: 'next' },
      { from: 'b', to: 'sim', branch: 'true' },
      { from: 'b', to: 'nao', branch: 'false' },
      { from: 'sim', to: 'fim', branch: 'next' },
      { from: 'nao', to: 'fim', branch: 'next' },
    ],
  };
}

describe('computeLevels', () => {
  it('conta a distância em arestas a partir do gatilho', () => {
    const levels = computeLevels(linear());
    expect(levels.get('t')).toBe(0);
    expect(levels.get('c')).toBe(1);
    expect(levels.get('a')).toBe(2);
  });

  it('coloca as pernas de um branch no mesmo nível', () => {
    // "Estes dois acontecem em paralelo" só é legível se estiverem lado a lado.
    const levels = computeLevels(diamond());
    expect(levels.get('sim')).toBe(levels.get('nao'));
  });

  it('usa o MAIOR nível quando há dois caminhos até o mesmo bloco', () => {
    // No menor, a aresta do caminho longo apontaria para trás.
    const workflow = diamond();
    // Um caminho tem 2 arestas até 'fim' (b→sim→fim); vamos criar um de 1 (b→fim).
    workflow.edges.push({ from: 'b', to: 'fim', branch: 'default' });

    const levels = computeLevels(workflow);
    // Continua em 3, não cai para 2.
    expect(levels.get('fim')).toBe(3);
  });

  it('joga node desconectado para o fim', () => {
    const workflow = linear();
    workflow.nodes.push({ id: 'orfao', type: 'action', actionType: 'create_alert', config: {} });

    const levels = computeLevels(workflow);
    expect(levels.get('orfao')).toBeGreaterThan(levels.get('a') as number);
  });

  it('devolve vazio sem gatilho', () => {
    expect(computeLevels({ nodes: [], edges: [] }).size).toBe(0);
  });
});

describe('computeLayout', () => {
  it('empilha um fluxo linear', () => {
    const positions = computeLayout(linear());
    const t = positions.get('t')!;
    const c = positions.get('c')!;

    expect(c.y).toBeGreaterThan(t.y);
    expect(c.y - t.y).toBe(NODE_HEIGHT + LEVEL_GAP);
  });

  it('separa horizontalmente os blocos do mesmo nível', () => {
    const positions = computeLayout(diamond());
    const sim = positions.get('sim')!;
    const nao = positions.get('nao')!;

    expect(sim.y).toBe(nao.y);
    expect(Math.abs(sim.x - nao.x)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it('põe o ramo SIM à esquerda do NÃO', () => {
    // Ordem estável: sem isso os dois trocariam de lado a cada abertura da tela.
    const positions = computeLayout(diamond());
    expect(positions.get('sim')!.x).toBeLessThan(positions.get('nao')!.x);
  });

  it('é determinístico', () => {
    const workflow = diamond();
    expect(computeLayout(workflow)).toEqual(computeLayout(workflow));
  });

  it('respeita a posição que o usuário arrastou', () => {
    // Mover o bloco de alguém porque uma aresta nova apareceu seria o editor
    // desfazendo o trabalho da pessoa.
    const workflow = linear();
    workflow.nodes[2] = { ...workflow.nodes[2], position: { x: 999, y: 777 } };

    const positions = computeLayout(workflow);
    expect(positions.get('a')).toEqual({ x: 999, y: 777 });
    // E não afeta quem não tem posição.
    expect(positions.get('c')!.x).not.toBe(999);
  });

  it('posiciona todo node do grafo', () => {
    // Um node sem posição não é desenhado, e o usuário perde acesso a ele.
    const workflow = diamond();
    workflow.nodes.push({ id: 'solto', type: 'delay', minutes: 5 });

    const positions = computeLayout(workflow);
    for (const node of workflow.nodes) {
      expect(positions.has(node.id)).toBe(true);
    }
  });
});

describe('computeCanvasSize', () => {
  it('cobre o bloco mais distante com folga', () => {
    const positions = new Map([['a', { x: 1000, y: 800 }]]);
    const size = computeCanvasSize(positions);
    expect(size.width).toBeGreaterThan(1000 + NODE_WIDTH);
    expect(size.height).toBeGreaterThan(800 + NODE_HEIGHT);
  });

  it('tem mínimo para não colapsar com um bloco só', () => {
    const size = computeCanvasSize(new Map([['a', { x: 0, y: 0 }]]));
    expect(size.width).toBeGreaterThanOrEqual(760);
    expect(size.height).toBeGreaterThanOrEqual(420);
  });
});

describe('outputsFor', () => {
  it('um branch tem Sim e Não', () => {
    const outputs = outputsFor({ id: 'b', type: 'branch', logic: 'AND', rules: [] });
    expect(outputs.map(o => o.branch)).toEqual(['true', 'false']);
  });

  it('um switch tem um caso por valor, mais o padrão', () => {
    const outputs = outputsFor({
      id: 's',
      type: 'switch',
      field: 'trigger.session.warehouse',
      cases: [{ value: 'GERAL' }, { value: 'FULL' }],
    });
    expect(outputs.map(o => o.branch)).toEqual(['case:GERAL', 'case:FULL', 'default']);
  });

  it('as saídas existem antes de qualquer conexão', () => {
    // É de onde o usuário arrasta para criar a primeira conexão; derivar das arestas
    // existentes deixaria um branch novo sem nada para agarrar.
    const outputs = outputsFor({ id: 'b', type: 'branch', logic: 'AND', rules: [] });
    expect(outputs).toHaveLength(2);
  });

  it('mostra marcador para um caso ainda sem valor', () => {
    const outputs = outputsFor({ id: 's', type: 'switch', field: 'x', cases: [{ value: '' }] });
    expect(outputs[0].label).toBe('(vazio)');
  });

  it('o resto tem uma saída só', () => {
    for (const node of [
      { id: 'a', type: 'action' as const, actionType: 'create_alert', config: {} },
      { id: 'c', type: 'condition' as const, logic: 'AND' as const, rules: [] },
      { id: 'd', type: 'delay' as const, minutes: 5 },
      { id: 't', type: 'trigger' as const, triggerType: 'manual', config: {} },
    ]) {
      expect(outputsFor(node).map(o => o.branch)).toEqual(['next']);
    }
  });
});

describe('edgeEndpoints', () => {
  it('sai por baixo e entra por cima', () => {
    // O fluxo lido de cima para baixo é o que dispensa legenda.
    const { start, end } = edgeEndpoints({ x: 0, y: 0 }, { x: 0, y: 300 }, 0, 1);
    expect(start.y).toBe(NODE_HEIGHT);
    expect(end.y).toBe(300);
  });

  it('distribui várias saídas ao longo da borda', () => {
    // Todas partindo do mesmo ponto sobreporiam as curvas.
    const primeira = edgeEndpoints({ x: 0, y: 0 }, { x: 0, y: 300 }, 0, 3);
    const segunda = edgeEndpoints({ x: 0, y: 0 }, { x: 0, y: 300 }, 1, 3);
    const terceira = edgeEndpoints({ x: 0, y: 0 }, { x: 0, y: 300 }, 2, 3);

    expect(primeira.start.x).toBeLessThan(segunda.start.x);
    expect(segunda.start.x).toBeLessThan(terceira.start.x);
  });

  it('centraliza a saída única', () => {
    const { start } = edgeEndpoints({ x: 0, y: 0 }, { x: 0, y: 300 }, 0, 1);
    expect(start.x).toBe(NODE_WIDTH / 2);
  });

  it('produz um caminho SVG utilizável', () => {
    const { path } = edgeEndpoints({ x: 10, y: 20 }, { x: 300, y: 400 }, 0, 1);
    expect(path).toMatch(/^M [\d.]+ [\d.]+ C /);
  });
});
