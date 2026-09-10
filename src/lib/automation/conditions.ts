// Avaliação de condições — pura.
//
// Um interpretador deliberadamente burro: caminho → operador → valor. Sem
// expressão, sem `eval`, sem função enviada pelo usuário. O conjunto de coisas que
// uma condição pode fazer é exatamente o conjunto de operadores em registry.ts, e
// isso é a garantia de segurança (§38) — não uma sanitização que alguém pode
// esquecer de aplicar.

import { OPERATORS, type OperatorKey } from './registry.ts';
import type { ConditionRule, ExecutionContext } from './types.ts';

/** Lê um caminho pontuado do contexto.
 *
 *  Só travessia de objeto simples: nada de índice de array, nada de chamada, nada
 *  de `..`. Um segmento que não existe devolve undefined, que os operadores tratam
 *  como ausência — nunca lança, porque uma condição sobre campo ausente é uma
 *  condição falsa, não um erro de execução.
 *
 *  Chaves herdadas do prototype são recusadas: `trigger.__proto__.x` não deve
 *  conseguir ler nada. */
export function readPath(context: ExecutionContext, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) return undefined;

  let current: unknown = context;

  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** Vazio para efeito de `is_empty`.
 *
 *  `0` e `false` NÃO são vazios: um saldo zero é um valor, e tratá-lo como
 *  ausência faria "saldo está vazio" ser verdade para um item genuinamente contado
 *  em zero. Essa distinção é a mesma que o resto do projeto faz entre "não contado"
 *  e "contado zero". */
function isEmptyValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Comparação numérica tolerante à origem do dado.
 *
 *  O payload vem de jsonb, onde `numeric` do Postgres pode chegar como string
 *  ("8790"), e o valor configurado pelo usuário vem de um input, sempre string.
 *  Sem esta coerção, `"12" > 10` compararia texto e daria resultado errado de forma
 *  silenciosa — o pior tipo de erro numa condição que decide criar recontagem.
 *
 *  Devolve null quando algum dos lados não é número, e aí o operador numérico é
 *  falso em vez de comparar coisas incomparáveis. */
function asNumbers(left: unknown, right: unknown): [number, number] | null {
  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return null;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const a = toNumber(left);
  const b = toNumber(right);
  return a == null || b == null ? null : [a, b];
}

/** Igualdade frouxa por tipo, estrita por valor.
 *
 *  Compara como número quando os dois lados são numéricos (o `10` do input contra o
 *  `10` do jsonb), como booleano quando o campo é booleano, e como texto no resto.
 *  Sem isto, `isDivergent = true` nunca bateria, porque o select entrega a string
 *  `"true"`. */
function looseEquals(left: unknown, right: unknown): boolean {
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return toBoolean(left) === toBoolean(right);
  }

  const numbers = asNumbers(left, right);
  if (numbers != null) return numbers[0] === numbers[1];

  if (left == null || right == null) return left == null && right == null;

  return String(left) === String(right);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  if (typeof value === 'number') return value !== 0;
  return false;
}

/** Normaliza o valor de `in`/`not_in`. O usuário digita "A, B, C"; o template pode
 *  trazer array. Os dois viram lista. */
function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(part => part.trim())
      .filter(part => part !== '');
  }
  return value == null ? [] : [value];
}

/** Avalia uma regra. Nunca lança: erro aqui viraria execução falha em vez de
 *  condição falsa, e um campo ausente não é uma falha do engine. */
export function evaluateRule(rule: ConditionRule, context: ExecutionContext): boolean {
  const operator = OPERATORS[rule.operator as OperatorKey];
  if (operator == null) return false;

  const actual = readPath(context, rule.field);

  switch (operator.key) {
    case 'is_empty':
      return isEmptyValue(actual);
    case 'is_not_empty':
      return !isEmptyValue(actual);

    case 'equals':
      return looseEquals(actual, rule.value);
    case 'not_equals':
      return !looseEquals(actual, rule.value);

    case 'greater_than': {
      const numbers = asNumbers(actual, rule.value);
      return numbers != null && numbers[0] > numbers[1];
    }
    case 'greater_than_or_equal': {
      const numbers = asNumbers(actual, rule.value);
      return numbers != null && numbers[0] >= numbers[1];
    }
    case 'less_than': {
      const numbers = asNumbers(actual, rule.value);
      return numbers != null && numbers[0] < numbers[1];
    }
    case 'less_than_or_equal': {
      const numbers = asNumbers(actual, rule.value);
      return numbers != null && numbers[0] <= numbers[1];
    }

    case 'contains':
      // Insensível a caixa: quem digita "eletrônicos" espera casar com
      // "Eletrônicos". Um `contains` sensível a caixa numa tela sem aviso é uma
      // condição que falha sem explicação.
      return actual != null && String(actual).toLowerCase().includes(String(rule.value ?? '').toLowerCase());
    case 'not_contains':
      return actual == null || !String(actual).toLowerCase().includes(String(rule.value ?? '').toLowerCase());

    case 'in':
      return toList(rule.value).some(candidate => looseEquals(actual, candidate));
    case 'not_in':
      return !toList(rule.value).some(candidate => looseEquals(actual, candidate));
  }
}

export interface RuleOutcome {
  rule: ConditionRule;
  actual: unknown;
  passed: boolean;
}

export interface GroupOutcome {
  passed: boolean;
  logic: 'AND' | 'OR';
  results: RuleOutcome[];
}

/** Avalia um grupo de regras.
 *
 *  Grupo VAZIO passa. É a escolha certa para um node de condição recém-adicionado
 *  que o usuário ainda não configurou: ele não deve bloquear a execução em teste.
 *  A validação do workflow é que impede ativar uma automação com condição vazia —
 *  bloquear aqui, além de lá, esconderia o node do log e o usuário não veria por
 *  que nada aconteceu.
 *
 *  Sem curto-circuito: toda regra é avaliada mesmo quando o resultado já está
 *  decidido, porque o log mostra cada regra com o valor real que ela viu, e é isso
 *  que permite alguém entender por que a condição deu falso. */
export function evaluateGroup(
  rules: readonly ConditionRule[],
  logic: 'AND' | 'OR',
  context: ExecutionContext
): GroupOutcome {
  const results: RuleOutcome[] = rules.map(rule => ({
    rule,
    actual: readPath(context, rule.field),
    passed: evaluateRule(rule, context),
  }));

  if (results.length === 0) return { passed: true, logic, results };

  const passed = logic === 'AND' ? results.every(r => r.passed) : results.some(r => r.passed);

  return { passed, logic, results };
}

/** Resumo legível de uma avaliação, para o log de execução.
 *
 *  Mostra o valor que a regra realmente viu, não só verdadeiro/falso: "12 > 10" é
 *  diagnosticável, "condição falsa" não é. */
export function describeGroupOutcome(outcome: GroupOutcome): string {
  if (outcome.results.length === 0) return 'Sem condições — segue adiante.';

  const parts = outcome.results.map(result => {
    const operator = OPERATORS[result.rule.operator as OperatorKey];
    const actual = result.actual == null ? 'vazio' : String(result.actual);
    const expected = operator?.needsValue ? ` ${String(result.rule.value ?? '')}` : '';
    return `${result.rule.field} (${actual}) ${operator?.label ?? result.rule.operator}${expected} → ${result.passed ? 'sim' : 'não'}`;
  });

  return parts.join(outcome.logic === 'AND' ? ' E ' : ' OU ');
}
