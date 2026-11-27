// A aritmética do Modo Construção.
//
// O que está em jogo: peça dentro de peça. No desenho isso parece só um pedaço escondido;
// na operação é um corredor que o mapa diz existir e que está bloqueado. Nada disso lança
// erro — e por isso a colisão se confere aqui, com números, e não olhando a cena.

import { describe, expect, it } from 'vitest';
import {
  PASSO_DA_GRADE, QUARTO_DE_VOLTA,
  alvoDeExclusao,
  codigosDaMesmaPosicao, posicaoDoCodigo,
  deLado, encaixar, lugarLivre, normalizarRotacao, pecaNoPonto, pegadaDaPeca,
  posicaoEmTexto, rotacaoEmGraus, sobrepoe,
  type Pegada,
} from '../warehouse3dBuilder';

const peca = (x: number, z: number, rotacaoY = 0, id = 'p') => ({ id, x, z, rotacaoY });

describe('deLado e normalizarRotacao — o giro em quartos de volta', () => {
  it('zero e meia volta ficam no eixo; um e tres quartos ficam de lado', () => {
    expect(deLado(0)).toBe(false);
    expect(deLado(QUARTO_DE_VOLTA)).toBe(true);
    expect(deLado(QUARTO_DE_VOLTA * 2)).toBe(false);
    expect(deLado(QUARTO_DE_VOLTA * 3)).toBe(true);
    expect(deLado(QUARTO_DE_VOLTA * 4)).toBe(false);
  });

  it('o giro acumulado NAO escorrega por erro de ponto flutuante', () => {
    // A guarda e o `Math.round` antes do modulo: sem ele, a rotacao que acumulou um
    // residuo minusculo seria classificada pelo resto cru, e a peca apareceria girada
    // de lado quando esta no eixo. Aqui o residuo entra de proposito.
    const residuo = 1e-9;
    expect(deLado(QUARTO_DE_VOLTA * 4 - residuo)).toBe(false);
    expect(deLado(QUARTO_DE_VOLTA * 4 + residuo)).toBe(false);
    expect(deLado(QUARTO_DE_VOLTA * 3 + residuo)).toBe(true);
    expect(normalizarRotacao(QUARTO_DE_VOLTA * 4 - residuo)).toBeCloseTo(0, 9);

    // E somando de verdade, quartos de volta seguidos nunca saem do eixo.
    let r = 0;
    for (let i = 0; i < 12; i += 1) {
      r += QUARTO_DE_VOLTA;
      expect(deLado(r)).toBe(i % 2 === 0);
    }
  });

  it('normalizar mantem a rotacao dentro de uma volta, por mais que se gire', () => {
    let r = 0;
    for (let i = 0; i < 50; i += 1) r = normalizarRotacao(r + QUARTO_DE_VOLTA);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(Math.PI * 2);
    // 50 quartos de volta = 12 voltas e meia -> meia volta.
    expect(rotacaoEmGraus(r)).toBe(180);
  });

  it('girar para tras tambem fica dentro da volta', () => {
    expect(normalizarRotacao(-QUARTO_DE_VOLTA)).toBeCloseTo(QUARTO_DE_VOLTA * 3, 9);
    expect(rotacaoEmGraus(-QUARTO_DE_VOLTA)).toBe(270);
  });
});

describe('encaixar — o fantasma gruda na linha que se esta vendo', () => {
  it('arredonda para o passo da grade', () => {
    expect(encaixar(3.4)).toBe(3);
    expect(encaixar(3.6)).toBe(4);
    expect(encaixar(-3.6)).toBe(-4);
  });

  it('passo diferente de 1 continua valendo', () => {
    expect(encaixar(3.4, 0.5)).toBe(3.5);
    expect(encaixar(3.1, 0.5)).toBe(3);
  });

  it('passo invalido devolve o valor, em vez de dividir por zero', () => {
    expect(encaixar(3.33, 0)).toBe(3.33);
    expect(encaixar(3.33, -1)).toBe(3.33);
  });

  it('o passo padrao e o da grade desenhada no piso', () => {
    expect(encaixar(2.5)).toBe(encaixar(2.5, PASSO_DA_GRADE));
  });
});

