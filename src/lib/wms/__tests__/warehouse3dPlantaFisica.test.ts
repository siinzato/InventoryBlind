import { describe, expect, it } from 'vitest';
import {
  AZ2027_TERREO, EXPEDICAO, LARGURA_DO_PREDIO, PROFUNDIDADE_DA_FILEIRA,
  blocosDaPlanta, comprimentoTotal, posicoesEmX, pecasDaFileira, posicoesDaFileira, NIVEIS_POR_FILEIRA,
  vaosDaFileira, mesasDaPlanta, type PecaDaFileira,
} from '../warehouse3dPlantaFisica';

/**
 * Extensão REAL da peça nos eixos X e Y, já contando o giro.
 *
 * A diagonal mede o comprimento inteiro em X antes de girar — comparar `tamanho[0]` cru
 * com a profundidade da fileira acusaria uma peça fora da estante que na verdade está
 * dentro, e um teste que acusa errado é um teste que se desliga. Girada em θ, a caixa
 * ocupa |sx·cos| + |sy·sen| em X, e o simétrico em Y.
 */
const extensao = (p: PecaDaFileira): [number, number] => {
  const t = p.rotacaoZ ?? 0;
  const [sx, sy] = p.tamanho;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return [sx * c + sy * s, sx * s + sy * c];
};

describe('warehouse3dPlantaFisica - geometria lida da planta AZ 2027', () => {
  it('o conjunto tem os 45,2 m da planta', () => {
    expect(comprimentoTotal()).toBeCloseTo(45.2, 2);
  });

  it('nenhuma fileira do predio atual atravessa a parede', () => {
    const xs = posicoesEmX(AZ2027_TERREO[0]);
    const meia = PROFUNDIDADE_DA_FILEIRA / 2;
    expect(xs).toHaveLength(5);
    expect(Math.min(...xs) - meia).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs) + meia).toBeLessThanOrEqual(LARGURA_DO_PREDIO);
  });

  it('o galpao novo poe duas fileiras costa-a-costa no meio', () => {
    const xs = posicoesEmX(AZ2027_TERREO[1]);
    expect(xs).toHaveLength(4);
    // As duas do meio ficam encostadas: distancia entre centros = a propria profundidade.
    expect(xs[2] - xs[1]).toBeCloseTo(PROFUNDIDADE_DA_FILEIRA, 3);
    // E os corredores das pontas valem os 2,65 m cotados na planta.
    const corredor = AZ2027_TERREO[1].corredorLongitudinal;
    expect(xs[1] - xs[0] - PROFUNDIDADE_DA_FILEIRA).toBeCloseTo(corredor, 3);
    expect(xs[3] - xs[2] - PROFUNDIDADE_DA_FILEIRA).toBeCloseTo(corredor, 3);
  });

  it('nenhuma fileira do galpao novo atravessa a parede', () => {
    const xs = posicoesEmX(AZ2027_TERREO[1]);
    const meia = PROFUNDIDADE_DA_FILEIRA / 2;
    expect(Math.min(...xs) - meia).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs) + meia).toBeLessThanOrEqual(LARGURA_DO_PREDIO);
  });

  it('as fileiras respeitam o corredor transversal de entrada de cada trecho', () => {
    for (const trecho of AZ2027_TERREO) {
      const blocos = blocosDaPlanta([trecho], {});
      const fileiras = blocos.filter(b => b.tipo === 'fileira');
      for (const f of fileiras) {
        const zComeco = f.centro[2] - f.tamanho[2] / 2;
        expect(zComeco).toBeCloseTo(trecho.zInicio + trecho.corredorInicio, 3);
      }
    }
  });

  it('as fileiras nao invadem a expedicao', () => {
    const blocos = blocosDaPlanta();
    const exp = blocos.find(b => b.tipo === 'expedicao')!;
    const zExpedicaoComeca = exp.centro[2] - exp.tamanho[2] / 2;
    for (const f of blocos.filter(b => b.tipo === 'fileira')) {
      expect(f.centro[2] + f.tamanho[2] / 2).toBeLessThanOrEqual(zExpedicaoComeca);
    }
  });

  it('a expedicao tem as medidas cotadas e fica rente ao chao', () => {
    const exp = blocosDaPlanta().find(b => b.tipo === 'expedicao')!;
    expect(exp.tamanho[0]).toBeCloseTo(EXPEDICAO.largura, 3);
    expect(exp.tamanho[2]).toBeCloseTo(EXPEDICAO.comprimento, 3);
    expect(exp.centro[1]).toBeLessThan(0.1);
  });

  it('entrega 9 fileiras, rotuladas de A a H na ordem do eixo X', () => {
    const fileiras = blocosDaPlanta().filter(b => b.tipo === 'fileira');
    expect(fileiras).toHaveLength(9);
    const comRotulo = fileiras.filter(f => f.rotulo).map(f => f.rotulo);
    expect(comRotulo).toEqual(['RUA A', 'RUA B', 'RUA C', 'RUA D', 'RUA E', 'RUA F', 'RUA G', 'RUA H']);
    // A quinta fileira do predio atual existe na planta e nao tem rua cadastrada: fica
    // sem rotulo em vez de receber um nome inventado.
    expect(fileiras.filter(f => !f.rotulo)).toHaveLength(1);
  });

  it('duas fileiras nunca se sobrepoem', () => {
    const fileiras = blocosDaPlanta().filter(b => b.tipo === 'fileira');
    for (let i = 0; i < fileiras.length; i++) {
      for (let j = i + 1; j < fileiras.length; j++) {
        const a = fileiras[i], b = fileiras[j];
        const sobrepoeX = Math.abs(a.centro[0] - b.centro[0]) < (a.tamanho[0] + b.tamanho[0]) / 2 - 1e-6;
        const sobrepoeZ = Math.abs(a.centro[2] - b.centro[2]) < (a.tamanho[2] + b.tamanho[2]) / 2 - 1e-6;
        expect(sobrepoeX && sobrepoeZ).toBe(false);
      }
    }
  });
});

