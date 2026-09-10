// Layout do grafo — puro.
//
// Calcula posição para os blocos que não têm uma. É o que permite trocar o editor
// vertical por um canvas livre sem migração de dados: um workflow salvo antes do
// canvas simplesmente não tem `position`, e é posicionado a partir da própria
// estrutura do grafo.
//
// ── Por que layout derivado e não posição obrigatória ───────────────────────
// Tornar `position` obrigatório exigiria migrar todo workflow existente e escolher
// coordenadas para eles de qualquer forma — ou seja, exatamente este algoritmo, só
// que rodando uma vez e gravado. Derivar na abertura é mais simples e sobrevive a
// alguém editar o jsonb à mão.
//
// Depois que o usuário arrasta um bloco, a posição dele passa a ser gravada e este
// módulo não a toca mais.

import type { AutomationEdge, AutomationNode, AutomationWorkflow } from './types';

export interface Point {
  x: number;
  y: number;
}

/** Distância entre níveis e entre irmãos.
 *
 *  Exportadas porque o canvas precisa das mesmas medidas para desenhar as arestas e
 *  para decidir o tamanho da área — dois conjuntos de números produziriam setas
 *  desalinhadas dos blocos. */
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 84;
export const LEVEL_GAP = 130;
export const SIBLING_GAP = 40;
export const CANVAS_PADDING = 48;

/** Nível de cada node: distância em arestas a partir do gatilho.
 *
 *  Largura primeiro (BFS) e não profundidade: com DFS, um ramo longo empurraria o
 *  irmão curto para um nível fundo e o desenho não refletiria "estes dois acontecem
 *  em paralelo".
 *
 *  Um node alcançável por dois caminhos de comprimentos diferentes — o losango que um
 *  branch convergente produz — fica no MAIOR nível. Colocá-lo no menor faria a aresta
 *  do caminho longo apontar para trás. */
export function computeLevels(workflow: AutomationWorkflow): Map<string, number> {
  const levels = new Map<string, number>();
  const trigger = workflow.nodes.find(n => n.type === 'trigger');
  if (trigger == null) return levels;

  levels.set(trigger.id, 0);
  const queue: string[] = [trigger.id];

  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    const currentLevel = levels.get(currentId) ?? 0;

    for (const edge of workflow.edges.filter(e => e.from === currentId)) {
      const existing = levels.get(edge.to);
      const candidate = currentLevel + 1;

      if (existing == null || candidate > existing) {
        levels.set(edge.to, candidate);
        // Reenfileira: subir o nível deste node obriga a reavaliar quem vem depois.
        // Sem isso, o descendente de um losango ficaria num nível anterior ao pai.
        queue.push(edge.to);
      }
    }
  }

  // Nodes desconectados não têm nível pelo grafo. Vão para o fim, em vez de ficarem
  // empilhados sobre o gatilho.
  const maxLevel = Math.max(0, ...[...levels.values()]);
  for (const node of workflow.nodes) {
    if (!levels.has(node.id)) levels.set(node.id, maxLevel + 1);
  }

  return levels;
}

/** Ordena os irmãos de um nível de forma estável.
 *
 *  Pela saída da aresta que chega neles: `true` antes de `false`, e os casos de um
 *  switch na ordem em que o usuário os declarou. Sem essa ordem, dois blocos no mesmo
 *  nível trocariam de lado a cada abertura da tela — o desenho mudaria sem ninguém
 *  ter mexido em nada. */
function siblingRank(workflow: AutomationWorkflow, nodeId: string): number {
  const incoming: AutomationEdge | undefined = workflow.edges.find(e => e.to === nodeId);
  if (incoming == null) return 999;

  if (incoming.branch === 'true') return 0;
  if (incoming.branch === 'false') return 1;
  if (incoming.branch === 'next') return 0;
  if (incoming.branch === 'default') return 900;
  // Corpo do laço à esquerda, continuação à direita — a leitura é a mesma de SIM/NÃO.
  if (incoming.branch === 'loop') return 0;
  if (incoming.branch === 'after') return 1;

  if (incoming.branch.startsWith('case:')) {
    const source = workflow.nodes.find(n => n.id === incoming.from);
    if (source != null && source.type === 'switch') {
      const value = incoming.branch.slice('case:'.length);
      const index = source.cases.findIndex(c => c.value === value);
      return index >= 0 ? 100 + index : 800;
    }
  }

  return 500;
}

/** Posições para todos os nodes, respeitando as que já existem.
 *
 *  Só calcula para quem não tem `position`. Um node que o usuário arrastou fica onde
 *  ele colocou, mesmo que o grafo mude ao redor — mover o bloco de alguém porque uma
 *  aresta nova apareceu seria o editor desfazendo o trabalho da pessoa. */
