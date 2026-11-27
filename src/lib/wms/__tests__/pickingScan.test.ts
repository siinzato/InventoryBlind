// A aritmetica da bipagem. E a parte que decide se uma baixa acontece, e num corredor
// com sinal ruim ela precisa ser conferivel sem camera, sem banco e sem aparelho.

import { describe, expect, it } from 'vitest';
import {
  candidatosNaOnda, chaveDaTentativa, chaveDeterministica, classificarQuantidade,
  enderecoConfere, etapaDaBipagem, progressoDaRota, type ItemBipavel,
} from '../pickingScan';

describe('etapaDaBipagem — a ordem e estrita', () => {
  it('endereco vem antes de produto, e produto antes de quantidade', () => {
    // Conferir o produto antes do endereco aceitaria a caixa certa tirada da vaga
    // errada — e e assim que o saldo de DOIS enderecos passa a mentir ao mesmo tempo.
    expect(etapaDaBipagem({ enderecoConfirmado: false, produtoConfirmado: null })).toBe('endereco');
    expect(etapaDaBipagem({ enderecoConfirmado: false, produtoConfirmado: 'SKU' })).toBe('endereco');
    expect(etapaDaBipagem({ enderecoConfirmado: true, produtoConfirmado: null })).toBe('produto');
    expect(etapaDaBipagem({ enderecoConfirmado: true, produtoConfirmado: 'SKU' })).toBe('quantidade');
  });
});

describe('enderecoConfere — o que o leitor laser manda', () => {
  it('aceita caixa baixa e espaco das pontas', () => {
    // O leitor manda o codigo com Enter colado e, em alguns aparelhos, em caixa baixa.
    expect(enderecoConfere(' pp-a01-n1 ', 'PP-A01-N1')).toBe(true);
    expect(enderecoConfere('PP-A01-N1', 'pp-a01-n1')).toBe(true);
  });

  it('recusa endereco diferente e leitura vazia', () => {
    expect(enderecoConfere('PP-A01-N2', 'PP-A01-N1')).toBe(false);
    expect(enderecoConfere('', 'PP-A01-N1')).toBe(false);
    expect(enderecoConfere('   ', 'PP-A01-N1')).toBe(false);
  });
});

describe('candidatosNaOnda — os 199 EANs repetidos', () => {
  const itens: ItemBipavel[] = [
    { produtoId: 'p1', sku: 'TBGCM55-14', ean: '7900337078617' },
    { produtoId: 'p2', sku: 'TBGCM55-15', ean: '7900337078617' },
    { produtoId: 'p3', sku: 'GFGCM13-20', ean: null },
  ];

  it('EAN repetido devolve TODOS os candidatos da onda', () => {
    // Escolher o primeiro em silencio e dar baixa no SKU errado com a confirmacao do
    // sistema.
    expect(candidatosNaOnda('7900337078617', itens).map(i => i.produtoId)).toEqual(['p1', 'p2']);
  });

  it('SKU tem precedencia sobre EAN', () => {
    // Quem digita o SKU esta sendo explicito; nenhum EAN deve competir com isso.
    expect(candidatosNaOnda('TBGCM55-14', itens).map(i => i.produtoId)).toEqual(['p1']);
    expect(candidatosNaOnda('tbgcm55-14', itens).map(i => i.produtoId)).toEqual(['p1']);
  });

  it('codigo fora da onda devolve vazio, e isso NAO e um erro', () => {
    // Lista vazia nao interrompe o envio: a leitura segue para o banco, que recusa e
    // grava o evento. Recusa que o cliente engole nao existe para quem investigar depois.
    expect(candidatosNaOnda('NAO-EXISTE', itens)).toEqual([]);
    expect(candidatosNaOnda('', itens)).toEqual([]);
  });

  it('item sem EAN nunca casa com string vazia', () => {
    expect(candidatosNaOnda('   ', itens)).toEqual([]);
  });
});

describe('classificarQuantidade', () => {
  it('separa total, parcial e excesso', () => {
    expect(classificarQuantidade(3, 3)).toBe('total');
    expect(classificarQuantidade(1, 3)).toBe('parcial');
    expect(classificarQuantidade(4, 3)).toBe('excesso');
  });

  it('zero e fracao sao invalidos — caixa fracionada nao existe na prateleira', () => {
    expect(classificarQuantidade(0, 3)).toBe('invalida');
    expect(classificarQuantidade(-1, 3)).toBe('invalida');
    expect(classificarQuantidade(1.5, 3)).toBe('invalida');
    expect(classificarQuantidade(Number.NaN, 3)).toBe('invalida');
  });
});

