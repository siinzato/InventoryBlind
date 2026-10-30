// Guardas da geração de códigos em lote.
//
// Errar aqui cria dezenas de endereços errados de uma vez, e endereço com movimentação
// não se apaga. É o ponto do módulo onde um engano sai mais caro.

import { describe, expect, it } from 'vitest';
import { buildBinCodes } from '../wmsService';
import { parseBinCode } from '../binCode';

describe('cada rua tem a própria contagem', () => {
  // O galpão real: paredões com 3 níveis convivendo com meios de 1 nível. Antes isto
  // exigia uma rodada do gerador por paredão.
  it('monta a estrutura mista de um galpão de verdade', () => {
    const codes = buildBinCodes({
      prefix: 'PP',
      streets: [
        { street: 'A', modules: 13, levels: 3 },
        { street: 'B', modules: 3, levels: 3 },
        { street: 'C', modules: 7, levels: 1 },
        { street: 'D', modules: 16, levels: 1 },
      ],
    });

    expect(codes).toHaveLength(13 * 3 + 3 * 3 + 7 + 16);
    expect(codes.filter(c => c.startsWith('PP-A'))).toHaveLength(39);
    expect(codes.filter(c => c.startsWith('PP-C'))).toHaveLength(7);
    expect(codes).toContain('PP-A13-N3');
    expect(codes).toContain('PP-D16-N1');
    // Rua de 1 nível não inventa um segundo.
    expect(codes.some(c => c.startsWith('PP-C') && c.endsWith('-N2'))).toBe(false);
  });

  it('não repete código entre ruas', () => {
    const codes = buildBinCodes({
      prefix: 'PP',
      streets: [
        { street: 'A', modules: 13, levels: 3 },
        { street: 'B', modules: 3, levels: 3 },
      ],
    });
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('o código gerado é o código que o resto do sistema entende', () => {
  // Mapa, etiqueta e leitor de QR leem pelo mesmo parser. Gerador e leitor divergirem
  // seria endereço impresso que o sistema não reconhece.
  it('tudo que sai daqui volta por parseBinCode', () => {
    const codes = buildBinCodes({
      prefix: 'PP',
      streets: [{ street: 'a', modules: 12, levels: 2 }],
    });
    for (const code of codes) {
      const parsed = parseBinCode(code);
      expect(parsed).not.toBeNull();
      expect(parsed?.street).toBe('A');
    }
    // Módulo com dois dígitos: ordenação alfabética tem que dar a ordem de caminhada.
    expect(codes).toContain('PP-A01-N1');
    expect(codes).toContain('PP-A12-N2');
    expect([...codes].sort()).toEqual(codes.slice().sort());
  });
});

describe('rua inválida não vira endereço', () => {
  // A rua é letra porque o código vira número no módulo: um dígito na rua tornaria
  // `PP-113-N1` ambíguo entre rua 1/módulo 13 e rua 11/módulo 3.
  it('rua com dígito ou vazia é ignorada, sem quebrar as outras', () => {
    const codes = buildBinCodes({
      prefix: 'PP',
      streets: [
        { street: '1', modules: 2, levels: 1 },
        { street: '', modules: 2, levels: 1 },
        { street: 'A1', modules: 2, levels: 1 },
        { street: 'B', modules: 2, levels: 1 },
      ],
    });
    expect(codes).toEqual(['PP-B01-N1', 'PP-B02-N1']);
  });

  it('contagem zero ou negativa não gera nada', () => {
    expect(buildBinCodes({ prefix: 'PP', streets: [{ street: 'A', modules: 0, levels: 3 }] })).toEqual([]);
    expect(buildBinCodes({ prefix: 'PP', streets: [{ street: 'A', modules: 3, levels: -1 }] })).toEqual([]);
  });
});
