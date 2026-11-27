import { describe, expect, it } from 'vitest';
import {
  AZ2027_TERREO, EXPEDICAO, LARGURA_DO_PREDIO, PROFUNDIDADE_DA_FILEIRA,
  blocosDaPlanta, comprimentoTotal, posicoesEmX, pecasDaFileira, posicoesDaFileira, NIVEIS_POR_FILEIRA,
  vaosDaFileira, mesasDaPlanta, placasDasFileiras, faixasDePiso, ALTURA_DA_FILEIRA,
  sapatasDasFileiras, faixasDaExpedicao, pecasDaBancada, pecasDaMesa, PASSO_DA_POSICAO,
  type PecaDaFileira, type FaixaDePiso,
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

  it('entrega 4 bancadas de embalagem, todas dentro do predio', () => {
    // Eram 9: as 4 bancadas mais 5 "baias de pallets prontos" na expedicao. As baias
    // sairam por afirmarem mercadoria que nao existe em dado nenhum — ver o describe
    // 'mesasDaPlanta - o que a expedicao deixou de afirmar' no fim do arquivo.
    const mesas = mesasDaPlanta();
    expect(mesas).toHaveLength(4);
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

describe('placasDasFileiras - a sinalizacao de rua', () => {
  const fileiras = () => blocosDaPlanta().filter(b => b.tipo === 'fileira');

  it('poe duas placas por fileira, uma em cada ponta do corredor', () => {
    const placas = placasDasFileiras(fileiras());
    // 9 fileiras com rua cadastrada (A-D no predio atual, E-H no galpao novo), duas cada.
    const comRua = fileiras().filter(f => f.rotulo !== '');
    expect(placas).toHaveLength(comRua.length * 2);

    for (const f of comRua) {
      const letra = f.rotulo.replace('RUA ', '');
      const daFileira = placas.filter(p => p.rotulo === letra && p.x === f.centro[0]);
      expect(daFileira).toHaveLength(2);
      // Uma de cada lado do centro: a placa unica no meio obriga quem entrou pela outra
      // ponta a percorrer meia rua para saber onde esta.
      expect(Math.min(...daFileira.map(p => p.z))).toBeLessThan(f.centro[2]);
      expect(Math.max(...daFileira.map(p => p.z))).toBeGreaterThan(f.centro[2]);
    }
  });

  it('nenhuma placa paira para fora do comprimento da fileira', () => {
    for (const f of fileiras()) {
      const comeco = f.centro[2] - f.tamanho[2] / 2;
      const fim = f.centro[2] + f.tamanho[2] / 2;
      for (const placa of placasDasFileiras([f])) {
        expect(placa.z).toBeGreaterThanOrEqual(comeco);
        expect(placa.z).toBeLessThanOrEqual(fim);
      }
    }
  });

  it('a placa fica acima do topo da estante, nunca dentro dela', () => {
    for (const placa of placasDasFileiras(fileiras())) {
      expect(placa.y).toBeGreaterThan(ALTURA_DA_FILEIRA);
    }
  });

  it('a placa anuncia o tamanho da rua, e o numero bate com os vaos desenhados', () => {
    for (const f of fileiras().filter(b => b.rotulo !== '')) {
      const placa = placasDasFileiras([f])[0];
      expect(placa.posicoes).toBe(posicoesDaFileira(f));
    }
  });

  it('fileira sem rua cadastrada nao ganha placa', () => {
    const semRua = blocosDaPlanta(AZ2027_TERREO, {}).filter(b => b.tipo === 'fileira');
    expect(semRua.length).toBeGreaterThan(0);
    expect(placasDasFileiras(semRua)).toHaveLength(0);
  });

  it('ignora expedicao e bancada - so fileira tem rua', () => {
    const todos = [...blocosDaPlanta(), ...mesasDaPlanta()];
    const placas = placasDasFileiras(todos);
    expect(placas.every(p => /^[A-Z]+$/.test(p.rotulo))).toBe(true);
  });
});

describe('faixasDePiso - a demarcacao do pe da fileira', () => {
  const fileiras = () => blocosDaPlanta().filter(b => b.tipo === 'fileira');

  /** Intervalo ocupado em X pela faixa. */
  const emX = (f: FaixaDePiso): [number, number] => [
    f.centro[0] - f.tamanho[0] / 2,
    f.centro[0] + f.tamanho[0] / 2,
  ];
  const emZ = (f: FaixaDePiso): [number, number] => [
    f.centro[2] - f.tamanho[2] / 2,
    f.centro[2] + f.tamanho[2] / 2,
  ];

  it('uma faixa por fileira, e nada mais', () => {
    const todos = [...blocosDaPlanta(), ...mesasDaPlanta()];
    expect(faixasDePiso(todos)).toHaveLength(fileiras().length);
  });

  it('a faixa cobre a fileira inteira, com folga para fora', () => {
    const faixas = faixasDePiso(fileiras());
    fileiras().forEach((bloco, i) => {
      const [zi, zf] = emZ(faixas[i]);
      expect(zi).toBeLessThan(bloco.centro[2] - bloco.tamanho[2] / 2);
      expect(zf).toBeGreaterThan(bloco.centro[2] + bloco.tamanho[2] / 2);
      const [xi, xf] = emX(faixas[i]);
      expect(xi).toBeLessThanOrEqual(bloco.centro[0] - bloco.tamanho[0] / 2);
      expect(xf).toBeGreaterThanOrEqual(bloco.centro[0] + bloco.tamanho[0] / 2);
    });
  });

  it('duas fileiras costa-a-costa NAO produzem tinta sobreposta', () => {
    // O galpao novo tem a dupla central encostada. Com folga fixa dos dois lados, as
    // duas marcacoes invadiriam 0,44 m uma da outra: tinta coplanar, chao piscando.
    const blocos = fileiras();
    const faixas = faixasDePiso(blocos);

    for (let i = 0; i < faixas.length; i++) {
      for (let j = i + 1; j < faixas.length; j++) {
        const [ai, af] = emX(faixas[i]);
        const [bi, bf] = emX(faixas[j]);
        const [azi, azf] = emZ(faixas[i]);
        const [bzi, bzf] = emZ(faixas[j]);
        const cruzamEmZ = azi < bzf && bzi < azf;
        if (!cruzamEmZ) continue;
        const sobreposicao = Math.min(af, bf) - Math.max(ai, bi);
        expect(sobreposicao).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('a dupla central encosta uma marcacao na outra, sem vao de chao cru entre elas', () => {
    const blocos = fileiras().filter(b => b.id.startsWith('Galpão novo'));
    const faixas = faixasDePiso(blocos).sort((a, b) => a.centro[0] - b.centro[0]);
    // Fileiras 2 e 3 sao as costa-a-costa: as bordas internas tem de coincidir.
    expect(emX(faixas[1])[1]).toBeCloseTo(emX(faixas[2])[0], 9);
  });

  it('a tinta fica entre a faixa de circulacao do cenario e a demarcacao da expedicao', () => {
    for (const faixa of faixasDePiso(fileiras())) {
      const topo = faixa.centro[1] + faixa.tamanho[1] / 2;
      const base = faixa.centro[1] - faixa.tamanho[1] / 2;
      expect(base).toBeGreaterThan(0.005);
      expect(topo).toBeLessThan(0.02);
    }
  });

  it('corredor largo nao vira tinta larga: a folga tem teto', () => {
    const faixas = faixasDePiso(fileiras());
    fileiras().forEach((bloco, i) => {
      // Mesmo com 2,65 m de corredor ao lado, a marcacao nao passa de 0,22 m por lado.
      expect(faixas[i].tamanho[0]).toBeLessThanOrEqual(bloco.tamanho[0] + 0.22 * 2 + 1e-9);
    });
  });
});

describe('sapatasDasFileiras - a chapa de base do montante', () => {
  const pecas = () => blocosDaPlanta().filter(b => b.tipo === 'fileira').flatMap(b => pecasDaFileira(b));

  it('uma sapata por montante, e nada por longarina ou diagonal', () => {
    const todas = pecas();
    const montantes = todas.filter(p => p.tipo === 'montante');
    expect(montantes.length).toBeGreaterThan(0);
    expect(sapatasDasFileiras(todas)).toHaveLength(montantes.length);
  });

  it('cada sapata nasce exatamente debaixo do seu montante', () => {
    const todas = pecas();
    const montantes = todas.filter(p => p.tipo === 'montante');
    const sapatas = sapatasDasFileiras(todas);
    montantes.forEach((m, i) => {
      expect(sapatas[i].centro[0]).toBeCloseTo(m.centro[0], 9);
      expect(sapatas[i].centro[2]).toBeCloseTo(m.centro[2], 9);
    });
  });

  it('a sapata e mais larga que o montante - e por isso sobra para fora da chapa do vao', () => {
    const todas = pecas();
    const montante = todas.find(p => p.tipo === 'montante')!;
    const sapata = sapatasDasFileiras(todas)[0];
    expect(sapata.tamanho[0]).toBeGreaterThan(montante.tamanho[0]);
    expect(sapata.tamanho[2]).toBeGreaterThan(montante.tamanho[2]);
  });

  it('a sapata apoia NO piso, nunca enterrada nem flutuando', () => {
    for (const s of sapatasDasFileiras(pecas())) {
      expect(s.centro[1] - s.tamanho[1] / 2).toBeCloseTo(0, 9);
    }
  });

  it('nenhuma sapata invade o vao de palete da posicao vizinha', () => {
    // O passo ao longo da fileira e 1,2 m ou mais; a sapata tem 0,26.
    for (const s of sapatasDasFileiras(pecas())) {
      expect(s.tamanho[2]).toBeLessThan(PASSO_DA_POSICAO);
    }
  });
});

describe('faixasDaExpedicao - o zebrado da area de manobra', () => {
  const blocos = () => blocosDaPlanta();
  const area = () => blocos().find(b => b.tipo === 'expedicao')!;

  it('sem area de expedicao, nenhum traco', () => {
    expect(faixasDaExpedicao(blocos().filter(b => b.tipo === 'fileira'))).toHaveLength(0);
  });

  it('desenha tracos nos quatro lados', () => {
    const faixas = faixasDaExpedicao(blocos());
    const a = area();
    const [cx, , cz] = a.centro;
    const [largura, , comprimento] = a.tamanho;
    const naBordaZ = faixas.filter(f => Math.abs(Math.abs(f.centro[2] - cz) - (comprimento / 2 - 0.15)) < 1e-9);
    const naBordaX = faixas.filter(f => Math.abs(Math.abs(f.centro[0] - cx) - (largura / 2 - 0.15)) < 1e-9);
    expect(naBordaZ.length).toBeGreaterThan(0);
    expect(naBordaX.length).toBeGreaterThan(0);
    expect(faixas).toHaveLength(naBordaZ.length + naBordaX.length);
  });

  it('nenhum traco escapa da area que ele delimita', () => {
    const a = area();
    const [cx, , cz] = a.centro;
    const [largura, , comprimento] = a.tamanho;
    for (const f of faixasDaExpedicao(blocos())) {
      expect(f.centro[0] - f.tamanho[0] / 2).toBeGreaterThanOrEqual(cx - largura / 2 - 1e-9);
      expect(f.centro[0] + f.tamanho[0] / 2).toBeLessThanOrEqual(cx + largura / 2 + 1e-9);
      expect(f.centro[2] - f.tamanho[2] / 2).toBeGreaterThanOrEqual(cz - comprimento / 2 - 1e-9);
      expect(f.centro[2] + f.tamanho[2] / 2).toBeLessThanOrEqual(cz + comprimento / 2 + 1e-9);
    }
  });

  it('e tracejado de verdade: entre dois tracos vizinhos sobra chao', () => {
    const faixas = faixasDaExpedicao(blocos());
    const cz = area().centro[2];
    const comprimento = area().tamanho[2];
    const naBorda = faixas
      .filter(f => f.centro[2] < cz - comprimento / 2 + 0.3)
      .sort((a, b) => a.centro[0] - b.centro[0]);
    expect(naBorda.length).toBeGreaterThan(1);
    for (let i = 1; i < naBorda.length; i += 1) {
      const vao = (naBorda[i].centro[0] - naBorda[i].tamanho[0] / 2)
        - (naBorda[i - 1].centro[0] + naBorda[i - 1].tamanho[0] / 2);
      expect(vao).toBeGreaterThan(0.1);
    }
  });

  it('a tinta fica acima da chapa da expedicao, sem disputar profundidade com ela', () => {
    const chapa = area();
    const topoDaChapa = chapa.centro[1] + chapa.tamanho[1] / 2;
    for (const f of faixasDaExpedicao(blocos())) {
      expect(f.centro[1] - f.tamanho[1] / 2).toBeGreaterThanOrEqual(topoDaChapa);
    }
  });
});

describe('mesasDaPlanta — o que a expedicao deixou de afirmar', () => {
  it('sobraram as 4 bancadas de embalagem, e nada dentro da expedicao', () => {
    const mesas = mesasDaPlanta();
    expect(mesas).toHaveLength(4);
    expect(mesas.every(m => m.id.startsWith('bancada-'))).toBe(true);
  });

  it('nenhuma peca desenha mercadoria na area de expedicao', () => {
    // As 5 "baias de pallets prontos" eram cubos que nao correspondiam a dado nenhum.
    // Mercadoria desenhada sem lastro faz quem planeja carregamento contar pallets que
    // ninguem separou — e isso e pior que area vazia.
    const area = blocosDaPlanta().find(b => b.tipo === 'expedicao')!;
    for (const m of mesasDaPlanta()) {
      const dentro =
        Math.abs(m.centro[0] - area.centro[0]) < area.tamanho[0] / 2 &&
        Math.abs(m.centro[2] - area.centro[2]) < area.tamanho[2] / 2;
      expect(dentro).toBe(false);
    }
  });
});

describe('pecasDaBancada — a bancada que deixou de ser bloco', () => {
  const bancada = () => mesasDaPlanta()[0];

  it('ignora o que nao e bancada', () => {
    for (const b of blocosDaPlanta()) expect(pecasDaBancada(b)).toHaveLength(0);
  });

  it('da um tampo e quatro pes', () => {
    const pecas = pecasDaBancada(bancada());
    expect(pecas).toHaveLength(5);
    const tampos = pecas.filter(p => p.tamanho[0] > 1);
    expect(tampos).toHaveLength(1);
  });

  it('o tampo fecha exatamente no topo declarado da bancada', () => {
    const b = bancada();
    const [tampo] = pecasDaBancada(b);
    expect(tampo.centro[1] + tampo.tamanho[1] / 2).toBeCloseTo(b.tamanho[1], 9);
  });

  it('existe VAO por baixo: e isso que distingue bancada de caixote', () => {
    const b = bancada();
    const pecas = pecasDaBancada(b);
    const [tampo, ...pes] = pecas;
    // Os pes ocupam uma fracao pequena da planta do tampo; o resto e ar.
    const areaDoTampo = tampo.tamanho[0] * tampo.tamanho[2];
    const areaDosPes = pes.reduce((s, p) => s + p.tamanho[0] * p.tamanho[2], 0);
    expect(areaDosPes / areaDoTampo).toBeLessThan(0.05);
  });

  it('os quatro pes apoiam no piso e nenhum atravessa a borda do tampo', () => {
    const b = bancada();
    const [tampo, ...pes] = pecasDaBancada(b);
    expect(pes).toHaveLength(4);
    for (const pe of pes) {
      expect(pe.centro[1] - pe.tamanho[1] / 2).toBeCloseTo(0, 9);
      expect(Math.abs(pe.centro[0] - tampo.centro[0]) + pe.tamanho[0] / 2)
        .toBeLessThanOrEqual(tampo.tamanho[0] / 2 + 1e-9);
      expect(Math.abs(pe.centro[2] - tampo.centro[2]) + pe.tamanho[2] / 2)
        .toBeLessThanOrEqual(tampo.tamanho[2] / 2 + 1e-9);
    }
  });

  it('tampo mais pe somam a altura da bancada, sem sobra nem buraco', () => {
    const b = bancada();
    const [tampo, pe] = pecasDaBancada(b);
    expect(pe.tamanho[1] + tampo.tamanho[1]).toBeCloseTo(b.tamanho[1], 9);
  });
});


describe('pecasDaMesa — a mesa de expedicao nao e um caixote', () => {
  // Em jogo: a mesa colocada no Modo Construcao era desenhada como um `boxGeometry` do
  // tamanho inteiro. 1,6 x 0,9 x 0,8 de bloco macico no meio do corredor le como volume
  // intransponivel, que e a leitura OPOSTA da verdadeira: mesa e superficie, tem vao por
  // baixo. A forma agora e uma so, aqui, e tanto a bancada da planta quanto a peca do
  // builder a usam.
  const L = 1.6, A = 0.9, P = 0.8;
  const mesa = pecasDaMesa(L, A, P);

  it('e um tampo e quatro pes, nao uma caixa', () => {
    expect(mesa).toHaveLength(5);
  });

  it('o tampo cobre a mesa inteira e fica no alto', () => {
    const tampo = mesa[0];
    expect(tampo.tamanho[0]).toBe(L);
    expect(tampo.tamanho[2]).toBe(P);
    // Fino: tampo com a altura da mesa seria a caixa de volta.
    expect(tampo.tamanho[1]).toBeLessThan(A / 5);
    // Topo do tampo rente ao topo da mesa.
    expect(tampo.centro[1] + tampo.tamanho[1] / 2).toBeCloseTo(A / 2, 10);
  });

  it('ha vao por baixo: nenhum pe ocupa mais que uma fracao da planta do tampo', () => {
    const pes = mesa.slice(1);
    const areaDosPes = pes.reduce((soma, pe) => soma + pe.tamanho[0] * pe.tamanho[2], 0);
    // O que distingue mesa de bloco: o chao sob ela continua quase todo livre.
    expect(areaDosPes).toBeLessThan(L * P * 0.05);
  });

  it('os quatro pes vao do chao ate o tampo, sem flutuar nem furar o piso', () => {
    for (const pe of mesa.slice(1)) {
      expect(pe.centro[1] - pe.tamanho[1] / 2).toBeCloseTo(-A / 2, 10);
      expect(pe.centro[1] + pe.tamanho[1] / 2).toBeCloseTo(A / 2 - mesa[0].tamanho[1], 10);
    }
  });

  it('os pes ficam DENTRO do tampo, recuados da borda', () => {
    // Pe rente a borda le como quina de caixa e come o vao.
    for (const pe of mesa.slice(1)) {
      expect(Math.abs(pe.centro[0]) + pe.tamanho[0] / 2).toBeLessThanOrEqual(L / 2 + 1e-9);
      expect(Math.abs(pe.centro[2]) + pe.tamanho[2] / 2).toBeLessThanOrEqual(P / 2 + 1e-9);
      expect(Math.abs(pe.centro[0])).toBeLessThan(L / 2);
      expect(Math.abs(pe.centro[2])).toBeLessThan(P / 2);
    }
  });

  it('a bancada da planta e a MESMA mesa, so transladada', () => {
    // A divergencia e que custa caro: duas definicoes do mesmo movel acabam diferentes no
    // dia em que alguem mexe numa so.
    const bancada = mesasDaPlanta()[0];
    const naPlanta = pecasDaBancada(bancada);
    const [cx, , cz] = bancada.centro;
    const [bl, ba, bp] = bancada.tamanho;
    const local = pecasDaMesa(bl, ba, bp);

    expect(naPlanta).toHaveLength(local.length);
    naPlanta.forEach((pc, i) => {
      expect(pc.tamanho).toEqual(local[i].tamanho);
      expect(pc.centro[0]).toBeCloseTo(cx + local[i].centro[0], 10);
      expect(pc.centro[1]).toBeCloseTo(ba / 2 + local[i].centro[1], 10);
      expect(pc.centro[2]).toBeCloseTo(cz + local[i].centro[2], 10);
    });
  });

  it('nenhuma peca da bancada da planta fura o chao', () => {
    for (const pc of pecasDaBancada(mesasDaPlanta()[0])) {
      expect(pc.centro[1] - pc.tamanho[1] / 2).toBeGreaterThanOrEqual(-1e-9);
    }
  });
});