describe('pecasDaFileira - a estante decomposta', () => {
  const fileira = () => blocosDaPlanta().filter(b => b.tipo === 'fileira')[0];

  it('montantes ficam nas DIVISAS: um a mais que o numero de posicoes, nas duas faces', () => {
    const b = fileira();
    const pecas = pecasDaFileira(b);
    const montantes = pecas.filter(p => p.tipo === 'montante');
    expect(montantes).toHaveLength((posicoesDaFileira(b) + 1) * 2);
  });

  it('uma longarina por nivel em cada face', () => {
    const vigas = pecasDaFileira(fileira()).filter(p => p.tipo === 'viga');
    expect(vigas).toHaveLength(NIVEIS_POR_FILEIRA * 2);
  });

  it('os montantes das pontas caem exatamente nas extremidades da fileira', () => {
    const b = fileira();
    const zs = pecasDaFileira(b).filter(p => p.tipo === 'montante').map(p => p.centro[2]);
    expect(Math.min(...zs)).toBeCloseTo(b.centro[2] - b.tamanho[2] / 2, 6);
    expect(Math.max(...zs)).toBeCloseTo(b.centro[2] + b.tamanho[2] / 2, 6);
  });

  it('nenhuma peca sai da profundidade declarada da fileira', () => {
    const b = fileira();
    for (const p of pecasDaFileira(b)) {
      const [ex] = extensao(p);
      expect(p.centro[0] - ex / 2).toBeGreaterThanOrEqual(b.centro[0] - b.tamanho[0] / 2 - 1e-9);
      expect(p.centro[0] + ex / 2).toBeLessThanOrEqual(b.centro[0] + b.tamanho[0] / 2 + 1e-9);
    }
  });

  it('nenhuma peca passa da altura da fileira', () => {
    const b = fileira();
    for (const p of pecasDaFileira(b)) {
      const [, ey] = extensao(p);
      expect(p.centro[1] + ey / 2).toBeLessThanOrEqual(b.tamanho[1] + 1e-9);
    }
  });

  it('a diagonal liga os DOIS montantes do quadro, de ponta a ponta', () => {
    const b = fileira();
    const diagonais = pecasDaFileira(b).filter(p => p.tipo === 'diagonal');
    expect(diagonais.length).toBeGreaterThan(0);

    // Travar o alcance em X é o que impede a diagonal virar enfeite: curta demais ela
    // some entre as colunas; comprida demais, fura a lateral da estante.
    const vaoEntreMontantes = PROFUNDIDADE_DA_FILEIRA - 0.09;
    const nivel = b.tamanho[1] / NIVEIS_POR_FILEIRA;
    // A caixa girada ocupa o vão MAIS a projeção da própria seção (uns 3 cm), então o
    // alcance é uma faixa, não um ponto: tem de chegar ao outro montante sem passar dele
    // por mais do que a espessura da peça.
    for (const d of diagonais) {
      const [ex, ey] = extensao(d);
      expect(ex).toBeGreaterThanOrEqual(vaoEntreMontantes);
      expect(ex).toBeLessThanOrEqual(vaoEntreMontantes + 0.05);
      // E em Y ela vence um nível, que é o passo do zigue-zague, sem NUNCA passar dele:
      // passando, a diagonal do último nível fura o topo da estante.
      expect(ey).toBeGreaterThanOrEqual(nivel - 0.05);
      expect(ey).toBeLessThanOrEqual(nivel);
    }
  });

  it('o contraventamento alterna de sentido — feixe paralelo nao e trelica', () => {
    const diagonais = pecasDaFileira(fileira()).filter(p => p.tipo === 'diagonal');
    const sentidos = new Set(diagonais.map(d => Math.sign(d.rotacaoZ ?? 0)));
    expect(sentidos).toEqual(new Set([1, -1]));
  });

  it('uma diagonal por nivel em cada divisa de posicao', () => {
    const b = fileira();
    const diagonais = pecasDaFileira(b).filter(p => p.tipo === 'diagonal');
    expect(diagonais).toHaveLength((posicoesDaFileira(b) + 1) * NIVEIS_POR_FILEIRA);
  });

  it('so a diagonal gira: montante e longarina sao ortogonais', () => {
    for (const p of pecasDaFileira(fileira())) {
      if (p.tipo === 'diagonal') expect(p.rotacaoZ).toBeTruthy();
      else expect(p.rotacaoZ ?? 0).toBe(0);
    }
  });

  it('a expedicao nao vira estante', () => {
    const exp = blocosDaPlanta().find(b => b.tipo === 'expedicao')!;
    expect(pecasDaFileira(exp)).toHaveLength(0);
    expect(posicoesDaFileira(exp)).toBe(0);
  });

  it('o galpao novo da 12 posicoes por fileira nos 15 m desenhados', () => {
    const novo = blocosDaPlanta().filter(b => b.rotulo === 'RUA E')[0];
    expect(posicoesDaFileira(novo)).toBe(12);
  });
});

