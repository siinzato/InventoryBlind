// A planta do galpão como GEOMETRIA, em metros.
//
// Até aqui o mapa 3D desenhava a partir do código da vaga: rua × 4 m, módulo × 1,3 m.
// O código diz "rua E, posição 3, nível 1" e NÃO diz onde a rua E fica no prédio, então
// a cena nunca teve como coincidir com a planta — ela era uma grade regular por cima de
// um desenho irregular.
//
// Este módulo inverte a origem: as estruturas vêm das MEDIDAS da planta, e cada fileira
// sabe seu lugar, seu comprimento e sua direção. É aritmética pura, fora do componente,
// porque errar aqui põe estante dentro de parede — e isso se confere por teste, não por
// olhar a cena.
//
// ── Eixos ─────────────────────────────────────────────────────────────────────────
// X = largura do prédio (0 → 10,3 m). Z = comprimento (0 → 45,2 m), do fundo do prédio
// atual até o portão da rua. Y = altura. A origem é o canto, e quem desenha centraliza.

/** Uma caixa do cenário, em metros, já posicionada pelo CENTRO. */
export interface BlocoFisico {
  id: string;
  tipo: 'fileira' | 'expedicao' | 'bancada' | 'piso';
  /** Centro: [x, y, z]. */
  centro: [number, number, number];
  /** Dimensões: [largura em X, altura em Y, comprimento em Z]. */
  tamanho: [number, number, number];
  /** Rótulo para quem olha a cena. Vazio quando não vale rotular. */
  rotulo: string;
}

/** Medidas de um prédio do conjunto, lidas da planta. */
export interface TrechoDaPlanta {
  nome: string;
  /** Onde este trecho começa no eixo Z. */
  zInicio: number;
  /** Comprimento do trecho em Z. */
  comprimento: number;
  /** Quantas fileiras de porta-pallets, lado a lado no eixo X. */
  fileiras: number;
  /** Comprimento de cada fileira, em metros. */
  comprimentoDaFileira: number;
  /** Corredor transversal livre no começo do trecho. */
  corredorInicio: number;
  /**
   * Agrupamento das fileiras no eixo X.
   *
   * `uniforme` espalha todas com o mesmo passo — é o prédio atual, onde a planta mostra
   * cinco fileiras igualmente espaçadas. `dupla-central` é o galpão novo: uma colada na
   * parede esquerda, duas costa-a-costa no meio, uma na parede direita, com corredor de
   * empilhadeira entre os blocos. As duas distribuições produzem posições diferentes para
   * o mesmo número de fileiras, e trocar uma pela outra põe rack em cima de corredor.
   */
  distribuicao: 'uniforme' | 'dupla-central';
  /** Largura do corredor longitudinal entre blocos de fileira. */
  corredorLongitudinal: number;
}

/** Largura do prédio, comum aos dois trechos. */
export const LARGURA_DO_PREDIO = 10.3;

/** Profundidade de uma fileira de porta-pallets (palete PBR mais folga de viga). */
export const PROFUNDIDADE_DA_FILEIRA = 1.1;

/** Altura da estante de três níveis, que é o que as ruas cadastradas têm. */
export const ALTURA_DA_FILEIRA = 4.2;

/**
 * AZ 2027 — térreo, como a planta descreve.
 *
 * As medidas são as da própria planta (HomeByMe + fotos), que ela mesma declara
 * aproximadas. Reproduzir fielmente o DESENHO não é o mesmo que reproduzir o galpão:
 * quando houver levantamento técnico, estes números mudam e a cena acompanha.
 */
export const AZ2027_TERREO: TrechoDaPlanta[] = [
  {
    nome: 'Prédio atual',
    zInicio: 0,
    comprimento: 18.6,
    fileiras: 5,
    // 3 módulos de 3,5 m cada, como a planta anota.
    comprimentoDaFileira: 10.5,
    corredorInicio: 1.4,
    distribuicao: 'uniforme',
    // Não cotado na planta; é o que sobra entre cinco fileiras na largura de 10,3 m.
    corredorLongitudinal: 1.2,
  },
  {
    nome: 'Galpão novo',
    zInicio: 18.6,
    comprimento: 26.6,
    fileiras: 4,
    // 26,6 menos o corredor de 2,2 na entrada, o de 1,8 no fim e os 7,6 da expedição.
    comprimentoDaFileira: 15.0,
    corredorInicio: 2.2,
    distribuicao: 'dupla-central',
    corredorLongitudinal: 2.65,
  },
];

