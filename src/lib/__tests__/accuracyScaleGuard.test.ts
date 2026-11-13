// Guarda da régua única de acuracidade.
//
// As cinco réguas não nasceram de uma decisão: nasceram de alguém escrever
// `accuracy >= 80` numa tela nova sem saber que outra tela já usava 90. Unificar
// sem guarda só reinicia o relógio. Este teste falha quando um corte numérico de
// acuracidade reaparece fora de src/lib/accuracyScale.ts.
//
// Não é um teste de estilo: o efeito de um corte solto é uma tela dizendo "verde"
// sobre o mesmo número que outra marca como crítico, que foi exatamente o defeito
// corrigido no painel inicial e no mapa de calor.

import { describe, it, expect } from 'vitest';

const FONTES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Compara acuracidade com um número literal: `accuracy >= 80`, `area.acuracidade < 50`,
 *  `mediaAcuracidade >= 60`. Comparar com uma CONSTANTE (`< ACCURACY_TARGET`) não casa,
 *  e é justamente o que se quer que as telas façam. */
const CORTE_LITERAL = /\b[A-Za-z_$][\w$]*(?:acuracidade|accuracy)\b\s*[<>]=?\s*\d+|\b(?:acuracidade|accuracy)\s*[<>]=?\s*\d+/gi;

/** Exceções, cada uma com o motivo. Uma entrada nova aqui é uma decisão de produto
 *  — se for só para calar o teste, o lugar certo é a régua, não esta lista. */
const PERMITIDOS: Record<string, string> = {
  '/src/lib/accuracyScale.ts':
    'é a própria régua: é onde os cortes devem morar',
  '/src/components/FullChecking.tsx':
    'mede peças separadas sobre peças pedidas (atendimento do Full), não "% de SKUs sem divergência"',
  '/src/components/FullHistory.tsx':
    'mesma grandeza do FullChecking — atendimento, não acuracidade de estoque',
  '/src/components/HeatmapLegend.tsx':
    'PENDENTE DE DECISAO, nao um caso legitimo: o texto da legenda descreve os quadrados ' +
    'coloridos por faixas de acuracidade (>= 90, 70-89, 50-69, < 50), mas a cor vem de ' +
    'calculateRiskScore (divergencias + acuracidade + progresso), nao da acuracidade. A ' +
    'legenda ja explicava uma regra que a tela nao usa, de antes da unificacao. Reescreve-la ' +
    'exige definir o que as cores devem significar — decisao de produto, reportada ao usuario.',
  '/src/lib/heatmapUtils.ts':
    'generateDiagnosis usa os cortes para escolher o PESO do fator no texto de diagnóstico, não para classificar a acuracidade na tela',
};

const ehTeste = (p: string) => p.includes('/__tests__/') || p.endsWith('.test.ts') || p.endsWith('.test.tsx');

describe('régua única de acuracidade — guarda contra corte solto', () => {
  it('encontrou os arquivos do projeto (um glob vazio passaria vazio, provando nada)', () => {
    expect(Object.keys(FONTES).length).toBeGreaterThan(300);
  });

  it('a lista de exceções aponta só para arquivos que existem', () => {
    for (const caminho of Object.keys(PERMITIDOS)) {
      expect(FONTES[caminho], `exceção obsoleta: ${caminho} não existe mais`).toBeTypeOf('string');
    }
  });

  it('o padrão realmente detecta um corte solto (senão o teste passaria por não achar nada)', () => {
    const amostra = "const cor = brand.accuracy >= 80 ? 'verde' : 'vermelho';";
    expect(amostra.match(CORTE_LITERAL)).not.toBeNull();
  });

  it('nenhum corte numérico de acuracidade fora da régua', () => {
    const infratores: string[] = [];

    for (const [caminho, conteudo] of Object.entries(FONTES)) {
      if (ehTeste(caminho) || PERMITIDOS[caminho]) continue;

      const achados = conteudo.match(CORTE_LITERAL);
      if (achados) infratores.push(`${caminho} → ${[...new Set(achados)].join(' | ')}`);
    }

    expect(
      infratores,
      `Corte de acuracidade fora de src/lib/accuracyScale.ts:\n  ${infratores.join('\n  ')}\n\n` +
        'Use classifyAccuracy() em vez de comparar com um número. Se a grandeza NÃO for ' +
        '"% de SKUs sem divergência", adicione o arquivo a PERMITIDOS explicando qual é.',
    ).toEqual([]);
  });
});