describe('pegadaDaPeca — a rotacao TROCA largura por profundidade', () => {
  it('sem giro, a pegada tem as medidas declaradas', () => {
    const p = pegadaDaPeca(peca(0, 0), 1.1, 3.6);
    expect(p.x1 - p.x0).toBeCloseTo(1.1, 9);
    expect(p.z1 - p.z0).toBeCloseTo(3.6, 9);
  });

  it('girada um quarto, as medidas trocam de eixo', () => {
    const p = pegadaDaPeca(peca(0, 0, QUARTO_DE_VOLTA), 1.1, 3.6);
    expect(p.x1 - p.x0).toBeCloseTo(3.6, 9);
    expect(p.z1 - p.z0).toBeCloseTo(1.1, 9);
  });

  it('girada meia volta, volta ao eixo original', () => {
    const p = pegadaDaPeca(peca(0, 0, QUARTO_DE_VOLTA * 2), 1.1, 3.6);
    expect(p.x1 - p.x0).toBeCloseTo(1.1, 9);
  });

  it('a pegada fica CENTRADA na peca', () => {
    const p = pegadaDaPeca(peca(5, -2), 2, 4);
    expect((p.x0 + p.x1) / 2).toBeCloseTo(5, 9);
    expect((p.z0 + p.z1) / 2).toBeCloseTo(-2, 9);
  });
});

describe('sobrepoe — encostar nao e colidir', () => {
  const a: Pegada = { x0: 0, x1: 2, z0: 0, z1: 2 };

  it('duas pegadas no mesmo lugar colidem', () => {
    expect(sobrepoe(a, { x0: 1, x1: 3, z0: 1, z1: 3 })).toBe(true);
  });

  it('encostadas pela borda NAO colidem', () => {
    // Encostar uma estante na outra e construcao normal num galpao; dar isso como
    // colisao obrigaria a deixar um metro de folga entre pecas que se tocam na vida real.
    expect(sobrepoe(a, { x0: 2, x1: 4, z0: 0, z1: 2 })).toBe(false);
    expect(sobrepoe(a, { x0: 0, x1: 2, z0: 2, z1: 4 })).toBe(false);
  });

  it('separadas em um eixo so ja nao colidem', () => {
    expect(sobrepoe(a, { x0: 1, x1: 3, z0: 5, z1: 7 })).toBe(false);
  });

  it('uma dentro da outra colide', () => {
    expect(sobrepoe(a, { x0: 0.5, x1: 1.5, z0: 0.5, z1: 1.5 })).toBe(true);
  });
});

describe('lugarLivre — o veredito do clique', () => {
  const colocadas = [
    { id: 'a', pegada: { x0: 0, x1: 2, z0: 0, z1: 2 } },
    { id: 'b', pegada: { x0: 5, x1: 7, z0: 5, z1: 7 } },
  ];

  it('lugar vazio aceita', () => {
    expect(lugarLivre({ x0: 10, x1: 12, z0: 10, z1: 12 }, colocadas)).toBe(true);
  });

  it('em cima de outra peca recusa', () => {
    expect(lugarLivre({ x0: 1, x1: 3, z0: 1, z1: 3 }, colocadas)).toBe(false);
  });

  it('a peca ARRASTADA nao colide consigo mesma', () => {
    // Sem isto, mover um centimetro seria sempre invalido e arrastar nao funcionaria.
    expect(lugarLivre({ x0: 0.1, x1: 2.1, z0: 0, z1: 2 }, colocadas, [], 'a')).toBe(true);
  });

  it('mas continua colidindo com as OUTRAS mesmo sendo a arrastada', () => {
    expect(lugarLivre({ x0: 5.5, x1: 7.5, z0: 5.5, z1: 7.5 }, colocadas, [], 'a')).toBe(false);
  });

  it('o armazem cadastrado tambem barra — e ele existe de verdade', () => {
    const fileira: Pegada = { x0: 20, x1: 21.1, z0: 0, z1: 15 };
    expect(lugarLivre({ x0: 20.5, x1: 22.5, z0: 1, z1: 3 }, colocadas, [fileira])).toBe(false);
    expect(lugarLivre({ x0: 22, x1: 24, z0: 1, z1: 3 }, colocadas, [fileira])).toBe(true);
  });

  it('sem nada colocado, qualquer lugar aceita', () => {
    expect(lugarLivre({ x0: 0, x1: 2, z0: 0, z1: 2 }, [])).toBe(true);
  });
});

