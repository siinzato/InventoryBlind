// Condições aninhadas — `(a E b) OU c`. Puro.
//
// A V1 tinha um nível só: uma lista de regras e um conector. Isso não expressa
// `(divergência > 10 E depósito = GERAL) OU divergência > 40`, que é uma regra
// operacional comum — tolerância maior no geral, tolerância zero acima de um teto.
//
// ── Compatibilidade com o que já está salvo ─────────────────────────────────
// Um grupo tem exatamente a forma que um ConditionNode já tinha (`logic` + `rules`)
// mais um `groups` opcional. Então todo workflow gravado antes disto JÁ É um grupo
// válido de um nível, e não há migração: `groups` ausente significa "sem
// aninhamento".
//
// ── Por que profundidade limitada ───────────────────────────────────────────
// Aninhamento arbitrário produz uma expressão que ninguém lê na tela e que ninguém
// depura depois. Três níveis cobrem qualquer regra que alguém consiga explicar em voz
// alta; além disso o problema é a regra, não o editor.

import { describeGroupOutcome, evaluateGroup, type GroupOutcome } from './conditions';
import type { ConditionRule, ExecutionContext } from './types';

/** Profundidade máxima de aninhamento. O grupo raiz é o nível 1. */
export const MAX_GROUP_DEPTH = 3;

export interface ConditionGroup {
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
  /** Subgrupos, avaliados como um termo do conector deste grupo. Ausente = sem
   *  aninhamento, que é o estado de todo workflow salvo antes desta versão. */
  groups?: ConditionGroup[];
}

export interface GroupEvaluation {
  passed: boolean;
  logic: 'AND' | 'OR';
  /** Resultado das regras diretas deste grupo. */
  own: GroupOutcome;
  /** Resultado de cada subgrupo, na ordem. */
  children: GroupEvaluation[];
}

/** Avalia um grupo e seus subgrupos.
 *
 *  Um subgrupo entra como UM termo do conector do pai: em `{OR, rules:[c], groups:[{AND,[a,b]}]}`,
 *  o resultado é `c OU (a E b)`. Tratar as regras do filho como se fossem do pai
 *  achataria o parêntese e mudaria o significado — é exatamente o que a V1 fazia por
 *  não ter aninhamento.
 *
 *  Grupo totalmente vazio (sem regra e sem subgrupo) PASSA, mantendo o comportamento
 *  da V1: um node recém-adicionado não deve bloquear o teste. A validação é que
 *  impede ativar com condição vazia. */
export function evaluateConditionGroup(
  group: ConditionGroup,
  context: ExecutionContext,
  depth = 1
): GroupEvaluation {
  const own = evaluateGroup(group.rules, group.logic, context);

  const children =
    // Corta acima do limite em vez de avaliar: um grafo com aninhamento além do
    // permitido não deveria existir (a validação recusa), e avaliá-lo daria a uma
    // automação inválida um comportamento definido.
    depth >= MAX_GROUP_DEPTH
      ? []
      : (group.groups ?? []).map(child => evaluateConditionGroup(child, context, depth + 1));

  const hasRules = group.rules.length > 0;
  const hasChildren = children.length > 0;

  if (!hasRules && !hasChildren) {
    return { passed: true, logic: group.logic, own, children };
  }

  // Os termos deste grupo: o resultado das regras diretas (quando existem) e o de
  // cada subgrupo.
  const terms: boolean[] = [
    ...(hasRules ? [own.passed] : []),
    ...children.map(child => child.passed),
  ];

  const passed = group.logic === 'AND' ? terms.every(Boolean) : terms.some(Boolean);

  return { passed, logic: group.logic, own, children };
}

/** Lê um ConditionNode/BranchNode como grupo.
 *
 *  Existe para o engine não precisar saber se o node tem aninhamento: a forma antiga
 *  e a nova entram pela mesma porta. */
export function toConditionGroup(node: {
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
  groups?: ConditionGroup[];
}): ConditionGroup {
  return { logic: node.logic, rules: node.rules, groups: node.groups };
}

/** Conta grupos e regras, para a validação e para o resumo na tela. */
export function countGroup(group: ConditionGroup): { rules: number; groups: number; depth: number } {
  const children = (group.groups ?? []).map(countGroup);

  return {
    rules: group.rules.length + children.reduce((sum, c) => sum + c.rules, 0),
    groups: 1 + children.reduce((sum, c) => sum + c.groups, 0),
    depth: 1 + Math.max(0, ...children.map(c => c.depth)),
  };
}

/** Descrição legível da avaliação, com parênteses onde houver aninhamento.
 *
 *  Gerada da mesma avaliação que decidiu, então não pode discordar dela. Os
 *  parênteses são o ponto: sem eles o log de `(a E b) OU c` seria indistinguível de
 *  `a E (b OU c)`, que dá resultado diferente. */
export function describeGroupEvaluation(evaluation: GroupEvaluation): string {
  const parts: string[] = [];

  if (evaluation.own.results.length > 0) {
    parts.push(describeGroupOutcome(evaluation.own));
  }

  for (const child of evaluation.children) {
    parts.push(`(${describeGroupEvaluation(child)})`);
  }

  if (parts.length === 0) return 'Sem condições — segue adiante.';

  return parts.join(evaluation.logic === 'AND' ? ' E ' : ' OU ');
}
