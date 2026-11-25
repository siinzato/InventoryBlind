import { describe, expect, it } from 'vitest';
import {
  AZ2027_TERREO, EXPEDICAO, LARGURA_DO_PREDIO, PROFUNDIDADE_DA_FILEIRA,
  blocosDaPlanta, comprimentoTotal, posicoesEmX, pecasDaFileira, posicoesDaFileira, NIVEIS_POR_FILEIRA,
  vaosDaFileira, mesasDaPlanta, placasDasFileiras, faixasDePiso, ALTURA_DA_FILEIRA,
  sapatasDasFileiras, faixasDaExpedicao, equipamentosDaExpedicao, EMPILHADEIRA,
  PASSO_DA_POSICAO,
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

describe('equipamentosDaExpedicao - as empilhadeiras da doca', () => {
  const blocos = () => blocosDaPlanta();

  it('sem expedicao, nenhum equipamento', () => {
    const r = equipamentosDaExpedicao(blocos().filter(b => b.tipo === 'fileira'));
    expect(r.corpo).toHaveLength(0);
    expect(r.aco).toHaveLength(0);
    expect(r.pegadas).toHaveLength(0);
  });

  it('sao duas, com corpo, aco e pegada cada', () => {
    const r = equipamentosDaExpedicao(blocos());
    expect(r.pegadas).toHaveLength(2);
    expect(r.corpo).toHaveLength(4); // corpo + teto, por empilhadeira
    expect(r.aco).toHaveLength(12); // 2 colunas + 2 mastros + 2 garfos, por empilhadeira
  });

  it('nenhuma peca atravessa uma fileira de porta-pallets', () => {
    const fileiras = blocos().filter(b => b.tipo === 'fileira');
    const r = equipamentosDaExpedicao(blocos());
    for (const peca of [...r.corpo, ...r.aco]) {
      for (const f of fileiras) {
        const cruzaX = Math.abs(peca.centro[0] - f.centro[0]) < (peca.tamanho[0] + f.tamanho[0]) / 2;
        const cruzaZ = Math.abs(peca.centro[2] - f.centro[2]) < (peca.tamanho[2] + f.tamanho[2]) / 2;
        expect(cruzaX && cruzaZ).toBe(false);
      }
    }
  });

  it('nenhuma peca atravessa uma baia ou bancada', () => {
    const mesas = mesasDaPlanta();
    const r = equipamentosDaExpedicao(blocos());
    for (const peca of [...r.corpo, ...r.aco]) {
      for (const m of mesas) {
        const cruzaX = Math.abs(peca.centro[0] - m.centro[0]) < (peca.tamanho[0] + m.tamanho[0]) / 2;
        const cruzaZ = Math.abs(peca.centro[2] - m.centro[2]) < (peca.tamanho[2] + m.tamanho[2]) / 2;
        expect(cruzaX && cruzaZ).toBe(false);
      }
    }
  });

  it('as duas ficam dentro do predio e dentro da propria expedicao', () => {
    const area = blocos().find(b => b.tipo === 'expedicao')!;
    const r = equipamentosDaExpedicao(blocos());
    for (const peca of [...r.corpo, ...r.aco]) {
      expect(peca.centro[0] - peca.tamanho[0] / 2).toBeGreaterThanOrEqual(0);
      expect(peca.centro[0] + peca.tamanho[0] / 2).toBeLessThanOrEqual(LARGURA_DO_PREDIO);
      expect(peca.centro[2]).toBeGreaterThan(area.centro[2] - area.tamanho[2] / 2);
      expect(peca.centro[2]).toBeLessThan(area.centro[2] + area.tamanho[2] / 2);
    }
  });

  it('nenhuma peca fica enterrada no piso', () => {
    const r = equipamentosDaExpedicao(blocos());
    for (const peca of [...r.corpo, ...r.aco]) {
      expect(peca.centro[1] - peca.tamanho[1] / 2).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('a empilhadeira cabe no pe-direito, muito abaixo do topo da estante', () => {
    const r = equipamentosDaExpedicao(blocos());
    const topo = Math.max(...[...r.corpo, ...r.aco].map(p => p.centro[1] + p.tamanho[1] / 2));
    expect(topo).toBeCloseTo(EMPILHADEIRA.alturaDoMastro, 2);
    expect(topo).toBeLessThan(ALTURA_DA_FILEIRA);
  });

  it('a pegada cobre o corpo E os garfos - esbarra-se no garfo primeiro', () => {
    const r = equipamentosDaExpedicao(blocos());
    const garfos = r.aco.filter(p => p.tamanho[1] < 0.1);
    expect(garfos.length).toBe(4);
    for (const garfo of garfos) {
      const dentro = r.pegadas.some(
        p =>
          Math.abs(garfo.centro[0] - p.centro[0]) <= p.tamanho[0] / 2 + 1e-9 &&
          garfo.centro[2] - garfo.tamanho[2] / 2 >= p.centro[2] - p.tamanho[2] / 2 - 1e-9 &&
          garfo.centro[2] + garfo.tamanho[2] / 2 <= p.centro[2] + p.tamanho[2] / 2 + 1e-9,
      );
      expect(dentro).toBe(true);
    }
  });
});