describe('pecaNoPonto — a ultima colocada esta por cima', () => {
  const colocadas = [
    { id: 'embaixo', pegada: { x0: 0, x1: 4, z0: 0, z1: 4 } },
    { id: 'emcima', pegada: { x0: 1, x1: 2, z0: 1, z1: 2 } },
  ];

  it('devolve a de cima quando as duas cobrem o ponto', () => {
    expect(pecaNoPonto(1.5, 1.5, colocadas)).toBe('emcima');
  });

  it('devolve a de baixo fora da area da de cima', () => {
    expect(pecaNoPonto(3, 3, colocadas)).toBe('embaixo');
  });

  it('ponto vazio devolve nulo — e e isso que solta a selecao', () => {
    expect(pecaNoPonto(10, 10, colocadas)).toBe(null);
    expect(pecaNoPonto(0, 0, [])).toBe(null);
  });
});

describe('o gerenciador le a peca em texto', () => {
  it('posicao com uma casa e virgula decimal', () => {
    expect(posicaoEmTexto(peca(4.25, -2))).toBe('4,3 m · -2,0 m');
  });

  it('rotacao em graus, sempre dentro da volta', () => {
    expect(rotacaoEmGraus(0)).toBe(0);
    expect(rotacaoEmGraus(QUARTO_DE_VOLTA)).toBe(90);
    expect(rotacaoEmGraus(QUARTO_DE_VOLTA * 4)).toBe(0);
    expect(rotacaoEmGraus(QUARTO_DE_VOLTA * 5)).toBe(90);
  });
});

describe('alvoDeExclusao — qual das tres coisas o comando apaga', () => {
  const vaga = { id: 'PP-D16-N1' };

  it('fora do Modo Edicao nao ha alvo nenhum', () => {
    // A ficha da vaga continua abrindo ao clicar, mas apagar endereco nao pode ser
    // consequencia de um clique em modo de leitura.
    expect(alvoDeExclusao('operacional', null, vaga)).toBe(null);
    expect(alvoDeExclusao('operacional', 'obj-1', vaga)).toBe(null);
    expect(alvoDeExclusao('operacional', 'obj-1', null)).toBe(null);
  });

  it('peca do esboco selecionada vira alvo de peca', () => {
    expect(alvoDeExclusao('edicao', 'obj-1', null)).toEqual({ tipo: 'peca', id: 'obj-1' });
  });

  it('vaga selecionada vira alvo de ENDERECO — era isto que o botao ignorava', () => {
    expect(alvoDeExclusao('edicao', null, vaga)).toEqual({ tipo: 'endereco', codigo: 'PP-D16-N1' });
  });

  it('com as duas selecionadas, a PECA vence', () => {
    // Assimetria do estrago: apagar peca de esboco se desfaz saindo sem salvar; apagar
    // endereco vai ao banco e nao volta. Em duvida, o comando mira no reversivel.
    expect(alvoDeExclusao('edicao', 'obj-1', vaga)).toEqual({ tipo: 'peca', id: 'obj-1' });
  });

  it('sem nada selecionado nao ha alvo', () => {
    expect(alvoDeExclusao('edicao', null, null)).toBe(null);
  });
});

describe('a POSICAO: o que se chama de "aquele porta-pallets"', () => {
  const todos = [
    'PP-D16-N1', 'PP-D16-N2', 'PP-D16-N3',
    'PP-D15-N1',
    'PP-A01-N1', 'PP-A01-N2',
  ];

  it('tira o nivel do codigo', () => {
    expect(posicaoDoCodigo('PP-D16-N1')).toBe('PP-D16');
    expect(posicaoDoCodigo('PP-A01-N3')).toBe('PP-A01');
  });

  it('codigo fora do padrao nao tem posicao', () => {
    expect(posicaoDoCodigo('DOCA-1')).toBe(null);
    expect(posicaoDoCodigo('')).toBe(null);
  });

  it('junta todos os niveis da mesma posicao, de baixo para cima', () => {
    expect(codigosDaMesmaPosicao('PP-D16-N2', todos)).toEqual(['PP-D16-N1', 'PP-D16-N2', 'PP-D16-N3']);
  });

  it('nao arrasta a posicao vizinha nem a outra rua', () => {
    const r = codigosDaMesmaPosicao('PP-D16-N1', todos);
    expect(r).not.toContain('PP-D15-N1');
    expect(r).not.toContain('PP-A01-N1');
  });

  it('posicao de um nivel so devolve um endereco', () => {
    expect(codigosDaMesmaPosicao('PP-D15-N1', todos)).toEqual(['PP-D15-N1']);
  });

  it('codigo fora do padrao devolve so ele mesmo', () => {
    // Adivinhar agrupamento a partir de um codigo que nao se entende seria apagar mais do
    // que se apontou.
    expect(codigosDaMesmaPosicao('DOCA-1', todos)).toEqual(['DOCA-1']);
  });

  it('codigo que nao esta na lista devolve so ele mesmo', () => {
    expect(codigosDaMesmaPosicao('PP-Z99-N1', todos)).toEqual(['PP-Z99-N1']);
  });
});