export function computeLayout(workflow: AutomationWorkflow): Map<string, Point> {
  const positions = new Map<string, Point>();
  const levels = computeLevels(workflow);

  const byLevel = new Map<number, AutomationNode[]>();
  for (const node of workflow.nodes) {
    const level = levels.get(node.id) ?? 0;
    byLevel.set(level, [...(byLevel.get(level) ?? []), node]);
  }

  for (const [level, nodes] of byLevel) {
    const ordered = [...nodes].sort((a, b) => {
      const rank = siblingRank(workflow, a.id) - siblingRank(workflow, b.id);
      // Empate resolvido pelo id, para a ordem ser determinística.
      return rank !== 0 ? rank : a.id.localeCompare(b.id);
    });

    const rowWidth = ordered.length * NODE_WIDTH + (ordered.length - 1) * SIBLING_GAP;
    const startX = CANVAS_PADDING + Math.max(0, (NODE_WIDTH * 3 - rowWidth) / 2);

    ordered.forEach((node, index) => {
      if (node.position != null) {
        positions.set(node.id, node.position);
        return;
      }

      positions.set(node.id, {
        x: startX + index * (NODE_WIDTH + SIBLING_GAP),
        y: CANVAS_PADDING + level * (NODE_HEIGHT + LEVEL_GAP),
      });
    });
  }

  return positions;
}

/** Tamanho da área de desenho, com folga para arrastar além do último bloco. */
export function computeCanvasSize(positions: Map<string, Point>): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;

  for (const point of positions.values()) {
    maxX = Math.max(maxX, point.x + NODE_WIDTH);
    maxY = Math.max(maxY, point.y + NODE_HEIGHT);
  }

  return {
    // Mínimos para o canvas não colapsar quando há um bloco só.
    width: Math.max(760, maxX + CANVAS_PADDING * 4),
    height: Math.max(420, maxY + CANVAS_PADDING * 4),
  };
}

/** Onde uma aresta sai e onde entra.
 *
 *  Saída embaixo, entrada em cima — o fluxo lido de cima para baixo é o que torna o
 *  desenho compreensível sem legenda. Quando um node tem várias saídas, elas são
 *  distribuídas ao longo da borda inferior em vez de partirem todas do mesmo ponto,
 *  senão as curvas se sobrepõem e não se sabe qual vai para onde. */
export function edgeEndpoints(
  from: Point,
  to: Point,
  outputIndex: number,
  outputCount: number
): { start: Point; end: Point; path: string } {
  const spread = outputCount <= 1 ? 0.5 : (outputIndex + 1) / (outputCount + 1);

  const start = { x: from.x + NODE_WIDTH * spread, y: from.y + NODE_HEIGHT };
  const end = { x: to.x + NODE_WIDTH / 2, y: to.y };

  // Bézier cúbica com controles verticais: a curva sai para baixo e entra por cima,
  // o que evita a linha cortar o bloco de origem quando o destino está ao lado.
  const controlOffset = Math.max(40, Math.abs(end.y - start.y) / 2);
  const path = `M ${start.x} ${start.y} C ${start.x} ${start.y + controlOffset}, ${end.x} ${end.y - controlOffset}, ${end.x} ${end.y}`;

  return { start, end, path };
}

/** As saídas de um node, na ordem em que devem aparecer.
 *
 *  Derivadas do TIPO do node, não das arestas existentes: uma ramificação tem duas
 *  saídas mesmo antes de qualquer conexão, e é preciso mostrá-las para o usuário ter
 *  de onde arrastar. */
export function outputsFor(node: AutomationNode): { branch: string; label: string }[] {
  if (node.type === 'branch') {
    return [
      { branch: 'true', label: 'Sim' },
      { branch: 'false', label: 'Não' },
    ];
  }

  if (node.type === 'switch') {
    return [
      ...node.cases.map(candidate => ({
        branch: `case:${candidate.value}`,
        // Rótulo, ou o valor, ou um marcador — um caso ainda sem valor precisa de
        // alguma coisa na tela para o usuário conseguir clicar nele.
        label: candidate.label ?? (candidate.value === '' ? '(vazio)' : candidate.value),
      })),
      { branch: 'default', label: 'Padrão' },
    ];
  }

  if (node.type === 'loop') {
    return [
      { branch: 'loop', label: 'Cada item' },
      { branch: 'after', label: 'Depois' },
    ];
  }

  return [{ branch: 'next', label: '' }];
}