/** Expedição / carga e descarga, no fim do galpão novo. */
export const EXPEDICAO = { largura: 9.7, comprimento: 7.6 } as const;

/**
 * Posições em X dos centros das fileiras de um trecho.
 *
 * `uniforme` divide a largura inteira: com N fileiras e N−1 corredores, sobra uma folga
 * que é repartida nas duas bordas, para a fileira da ponta não nascer atravessando a
 * parede.
 *
 * `dupla-central` monta três blocos — parede, dupla, parede — e centra o conjunto.
 */
export function posicoesEmX(trecho: TrechoDaPlanta, larguraDoPredio = LARGURA_DO_PREDIO): number[] {
  const p = PROFUNDIDADE_DA_FILEIRA;

  if (trecho.distribuicao === 'uniforme') {
    const passo = p + trecho.corredorLongitudinal;
    const ocupado = trecho.fileiras * p + (trecho.fileiras - 1) * trecho.corredorLongitudinal;
    const borda = (larguraDoPredio - ocupado) / 2;
    return Array.from({ length: trecho.fileiras }, (_, i) => borda + p / 2 + i * passo);
  }

  // dupla-central: 1 na esquerda, 2 costa-a-costa no meio, o resto na direita.
  const noMeio = Math.max(0, trecho.fileiras - 2);
  const ocupado = trecho.fileiras * p + 2 * trecho.corredorLongitudinal;
  const borda = (larguraDoPredio - ocupado) / 2;

  const xs: number[] = [borda + p / 2];
  let cursor = borda + p + trecho.corredorLongitudinal;
  for (let i = 0; i < noMeio; i++) {
    xs.push(cursor + p / 2);
    cursor += p;
  }
  cursor += trecho.corredorLongitudinal;
  xs.push(cursor + p / 2);
  return xs;
}

/**
 * Todos os blocos da planta, prontos para desenhar.
 *
 * `rotulosPorTrecho` nomeia as fileiras na ordem em que elas aparecem no eixo X. É o que
 * liga o desenho às ruas cadastradas (A–D no prédio atual, E–H no galpão novo). Trecho
 * sem rótulo suficiente deixa a fileira sem nome em vez de inventar um.
 */
export function blocosDaPlanta(
  trechos: TrechoDaPlanta[] = AZ2027_TERREO,
  rotulosPorTrecho: Record<string, string[]> = { 'Prédio atual': ['A', 'B', 'C', 'D'], 'Galpão novo': ['E', 'F', 'G', 'H'] },
): BlocoFisico[] {
  const blocos: BlocoFisico[] = [];

  for (const trecho of trechos) {
    const xs = posicoesEmX(trecho);
    const zInicioDasFileiras = trecho.zInicio + trecho.corredorInicio;
    const zCentro = zInicioDasFileiras + trecho.comprimentoDaFileira / 2;
    const rotulos = rotulosPorTrecho[trecho.nome] ?? [];

    xs.forEach((x, i) => {
      blocos.push({
        id: `${trecho.nome}-fileira-${i + 1}`,
        tipo: 'fileira',
        centro: [x, ALTURA_DA_FILEIRA / 2, zCentro],
        tamanho: [PROFUNDIDADE_DA_FILEIRA, ALTURA_DA_FILEIRA, trecho.comprimentoDaFileira],
        rotulo: rotulos[i] ? `RUA ${rotulos[i]}` : '',
      });
    });
  }

  // Expedição: rente ao chão, no fim do último trecho.
  const ultimo = trechos[trechos.length - 1];
  if (ultimo) {
    const fimDoPredio = ultimo.zInicio + ultimo.comprimento;
    blocos.push({
      id: 'expedicao',
      tipo: 'expedicao',
      centro: [LARGURA_DO_PREDIO / 2, 0.02, fimDoPredio - EXPEDICAO.comprimento / 2],
      tamanho: [EXPEDICAO.largura, 0.04, EXPEDICAO.comprimento],
      rotulo: 'EXPEDIÇÃO',
    });
  }

  return blocos;
}

/** Comprimento total do conjunto, somando os trechos. */
export function comprimentoTotal(trechos: TrechoDaPlanta[] = AZ2027_TERREO): number {
  return trechos.reduce((soma, t) => Math.max(soma, t.zInicio + t.comprimento), 0);
}
