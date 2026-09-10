// Interpolação de variáveis — `{{trigger.item.sku}}`.
//
// Substituição de caminho, e nada além disso. Não é template engine: não há
// condicional, laço, chamada de função, filtro nem aritmética. A gramática inteira
// é `{{` + caminho pontuado + `}}`, e um caminho que não resolve fica marcado em vez
// de virar string vazia.
//
// É intencionalmente pobre. O briefing (§22, §38) pede interpolação segura e
// limitada, e qualquer coisa mais expressiva que isto acaba precisando avaliar
// entrada do usuário.

import { readPath } from './conditions.ts';
import type { ExecutionContext } from './types.ts';

/** `{{ caminho }}` com espaços opcionais. O caminho aceita apenas letras, dígitos,
 *  `_` e `.` — o que exclui parênteses, operadores e qualquer coisa que sugira
 *  execução. Uma chave com sintaxe fora disso não é reconhecida como variável e
 *  permanece literal, o que é mais honesto do que aceitar e ignorar. */
const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/** Marca no texto final um caminho que não resolveu.
 *
 *  A alternativa — trocar por string vazia — produz "Divergência alta em " numa
 *  notificação e ninguém descobre que a variável estava errada. O marcador aparece
 *  no aviso e no log, e é assim que a pessoa encontra o erro de configuração. */
export const UNRESOLVED_MARK = '(indisponível)';

export interface InterpolationResult {
  text: string;
  /** Caminhos usados que não resolveram. O engine grava no output do node. */
  unresolved: string[];
}

/** Substitui as variáveis de um texto.
 *
 *  Valores objeto/array NÃO são serializados: `{{trigger.session}}` inteiro num
 *  título produziria `[object Object]` ou um JSON dentro de uma frase. Vira
 *  marcador de não resolvido, que é o que o usuário precisa ver para escolher um
 *  campo folha. */
export function interpolate(template: string, context: ExecutionContext): InterpolationResult {
  const unresolved: string[] = [];

  const text = template.replace(TOKEN, (_match, path: string) => {
    const value = readPath(context, path);

    if (value == null) {
      unresolved.push(path);
      return UNRESOLVED_MARK;
    }

    if (typeof value === 'object') {
      unresolved.push(path);
      return UNRESOLVED_MARK;
    }

    // Número vindo de jsonb pode ser string; String() cobre os dois. Booleano vira
    // 'true'/'false', que é o esperado num texto.
    return String(value);
  });

  return { text, unresolved };
}

/** Interpola todos os campos de texto de uma configuração de ação.
 *
 *  Só as chaves listadas em `interpolableKeys` — que vêm do registry. Interpolar
 *  tudo alcançaria uma URL de webhook ou um id de usuário, e um `{{}}` acidental
 *  ali viraria uma URL malformada ou um uuid inválido. */
export function interpolateConfig(
  config: Record<string, unknown>,
  interpolableKeys: readonly string[],
  context: ExecutionContext
): { config: Record<string, unknown>; unresolved: string[] } {
  const result: Record<string, unknown> = { ...config };
  const unresolved: string[] = [];

  for (const key of interpolableKeys) {
    const value = config[key];
    if (typeof value !== 'string' || !value.includes('{{')) continue;

    const interpolated = interpolate(value, context);
    result[key] = interpolated.text;
    unresolved.push(...interpolated.unresolved);
  }

  return { config: result, unresolved: [...new Set(unresolved)] };
}

/** Caminhos referenciados por um texto. Usado pela validação do workflow para
 *  recusar `{{trigger.nao.existe}}` antes de ativar, em vez de deixar a automação
 *  produzir "(indisponível)" em produção. */
export function extractPaths(template: string): string[] {
  const paths: string[] = [];
  for (const match of template.matchAll(TOKEN)) {
    paths.push(match[1]);
  }
  return [...new Set(paths)];
}
