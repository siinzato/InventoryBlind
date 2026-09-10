import { NODE_META, describeNode, describeNodeDetails } from '../../lib/automation/nodeMeta';
import type { AutomationNode, AutomationWorkflow } from '../../lib/automation/types';

interface Section {
  label: string;
  nodes: AutomationNode[];
}

/** Cadeia principal (saída "next") a partir do gatilho — mesma regra de
 *  travessia que `findChainTail` (AutomationCanvas.tsx) já usa, só que
 *  colecionando o caminho inteiro em vez de só a ponta. Não desce por
 *  ramificações: a leitura de negócio linear (QUANDO/SE/ENTÃO) é para o
 *  caminho principal, e um fluxo com ramos vira aviso, não uma árvore inteira
 *  fora do canvas. */
function walkMainChain(workflow: AutomationWorkflow): AutomationNode[] {
  const trigger = workflow.nodes.find(n => n.type === 'trigger');
  if (trigger == null) return [];

  const chain: AutomationNode[] = [trigger];
  const seen = new Set([trigger.id]);
  let currentId = trigger.id;

  for (;;) {
    const nextId = workflow.edges.find(e => e.from === currentId && e.branch === 'next')?.to;
    if (nextId == null || seen.has(nextId)) break;
    const node = workflow.nodes.find(n => n.id === nextId);
    if (node == null) break;
    chain.push(node);
    seen.add(nextId);
    currentId = nextId;
  }

  return chain;
}

/** Agrupa nodes adjacentes do mesmo kindLabel (trigger→"Quando", condition→"Se",
 *  action/agent→"Então") — é o que já existe em NODE_META, sem reinterpretar
 *  nada; várias ações seguidas viram um único bloco "ENTÃO" com "E" entre elas,
 *  igual ao exemplo do enunciado. */
function groupChain(chain: AutomationNode[]): Section[] {
  const sections: Section[] = [];
  for (const node of chain) {
    const label = NODE_META[node.type].kindLabel;
    const last = sections[sections.length - 1];
    if (last?.label === label) last.nodes.push(node);
    else sections.push({ label, nodes: [node] });
  }
  return sections;
}

interface Props {
  workflow: AutomationWorkflow;
  triggerType: string;
  selectedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
}

/** Leitura de negócio do fluxo do agente — QUANDO/SE/ENTÃO em vez do canvas,
 *  reaproveitando os mesmos metadados e resumos de node do editor (§5). Clicar
 *  numa linha seleciona o node para o painel de propriedades da Fase 1 (§6),
 *  exatamente como clicar num node no canvas já faz. */
export function AgentLogicSummary({ workflow, triggerType, selectedNodeId, onSelectNode }: Props) {
  const chain = walkMainChain(workflow);
  const sections = groupChain(chain);
  const hasExtraPaths = chain.length < workflow.nodes.length;

  if (sections.length === 0) {
    return <p className="text-sm text-fg-muted">Este agente ainda não tem gatilho configurado.</p>;
  }

  return (
    <div className="space-y-4">
      {sections.map((section, sectionIndex) => (
        <div key={sectionIndex}>
          <p className="text-overline text-fg-subtle">{section.label}</p>
          <div className="mt-1.5 space-y-1.5">
            {section.nodes.map((node, index) => {
              const meta = NODE_META[node.type];
              const Icon = meta.icon;
              const selected = node.id === selectedNodeId;
              return (
                <div key={node.id}>
                  {index > 0 && <p className="pl-1 text-xs font-medium text-fg-subtle">E</p>}
                  <button
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                    className={`flex w-full items-start gap-2 rounded-container border px-3 py-2 text-left transition-colors ${
                      selected ? 'border-accent bg-accent/5' : 'border-edge hover:bg-surface-3'
                    }`}
                  >
                    <Icon size={14} className={`mt-0.5 flex-shrink-0 ${meta.colorClass}`} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-fg">{node.label ?? describeNode(node)}</span>
                      <span className="block text-xs text-fg-subtle">{describeNode(node)}</span>
                      {describeNodeDetails(node, triggerType).map((line, i) => (
                        <span key={i} className="block text-xs text-fg-subtle/80">{line}</span>
                      ))}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hasExtraPaths && (
        <p className="text-xs text-fg-subtle">Este fluxo tem caminhos adicionais (ramificações) — abra o workflow para ver todos.</p>
      )}
    </div>
  );
}