describe('vaosDaFileira e mesasDaPlanta', () => {
  const fileiraE = () => blocosDaPlanta().filter(b => b.rotulo === 'RUA E')[0];

  it('o vao sabe o codigo do endereco que ocupa, no formato que o cadastro usa', () => {
    const vaos = vaosDaFileira(fileiraE());
    expect(vaos[0].codigo).toBe('PP-E01-N1');
    expect(vaos.find(v => v.posicao === 12 && v.nivel === 3)?.codigo).toBe('PP-E12-N3');
  });

  it('entrega posicoes x niveis vaos, um por endereco', () => {
    const b = fileiraE();
    expect(vaosDaFileira(b)).toHaveLength(posicoesDaFileira(b) * NIVEIS_POR_FILEIRA);
  });

  it('fileira sem rua cadastrada gera vao SEM codigo, e nao um codigo inventado', () => {
    const semRua = blocosDaPlanta().filter(b => b.tipo === 'fileira' && !b.rotulo)[0];
    expect(semRua).toBeDefined();
    expect(vaosDaFileira(semRua).every(v => v.codigo === null)).toBe(true);
  });

  it('o nivel 1 apoia no piso e nenhum vao passa da altura da estante', () => {
    const b = fileiraE();
    const vaos = vaosDaFileira(b);
    const base = Math.min(...vaos.map(v => v.centro[1] - v.tamanho[1] / 2));
    expect(base).toBeGreaterThanOrEqual(0);
    for (const v of vaos) {
      expect(v.centro[1] + v.tamanho[1] / 2).toBeLessThanOrEqual(b.tamanho[1] + 1e-9);
    }
  });

  it('o vao cabe dentro da fileira, sem invadir montante nem vizinho', () => {
    const b = fileiraE();
    for (const v of vaosDaFileira(b)) {
      expect(v.tamanho[0]).toBeLessThan(b.tamanho[0]);
      expect(v.centro[2] - v.tamanho[2] / 2).toBeGreaterThanOrEqual(b.centro[2] - b.tamanho[2] / 2 - 1e-9);
      expect(v.centro[2] + v.tamanho[2] / 2).toBeLessThanOrEqual(b.centro[2] + b.tamanho[2] / 2 + 1e-9);
    }
  });

  it('a expedicao nao gera vao: nao e estante', () => {
    const exp = blocosDaPlanta().find(b => b.tipo === 'expedicao')!;
    expect(vaosDaFileira(exp)).toHaveLength(0);
  });

  it('entrega 4 bancadas de embalagem e 5 baias, todas dentro do predio', () => {
    const mesas = mesasDaPlanta();
    expect(mesas).toHaveLength(9);
    for (const m of mesas) {
      expect(m.tipo).toBe('bancada');
      expect(m.centro[0] - m.tamanho[0] / 2).toBeGreaterThanOrEqual(0);
      expect(m.centro[0] + m.tamanho[0] / 2).toBeLessThanOrEqual(LARGURA_DO_PREDIO);
      // Apoiadas no chao, nao flutuando.
      expect(m.centro[1] - m.tamanho[1] / 2).toBeCloseTo(0, 6);
    }
  });

  it('nenhuma mesa cai em cima de uma fileira', () => {
    const fileiras = blocosDaPlanta().filter(b => b.tipo === 'fileira');
    for (const m of mesasDaPlanta()) {
      for (const f of fileiras) {
        const chocaX = Math.abs(m.centro[0] - f.centro[0]) < (m.tamanho[0] + f.tamanho[0]) / 2 - 1e-6;
        const chocaZ = Math.abs(m.centro[2] - f.centro[2]) < (m.tamanho[2] + f.tamanho[2]) / 2 - 1e-6;
        expect(chocaX && chocaZ).toBe(false);
      }
    }
  });
});