describe('remover mesa — o alvo de exclusao nao olha o TIPO da peca', () => {
  // Em jogo: "nao consigo excluir as mesas". A exclusao de peca de esboco e deliberadamente
  // cega ao tipo — mesa, pallet, doca e porta-pallets saem pelo mesmo caminho. Qualquer
  // ramo por tipo aqui criaria uma peca que entra na cena e nao sai dela, que e exatamente
  // o estado que o cliente relatou. Estes testes travam essa indiferenca.
  const MESA = { largura: 1.6, profundidade: 0.8 };

  it('mesa selecionada vira alvo de exclusao como qualquer outra peca', () => {
    expect(alvoDeExclusao('edicao', 'obj-7', null)).toEqual({ tipo: 'peca', id: 'obj-7' });
  });

  it('a peca sempre ganha do endereco, inclusive sendo mesa', () => {
    // Com as duas coisas selecionadas, apagar o ENDERECO seria destrutivo e irreversivel
    // enquanto a pessoa achava que estava apagando o desenho.
    expect(alvoDeExclusao('edicao', 'mesa-1', { id: 'PP-D16-N1' })).toEqual({
      tipo: 'peca', id: 'mesa-1',
    });
  });

  it('clicar dentro da mesa resolve a mesa, e nao o vazio', () => {
    // Sem isto, o clique "nao seleciona nada" e o botao de excluir fica apagado — que e
    // indistinguivel de exclusao quebrada.
    const mesa = { id: 'mesa-1', pegada: pegadaDaPeca(peca(10, 4, 0, 'mesa-1'), MESA.largura, MESA.profundidade) };
    expect(pecaNoPonto(10, 4, [mesa])).toBe('mesa-1');
    expect(pecaNoPonto(10.7, 4, [mesa])).toBe('mesa-1');
    // Fora da pegada continua sendo vazio: clicar no piso ao lado SOLTA a selecao.
    expect(pecaNoPonto(11.2, 4, [mesa])).toBeNull();
  });

  it('mesa girada muda de pegada, e o clique acompanha', () => {
    const girada = {
      id: 'mesa-1',
      pegada: pegadaDaPeca(peca(10, 4, QUARTO_DE_VOLTA, 'mesa-1'), MESA.largura, MESA.profundidade),
    };
    // Girada, a mesa estende em Z o que estendia em X.
    expect(pecaNoPonto(10, 4.7, [girada])).toBe('mesa-1');
    expect(pecaNoPonto(10.7, 4, [girada])).toBeNull();
  });

  it('a mesa de cima e a que o clique pega quando duas se encostam', () => {
    const a = { id: 'mesa-a', pegada: pegadaDaPeca(peca(10, 4, 0, 'mesa-a'), MESA.largura, MESA.profundidade) };
    const b = { id: 'mesa-b', pegada: pegadaDaPeca(peca(10, 4, 0, 'mesa-b'), MESA.largura, MESA.profundidade) };
    expect(pecaNoPonto(10, 4, [a, b])).toBe('mesa-b');
  });

  it('fora do Modo Edicao nada e alvo, nem a mesa selecionada', () => {
    // Delete na vista operacional nao pode apagar o desenho.
    expect(alvoDeExclusao('operacional', 'mesa-1', { id: 'PP-D16-N1' })).toBeNull();
  });
});