describe('chave de idempotencia — a rede do galpao caindo no meio do POST', () => {
  it('a MESMA acao reenviada gera a MESMA chave', () => {
    // E o ponto inteiro: chave nova a cada tentativa transformaria o reenvio depois de
    // um timeout numa segunda baixa.
    expect(chaveDaTentativa('aloc-1', 'separar', 2, 1))
      .toBe(chaveDaTentativa('aloc-1', 'separar', 2, 1));
  });

  it('acoes diferentes na mesma parada geram chaves diferentes', () => {
    const base = chaveDaTentativa('aloc-1', 'separar', 2, 1);
    expect(chaveDaTentativa('aloc-1', 'separar', 3, 1)).not.toBe(base);  // corrigiu a quantidade
    expect(chaveDaTentativa('aloc-1', 'separar', 2, 2)).not.toBe(base);  // nova tentativa
    expect(chaveDaTentativa('aloc-1', 'ruptura', 2, 1)).not.toBe(base);  // outra acao
    expect(chaveDaTentativa('aloc-2', 'separar', 2, 1)).not.toBe(base);  // outra parada
  });

  it('o formato e UUID valido, versao 4 e variante RFC 4122', () => {
    // O destino e uma coluna `uuid`: texto que nao e UUID seria recusado pelo banco no
    // pior momento possivel — com o operador parado na frente da prateleira.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const semente of ['', 'a', 'aloc-1|separar|2|1', 'x'.repeat(500)]) {
      expect(chaveDeterministica(semente)).toMatch(uuid);
    }
  });

  it('sementes proximas nao colidem', () => {
    const chaves = new Set<string>();
    for (let i = 0; i < 500; i += 1) chaves.add(chaveDaTentativa('aloc-1', 'separar', 1, i));
    expect(chaves.size).toBe(500);
  });
});

describe('progressoDaRota — o que o operador ve na barra', () => {
  const parada = (estado: string, caixas: number, separadas: number) => ({ estado, caixas, separadas });

  it('conta pelas CAIXAS, nao pelas paradas', () => {
    // Uma parada de 1 caixa e outra de 40 nao valem o mesmo para quem empurra o
    // carrinho; medir por parada mostraria 50% com 1 de 41 caixas separadas.
    const p = progressoDaRota([parada('separado', 1, 1), parada('pendente', 40, 0)]);
    expect(p.caixasPedidas).toBe(41);
    expect(p.caixasSeparadas).toBe(1);
    expect(p.percentual).toBe(2);
  });

  it('ruptura e cancelamento encerram a parada', () => {
    const p = progressoDaRota([
      parada('separado', 2, 2), parada('ruptura', 1, 0),
      parada('cancelado', 1, 0), parada('parcial', 3, 1), parada('pendente', 1, 0),
    ]);
    expect(p.paradasTotais).toBe(5);
    expect(p.paradasEncerradas).toBe(3);
  });

  it('rota vazia nao divide por zero', () => {
    expect(progressoDaRota([])).toEqual({
      paradasTotais: 0, paradasEncerradas: 0, caixasPedidas: 0, caixasSeparadas: 0, percentual: 0,
    });
  });
});

describe('progressoDaRota — a ruptura com realocacao nao conta a demanda duas vezes', () => {
  const parada = (estado: string, caixas: number, separadas: number) => ({ estado, caixas, separadas });

  it('uma caixa que mudou de endereco continua sendo UMA caixa', () => {
    // Medido na tela: onda de 1 caixa, depois da ruptura com realocacao, dizia "2 caixas
    // sem separar". A rota passa a ter DUAS linhas para a mesma caixa.
    const p = progressoDaRota([parada('ruptura', 1, 0), parada('pendente', 1, 0)]);
    expect(p.caixasPedidas).toBe(1);
    expect(p.caixasSeparadas).toBe(0);
  });

  it('parcial seguida de ruptura conta o que de fato saiu', () => {
    // A parada deu 1 caixa de verdade e as outras 2 foram realocadas: 1 + 2 = 3.
    const p = progressoDaRota([parada('ruptura', 3, 1), parada('pendente', 2, 0)]);
    expect(p.caixasPedidas).toBe(3);
    expect(p.caixasSeparadas).toBe(1);
  });

  it('parada cancelada no fechamento nao infla o pedido', () => {
    const p = progressoDaRota([parada('separado', 2, 2), parada('cancelado', 5, 0)]);
    expect(p.caixasPedidas).toBe(2);
    expect(p.percentual).toBe(100);
  });
});

describe('fluxo de desambiguacao — o contrato que a tela do separador usa', () => {
  // Nao ha, HOJE, dois SKUs com saldo que compartilhem EAN (medido no banco: zero pares
  // entre os 6 com saldo), entao este caminho nao da para exercitar na tela com dado
  // real. O contrato fica travado aqui, que e onde ele continua valendo quando o
  // cadastro mudar.
  const itens: ItemBipavel[] = [
    { produtoId: 'p1', sku: 'SKU-A', ean: '789' },
    { produtoId: 'p2', sku: 'SKU-B', ean: '789' },
  ];

  it('EAN repetido na onda: a tela PERGUNTA em vez de escolher', () => {
    expect(candidatosNaOnda('789', itens).length).toBeGreaterThan(1);
  });

  it('depois da escolha, o candidato ainda e conferido contra a parada', () => {
    // E o segundo portao: escolher "SKU-B" numa parada de "SKU-A" tem de ser recusado,
    // senao a desambiguacao viraria um jeito de dar baixa no produto errado.
    const paradaDeA: ItemBipavel = { produtoId: 'p1', sku: 'SKU-A', ean: '789' };
    expect(candidatosNaOnda('SKU-A', [paradaDeA])).toHaveLength(1);
    expect(candidatosNaOnda('SKU-B', [paradaDeA])).toHaveLength(0);
  });

  it('o EAN compartilhado SOZINHO nao prova que e o produto da parada', () => {
    // Bipar o EAN numa parada cujo produto tambem o carrega casa — e e por isso que a
    // pergunta vem antes, com os dois candidatos na tela.
    const paradaDeA: ItemBipavel = { produtoId: 'p1', sku: 'SKU-A', ean: '789' };
    expect(candidatosNaOnda('789', [paradaDeA])).toHaveLength(1);
  });
});