describe('a fileira nunca fica mais curta que o cadastro', () => {
  it('estende a fileira para caber todas as posicoes cadastradas', () => {
    // A planta desenha 10,5 m (8 posicoes) no predio atual, mas a rua A tem 13
    // cadastradas e a D tem 16. Sem estender, PP-A13-N3 com carga nao teria vao e a
    // mercadoria sumiria do mapa. Aconteceu em 23/11/2026.
    const real = { A: 13, B: 3, C: 7, D: 16, E: 12, F: 12, G: 12, H: 12 };
    const blocos = blocosDaPlanta(undefined, undefined, real);
    for (const [letra, posicoes] of Object.entries(real)) {
      const f = blocos.find(b => b.rotulo === `RUA ${letra}`)!;
      expect(posicoesDaFileira(f)).toBeGreaterThanOrEqual(posicoes);
    }
  });

  it('todo codigo cadastrado encontra um vao desenhado', () => {
    const real = { A: 13, B: 3, C: 7, D: 16, E: 12, F: 12, G: 12, H: 12 };
    const desenhados = new Set<string>();
    for (const f of blocosDaPlanta(undefined, undefined, real).filter(b => b.tipo === 'fileira')) {
      for (const v of vaosDaFileira(f)) if (v.codigo) desenhados.add(v.codigo);
    }
    for (const [letra, posicoes] of Object.entries(real)) {
      for (let p = 1; p <= posicoes; p++) {
        for (let n = 1; n <= NIVEIS_POR_FILEIRA; n++) {
          expect(desenhados.has(`PP-${letra}${String(p).padStart(2, '0')}-N${n}`)).toBe(true);
        }
      }
    }
  });

  it('rua menor que a planta NAO encolhe a fileira abaixo do desenho', () => {
    // A rua B tem 3 posicoes; a fileira continua com o comprimento da planta, porque
    // encolher deixaria um buraco no desenho do predio.
    const b = blocosDaPlanta(undefined, undefined, { B: 3 }).find(x => x.rotulo === 'RUA B')!;
    expect(b.tamanho[2]).toBeCloseTo(AZ2027_TERREO[0].comprimentoDaFileira, 6);
  });
});
