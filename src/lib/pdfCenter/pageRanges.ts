// Parser de intervalos de página no formato "1-3,5,8-10" (1-based, como o
// usuário digita) — retorna índices 0-based (como o resto do domínio usa).

export interface PageRangeParseResult {
  ok: boolean;
  /** Índices 0-based, ordenados e sem duplicatas. Só confiável quando `ok`. */
  indices: number[];
  errors: string[];
  warnings: string[];
}

function fail(errors: string[], warnings: string[] = []): PageRangeParseResult {
  return { ok: false, indices: [], errors, warnings };
}

export function parsePageRanges(input: string, totalPages: number): PageRangeParseResult {
  const trimmedInput = input.trim();
  if (trimmedInput.length === 0) {
    return fail(['Informe ao menos uma página ou intervalo.']);
  }
  if (totalPages <= 0) {
    return fail(['O documento não tem páginas.']);
  }

  const tokens = trimmedInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
  if (tokens.length === 0) {
    return fail(['Informe ao menos uma página ou intervalo.']);
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<number>();
  const indices: number[] = [];

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    const singleMatch = token.match(/^(\d+)$/);

    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > end) {
        errors.push(`Intervalo "${token}" está invertido (início maior que o fim).`);
        continue;
      }
      if (start < 1 || end > totalPages) {
        errors.push(`Intervalo "${token}" está fora do documento (o documento tem ${totalPages} página${totalPages === 1 ? '' : 's'}).`);
        continue;
      }
      let hadRepeat = false;
      for (let p = start; p <= end; p++) {
        const zeroBased = p - 1;
        if (seen.has(zeroBased)) { hadRepeat = true; continue; }
        seen.add(zeroBased);
        indices.push(zeroBased);
      }
      if (hadRepeat) warnings.push(`Intervalo "${token}" repete página já incluída — repetições foram ignoradas.`);
    } else if (singleMatch) {
      const page = Number(singleMatch[1]);
      if (page < 1 || page > totalPages) {
        errors.push(`Página "${token}" está fora do documento (o documento tem ${totalPages} página${totalPages === 1 ? '' : 's'}).`);
        continue;
      }
      const zeroBased = page - 1;
      if (seen.has(zeroBased)) {
        warnings.push(`Página "${token}" já foi incluída — repetição ignorada.`);
        continue;
      }
      seen.add(zeroBased);
      indices.push(zeroBased);
    } else {
      errors.push(`"${token}" não é uma página nem um intervalo válido (use "1-3" ou "5").`);
    }
  }

  if (errors.length > 0) return fail(errors, warnings);

  return { ok: true, indices: indices.sort((a, b) => a - b), errors: [], warnings };
}

export function formatPageRanges(indices: number[]): string {
  if (indices.length === 0) return '';
  const sorted = [...new Set(indices)].sort((a, b) => a - b);

  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    if (current != null) {
      start = current;
      prev = current;
    }
  }

  return parts.join(',');
}
