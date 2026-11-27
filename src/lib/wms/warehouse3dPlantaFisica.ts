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
  tipo: 'fileira' | 'expedicao' | 'bancada';
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
  posicoesCadastradas: Record<string, number> = {},
): BlocoFisico[] {
  const blocos: BlocoFisico[] = [];

  for (const trecho of trechos) {
    const xs = posicoesEmX(trecho);
    const zInicioDasFileiras = trecho.zInicio + trecho.corredorInicio;
    const rotulos = rotulosPorTrecho[trecho.nome] ?? [];

    xs.forEach((x, i) => {
      const letra = rotulos[i];

      // A fileira nunca é mais curta do que o CADASTRO exige.
      //
      // A planta diz 10,5 m para as fileiras do prédio atual (3 módulos de 3,5 m), o
      // que dá 8 posições. Mas a rua A tem 13 cadastradas e a D tem 16 — e com 8 vãos
      // desenhados, `PP-A13-N3` com 16 caixas simplesmente NÃO APARECIA no mapa.
      // Mercadoria sumindo do desenho é pior que desenho fora de medida: a medida da
      // planta é aproximada e o cadastro é o que a operação usa todo dia.
      const posicoes = letra ? posicoesCadastradas[letra] ?? 0 : 0;
      const comprimento = Math.max(trecho.comprimentoDaFileira, posicoes * PASSO_DA_POSICAO);

      blocos.push({
        id: `${trecho.nome}-fileira-${i + 1}`,
        tipo: 'fileira',
        centro: [x, ALTURA_DA_FILEIRA / 2, zInicioDasFileiras + comprimento / 2],
        tamanho: [PROFUNDIDADE_DA_FILEIRA, ALTURA_DA_FILEIRA, comprimento],
        rotulo: letra ? `RUA ${letra}` : '',
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

// ── A estante de verdade ─────────────────────────────────────────────────────────────
//
// Uma fileira NÃO é um bloco maciço. Desenhada como caixa cheia ela vira muro de
// concreto: some o vão onde o palete entra, somem os montantes, some a leitura de
// "quantas posições tem esta rua". O volume fechado também mente sobre ocupação — um
// porta-pallets vazio é quase todo ar.
//
// Aqui a fileira é decomposta nas peças que ela tem no galpão: montantes verticais nas
// divisas de posição e longarinas corridas por nível. As medidas de seção são as mesmas
// que `warehouse3dEstrutura.ts` já usa para as vagas montadas por código, para as duas
// vistas não parecerem dois produtos diferentes.

/** Vão de uma posição de palete ao longo da fileira. */
export const PASSO_DA_POSICAO = 1.2;

/** Níveis de armazenagem por fileira — o mesmo que as ruas A e B têm cadastrado. */
export const NIVEIS_POR_FILEIRA = 3;

/** Seção do montante e altura da longarina, iguais às da estrutura por código. */
const SECAO_MONTANTE = 0.09;
const ALTURA_DA_VIGA = 0.07;

/**
 * Seção da diagonal de contraventamento. Mais fina que o montante, como no galpão: ela
 * trava o quadro, não sustenta carga.
 */
const SECAO_DA_DIAGONAL = 0.04;

export interface PecaDaFileira {
  tipo: 'montante' | 'viga' | 'diagonal';
  /** Centro em metros, no mesmo referencial dos blocos (origem no canto da planta). */
  centro: [number, number, number];
  tamanho: [number, number, number];
  /**
   * Giro em torno de Z, em radianos. Só a diagonal usa — montante e longarina são
   * ortogonais. Ausente significa zero.
   */
  rotacaoZ?: number;
}

/**
 * Montantes e longarinas de uma fileira.
 *
 * O passo real é o comprimento dividido pelo número INTEIRO de posições que cabem, e não
 * 1,2 m fixo: com passo fixo a última posição sobraria para fora da fileira ou deixaria
 * um pedaço órfão no fim. Dividir o comprimento faz os montantes das pontas caírem
 * exatamente nas extremidades.
 */
export function pecasDaFileira(bloco: BlocoFisico): PecaDaFileira[] {
  if (bloco.tipo !== 'fileira') return [];

  const [cx, , cz] = bloco.centro;
  const [profundidade, altura, comprimento] = bloco.tamanho;

  const posicoes = posicoesDaFileira(bloco);
  const passo = comprimento / posicoes;
  const zInicio = cz - comprimento / 2;

  // Montante e longarina ficam nas duas faces da fileira, recuados meia seção para não
  // sobrar metade da peça para fora da profundidade declarada.
  const faces = [
    cx - profundidade / 2 + SECAO_MONTANTE / 2,
    cx + profundidade / 2 - SECAO_MONTANTE / 2,
  ];

  const pecas: PecaDaFileira[] = [];

  // Montantes: um a mais que o número de posições, porque eles ficam nas DIVISAS.
  for (let i = 0; i <= posicoes; i++) {
    const z = zInicio + i * passo;
    for (const x of faces) {
      pecas.push({
        tipo: 'montante',
        centro: [x, altura / 2, z],
        tamanho: [SECAO_MONTANTE, altura, SECAO_MONTANTE],
      });
    }
  }

  // Diagonais de contraventamento: o que faz dois montantes virarem um QUADRO.
  //
  // É o detalhe que distingue porta-pallets de andaime, e por muito tempo faltou aqui:
  // sem a treliça, o par de colunas lê como duas barras soltas ligadas por prateleira.
  // No galpão a diagonal cruza a PROFUNDIDADE — ela trava o quadro no sentido em que o
  // pallet entra, que é para onde a estante tomba.
  //
  // Alternando o sentido a cada nível e a cada divisa sai o zigue-zague da estante real,
  // em vez de um feixe de riscos paralelos.
  const vaoDaDiagonal = profundidade - SECAO_MONTANTE;
  const alturaDoNivelDaDiagonal = altura / NIVEIS_POR_FILEIRA;
  // A subida é um nível MENOS a espessura da própria peça, e isso foi medido, não
  // estimado: inclinada, a caixa ocupa em Y a subida mais a projeção da seção, e com a
  // subida cheia a diagonal do último nível furava 1,2 cm acima do topo da estante.
  const subidaDaDiagonal = alturaDoNivelDaDiagonal - SECAO_DA_DIAGONAL;
  const comprimentoDaDiagonal = Math.hypot(vaoDaDiagonal, subidaDaDiagonal);
  const anguloDaDiagonal = Math.atan2(subidaDaDiagonal, vaoDaDiagonal);

  for (let i = 0; i <= posicoes; i++) {
    const z = zInicio + i * passo;
    for (let n = 1; n <= NIVEIS_POR_FILEIRA; n++) {
      pecas.push({
        tipo: 'diagonal',
        centro: [cx, (n - 1) * alturaDoNivelDaDiagonal + alturaDoNivelDaDiagonal / 2, z],
        // Comprida em X antes do giro: girada em torno de Z, ela se inclina no plano do
        // quadro (X–Y), que é o plano em que os dois montantes vivem.
        tamanho: [comprimentoDaDiagonal, SECAO_DA_DIAGONAL, SECAO_DA_DIAGONAL],
        rotacaoZ: (i + n) % 2 === 0 ? anguloDaDiagonal : -anguloDaDiagonal,
      });
    }
  }

  // Longarinas: corridas pelo comprimento inteiro, uma por nível em cada face.
  //
  // O `- ALTURA_DA_VIGA / 2` não é detalhe: centrada na altura do nível, metade da
  // longarina do último nível sobra PARA FORA da estante (4,235 contra 4,2 de altura).
  // Subtraindo meia altura, o TOPO da peça encosta no nível, que é onde a longarina
  // fica numa estante de verdade — o palete apoia em cima dela.
  const alturaDoNivel = altura / NIVEIS_POR_FILEIRA;
  for (let n = 1; n <= NIVEIS_POR_FILEIRA; n++) {
    const y = n * alturaDoNivel - ALTURA_DA_VIGA / 2;
    for (const x of faces) {
      pecas.push({
        tipo: 'viga',
        centro: [x, y, cz],
        tamanho: [SECAO_MONTANTE, ALTURA_DA_VIGA, comprimento],
      });
    }
  }

  return pecas;
}

/**
 * Quantas posições de palete a fileira comporta, por nível.
 *
 * Arredonda para BAIXO, e isso é o ponto. Arredondando para cima, os 15 m do galpão novo
 * dariam 13 posições — vão de 1,154 m, onde um palete PBR de 1,20 m não entra. O
 * resultado seria uma estante que o desenho promete e a operação não tem. Para baixo dá
 * 12 posições de 1,25 m, que cabem.
 */
export function posicoesDaFileira(bloco: BlocoFisico): number {
  if (bloco.tipo !== 'fileira') return 0;
  return Math.max(1, Math.floor(bloco.tamanho[2] / PASSO_DA_POSICAO));
}

/**
 * Um vão da estante: uma posição de palete, num nível.
 *
 * É o que se clica. Cada vão corresponde a UM endereço — `PP-E03-N2` é a posição 3 da
 * rua E no nível 2 —, então o desenho e o cadastro passam a falar do mesmo objeto, em
 * vez de serem duas descrições paralelas do mesmo galpão.
 */
export interface VaoDaFileira {
  /** Código do endereço, ou null quando a fileira não tem rua cadastrada. */
  codigo: string | null;
  /** 1-based, ao longo do comprimento da fileira. */
  posicao: number;
  /** 1-based, de baixo para cima. */
  nivel: number;
  centro: [number, number, number];
  tamanho: [number, number, number];
}

/** Letra da rua a partir do rótulo ("RUA E" → "E"). */
function letraDaRua(rotulo: string): string | null {
  const m = /^RUA\s+([A-Z]+)$/.exec(rotulo.trim());
  return m ? m[1] : null;
}

/**
 * Os vãos clicáveis de uma fileira.
 *
 * O código é montado no MESMO formato que `buildBinCodes` grava — prefixo, letra,
 * posição com dois dígitos, nível. Montar diferente produziria vão que não acha vaga
 * nenhuma, e o clique cairia no vazio sem erro para explicar.
 */
export function vaosDaFileira(bloco: BlocoFisico, prefixo = 'PP'): VaoDaFileira[] {
  if (bloco.tipo !== 'fileira') return [];

  const [cx, , cz] = bloco.centro;
  const [profundidade, altura, comprimento] = bloco.tamanho;
  const posicoes = posicoesDaFileira(bloco);
  const passo = comprimento / posicoes;
  const zInicio = cz - comprimento / 2;
  const alturaDoNivel = altura / NIVEIS_POR_FILEIRA;
  const letra = letraDaRua(bloco.rotulo);

  const vaos: VaoDaFileira[] = [];
  for (let p = 1; p <= posicoes; p++) {
    for (let n = 1; n <= NIVEIS_POR_FILEIRA; n++) {
      vaos.push({
        codigo: letra ? `${prefixo}-${letra}${String(p).padStart(2, '0')}-N${n}` : null,
        posicao: p,
        nivel: n,
        centro: [
          cx,
          // Base do nível mais meia altura: o nível 1 apoia no piso, não flutua.
          (n - 1) * alturaDoNivel + alturaDoNivel / 2,
          zInicio + (p - 0.5) * passo,
        ],
        // Recuado dos montantes e da longarina, para o vão ler como abertura e o clique
        // não disputar a superfície com a estrutura.
        tamanho: [profundidade * 0.82, alturaDoNivel * 0.74, passo * 0.86],
      });
    }
  }
  return vaos;
}

/**
 * Bancadas de embalagem da planta.
 *
 * Separadas das fileiras porque não armazenam endereço: são superfície de trabalho, e
 * tratá-las como estante faria o mapa contar posição que não existe.
 *
 * ── Por que as cinco baias saíram ──────────────────────────────────────────────
 * Elas desenhavam "pallets prontos" na expedição: cinco cubos de 1,2 × 0,9 × 1,2 que não
 * correspondiam a dado nenhum. Mercadoria desenhada sem lastro é pior que área vazia —
 * quem planeja carregamento olhando o mapa contaria cinco pallets que ninguém separou. A
 * expedição agora mostra a área e o zebrado, que são verdade, e nada dentro dela.
 */
export function mesasDaPlanta(trechos: TrechoDaPlanta[] = AZ2027_TERREO): BlocoFisico[] {
  const mesas: BlocoFisico[] = [];
  const TAMPO = { largura: 1.6, altura: 0.9, profundidade: 0.8 } as const;

  // 4 bancadas de embalagem, no fim do prédio atual, perto do portão do galpão.
  const atual = trechos.find(t => t.nome === 'Prédio atual');
  if (atual) {
    const z = atual.zInicio + atual.comprimento - 3.2;
    const vaoEntre = (LARGURA_DO_PREDIO - 4 * TAMPO.largura) / 5;
    for (let i = 0; i < 4; i++) {
      const x = vaoEntre * (i + 1) + TAMPO.largura * (i + 0.5);
      mesas.push({
        id: `bancada-${i + 1}`,
        tipo: 'bancada',
        centro: [x, TAMPO.altura / 2, z],
        tamanho: [TAMPO.largura, TAMPO.altura, TAMPO.profundidade],
        rotulo: i === 0 ? 'EMBALAGEM' : '',
      });
    }
  }

  return mesas;
}

/** Comprimento total do conjunto, somando os trechos. */
export function comprimentoTotal(trechos: TrechoDaPlanta[] = AZ2027_TERREO): number {
  return trechos.reduce((soma, t) => Math.max(soma, t.zInicio + t.comprimento), 0);
}

// ── Sinalização e leitura espacial ───────────────────────────────────────────────────
//
// Quem olha o galpão de cima precisa saber EM QUE RUA está olhando, e quem caminha
// precisa saber em que corredor entrou. Nenhuma das duas respostas está na geometria da
// estante: um porta-pallets é igual ao outro. Por isso a sinalização é dado próprio,
// calculado aqui e desenhado lá — aritmética, conferível sem WebGL.

/** Altura da placa acima do topo da fileira, em metros. Alta o bastante para a placa não
 *  ser tapada pelo palete do último nível, baixa o bastante para pertencer à estante. */
const ALTURA_DA_PLACA = 0.6;

/** Uma placa aérea de identificação de rua. */
export interface PlacaDaFileira {
  /** Letra da rua. Fileira sem rua cadastrada não ganha placa — nada a anunciar. */
  rotulo: string;
  /** Posições de palete da fileira. A placa diz o TAMANHO da rua, não só o nome dela. */
  posicoes: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Onde pendurar as placas de cada fileira.
 *
 * DUAS por fileira, uma em cada ponta, e isso é o ponto: um corredor se entra pelos dois
 * lados, e uma placa só no meio obriga quem entrou pela outra ponta a percorrer meia rua
 * para descobrir em qual está. Recuadas meia posição para dentro, para a placa ficar
 * sobre a estrutura em vez de pairar além do fim dela.
 *
 * Fileira de uma posição só ganha uma placa, no centro: as duas pontas seriam o mesmo
 * lugar, e duas placas sobrepostas é uma placa ilegível.
 */
export function placasDasFileiras(blocos: readonly BlocoFisico[]): PlacaDaFileira[] {
  const placas: PlacaDaFileira[] = [];

  for (const bloco of blocos) {
    if (bloco.tipo !== 'fileira') continue;
    const letra = letraDaRua(bloco.rotulo);
    if (!letra) continue;

    const [cx, , cz] = bloco.centro;
    const [, altura, comprimento] = bloco.tamanho;
    const posicoes = posicoesDaFileira(bloco);
    const passo = comprimento / posicoes;
    const y = altura + ALTURA_DA_PLACA;

    const zs =
      posicoes > 1
        ? [cz - comprimento / 2 + passo / 2, cz + comprimento / 2 - passo / 2]
        : [cz];

    for (const z of zs) placas.push({ rotulo: letra, posicoes, x: cx, y, z });
  }

  return placas;
}

/**
 * Demarcação de solo da fileira: espessura da tinta, altura acima da laje e folga lateral.
 *
 * `altura` fica acima das faixas de circulação do cenário (0,005 m) e abaixo da
 * demarcação da expedição (0,02 m): três camadas de tinta coplanares brigariam por
 * profundidade e o chão piscaria conforme a câmera gira.
 */
const DEMARCACAO = { espessura: 0.01, altura: 0.012, folga: 0.22 } as const;

/** Uma faixa pintada no piso, já posicionada pelo centro. */
export interface FaixaDePiso {
  centro: [number, number, number];
  tamanho: [number, number, number];
}

/** As fileiras compartilham faixa de Z? Só então elas disputam espaço no eixo X. */
function convivemEmZ(a: BlocoFisico, b: BlocoFisico): boolean {
  const [, , az] = a.centro;
  const [, , bz] = b.centro;
  return Math.abs(az - bz) < (a.tamanho[2] + b.tamanho[2]) / 2;
}

/**
 * A tinta no chão que delimita o pé de cada fileira.
 *
 * Existe para a LEITURA do espaço, não para enfeitar: vista de cima, a estante e o
 * corredor têm o mesmo chão cinza, e nada diz onde um acaba e o outro começa. Com o pé
 * da fileira pintado, o corredor passa a ser o que sobrou entre duas marcações — que é
 * exatamente como se lê um galpão de verdade.
 *
 * Cor NEUTRA, decidida no módulo de aparência: rua não tem cor semântica. O amarelo já
 * significa circulação no cenário, e isto é o contrário — é onde não se circula.
 *
 * ── Por que a folga é calculada por lado ────────────────────────────────────────
 * No galpão novo duas fileiras ficam COSTA A COSTA, com as faces encostadas. Uma folga
 * fixa dos dois lados faria as duas marcações se sobreporem em 0,44 m de tinta
 * coplanar — z-fighting puro, o chão piscando entre os dois tons conforme a câmera
 * gira. Aqui cada lado recebe no máximo metade do vão até a vizinha, então a marcação
 * de uma encosta na da outra e nunca a invade.
 *
 * Em Z não há clamp: os trechos do conjunto estão a quase 9 m um do outro, e inventar
 * uma regra para uma colisão que não existe seria complicar sem necessidade.
 */
export function faixasDePiso(
  blocos: readonly BlocoFisico[],
  folgaMaxima: number = DEMARCACAO.folga,
): FaixaDePiso[] {
  const fileiras = blocos.filter(b => b.tipo === 'fileira');

  return fileiras.map(bloco => {
    const [cx, , cz] = bloco.centro;
    const [profundidade, , comprimento] = bloco.tamanho;

    let folgaEsquerda = folgaMaxima;
    let folgaDireita = folgaMaxima;

    for (const outra of fileiras) {
      if (outra === bloco || !convivemEmZ(bloco, outra)) continue;
      const vao = Math.abs(outra.centro[0] - cx) - (profundidade + outra.tamanho[0]) / 2;
      // `Math.max(0, …)` e não um `continue` em vão negativo, e isso foi medido: as duas
      // fileiras costa-a-costa dão vão −2,2e-16 em vez de zero exato, e um guarda
      // `if (vao < 0) continue` deixava as duas com folga cheia — 0,44 m de tinta
      // sobreposta, que é justamente o caso que esta função existe para evitar.
      const metade = Math.max(0, vao) / 2;
      if (outra.centro[0] < cx) folgaEsquerda = Math.min(folgaEsquerda, metade);
      else folgaDireita = Math.min(folgaDireita, metade);
    }

    return {
      centro: [cx + (folgaDireita - folgaEsquerda) / 2, DEMARCACAO.altura, cz],
      tamanho: [
        profundidade + folgaEsquerda + folgaDireita,
        DEMARCACAO.espessura,
        comprimento + folgaMaxima * 2,
      ],
    };
  });
}

// ── Acabamento do cenário: sapata e zebrado ──────────────────────────────────────────
//
// Nada aqui carrega dado. São as duas coisas que um galpão tem e que o desenho não tinha,
// e cada uma existe por um motivo de LEITURA, não de enfeite: a sapata devolve o contato
// da estante com o piso na vista de cima, e o zebrado diz onde é área de manobra.

/** Medidas da sapata — as mesmas da vista por código, para a estante não mudar de
 *  construção conforme a aba aberta. */
const SAPATA = { lado: 0.26, espessura: 0.02 } as const;

/**
 * As sapatas de todas as fileiras informadas.
 *
 * Derivadas das PEÇAS, não recalculadas das medidas: sapata que não nasce debaixo de um
 * montante é sapata no lugar errado, e com a derivação as duas se movem sempre juntas.
 */
export function sapatasDasFileiras(pecas: readonly PecaDaFileira[]): FaixaDePiso[] {
  return pecas
    .filter(p => p.tipo === 'montante')
    .map(p => ({
      centro: [p.centro[0], SAPATA.espessura / 2, p.centro[2]] as [number, number, number],
      tamanho: [SAPATA.lado, SAPATA.espessura, SAPATA.lado] as [number, number, number],
    }));
}

/**
 * Zebrado de segurança da expedição.
 *
 * ── Por que tracejado e não uma borda corrida ──────────────────────────────────
 * Área de manobra se marca com zebrado justamente porque o tracejado é lido como
 * ADVERTÊNCIA e a linha corrida é lida como limite. São significados diferentes no chão
 * de um galpão, e aqui o certo é o primeiro: a expedição não é área proibida, é área onde
 * empilhadeira manobra.
 *
 * ── Por que não é girado 45° ───────────────────────────────────────────────────
 * O zebrado clássico é diagonal, mas a diagonal exigiria rotação em Y nas instâncias, e
 * `aplicarPecas` gira só em Z — que é o eixo de que a diagonal da estante precisa.
 * Ortogonal e alternado dá a mesma leitura de advertência sem arrastar um segundo eixo de
 * giro para dentro do módulo de desenho inteiro.
 *
 * `altura` fica ACIMA da chapa da expedição, que vai de 0 a 0,04 m: coplanar com ela, o
 * zebrado piscaria conforme a câmera gira.
 */
const ZEBRADO = { faixa: 0.3, traco: 0.5, vao: 0.5, espessura: 0.01, altura: 0.045 } as const;

/**
 * Os traços do zebrado em volta da área de expedição.
 *
 * Passo INTEIRO, como em `pecasDaFileira`: o número de traços é o que cabe no lado, e o
 * passo é o lado dividido por ele. Com passo fixo, o último traço de cada lado sobraria
 * para fora da área marcada — um zebrado que escapa justamente do que ele delimita.
 */
export function faixasDaExpedicao(blocos: readonly BlocoFisico[]): FaixaDePiso[] {
  const area = blocos.find(b => b.tipo === 'expedicao');
  if (!area) return [];

  const [cx, , cz] = area.centro;
  const [largura, , comprimento] = area.tamanho;
  const faixas: FaixaDePiso[] = [];
  const passoNominal = ZEBRADO.traco + ZEBRADO.vao;

  // Lados longos (variam em X), nas duas bordas em Z.
  const emX = Math.max(1, Math.floor(largura / passoNominal));
  const passoX = largura / emX;
  for (let i = 0; i < emX; i += 1) {
    const x = cx - largura / 2 + (i + 0.5) * passoX;
    for (const z of [cz - comprimento / 2 + ZEBRADO.faixa / 2, cz + comprimento / 2 - ZEBRADO.faixa / 2]) {
      faixas.push({
        centro: [x, ZEBRADO.altura, z],
        tamanho: [passoX * 0.5, ZEBRADO.espessura, ZEBRADO.faixa],
      });
    }
  }

  // Lados curtos (variam em Z), nas duas bordas em X. Recuados da faixa dos lados longos,
  // senão o canto vira um bloco cheio em vez de zebrado.
  const util = comprimento - ZEBRADO.faixa * 2;
  const emZ = Math.max(1, Math.floor(util / passoNominal));
  const passoZ = util / emZ;
  for (let i = 0; i < emZ; i += 1) {
    const z = cz - comprimento / 2 + ZEBRADO.faixa + (i + 0.5) * passoZ;
    for (const x of [cx - largura / 2 + ZEBRADO.faixa / 2, cx + largura / 2 - ZEBRADO.faixa / 2]) {
      faixas.push({
        centro: [x, ZEBRADO.altura, z],
        tamanho: [ZEBRADO.faixa, ZEBRADO.espessura, passoZ * 0.5],
      });
    }
  }

  return faixas;
}

/**
 * Seção do pé e espessura do tampo da bancada, em metros.
 *
 * Uma bancada desenhada como caixa cheia de 1,6 × 0,9 × 0,8 é um BLOCO: não tem vão por
 * baixo, não tem tampo, e lida de perto parece um caixote abandonado no meio do galpão.
 * Era o mesmo defeito da empilhadeira em bloco, na mesma área da planta — e a correção é
 * a mesma que a estante já recebeu: decompor na peça que a coisa de fato tem.
 */
const BANCADA = { tampo: 0.06, pe: 0.07 } as const;

/**
 * As peças de uma mesa de expedição, em coordenada LOCAL — centro da mesa na origem.
 *
 * ── Por que existe separada de `pecasDaBancada` ────────────────────────────────
 * A bancada da planta e a mesa que se coloca no Modo Construção são o MESMO móvel, e
 * estavam desenhadas por dois caminhos: a da planta já era tampo e pés, a do builder
 * continuava um `boxGeometry` do tamanho inteiro — um caixote. Duas definições do mesmo
 * objeto divergem no dia em que alguém mexe numa delas, e foi exatamente o que aconteceu.
 * Aqui a forma é definida UMA vez, em torno da origem, e cada chamador a posiciona.
 *
 * ── Por que tampo e pés, e não uma caixa ──────────────────────────────────────
 * O vão por baixo é o que distingue mesa de caixote. Sem ele não há onde encostar um
 * carrinho nem onde guardar caixa vazia, e no desenho a mesa vira um bloco maciço no meio
 * do corredor — que é a leitura oposta da verdadeira: mesa é superfície, não volume.
 *
 * Os pés ficam recuados meia seção para dentro do tampo, como num móvel real: rente à
 * borda o pé lê como quina de caixa e o vão por baixo desaparece.
 */
export function pecasDaMesa(
  largura: number,
  altura: number,
  profundidade: number,
): FaixaDePiso[] {
  const alturaDosPes = Math.max(0, altura - BANCADA.tampo);
  const recuo = BANCADA.pe;
  const base = -altura / 2;

  const pecas: FaixaDePiso[] = [
    {
      centro: [0, altura / 2 - BANCADA.tampo / 2, 0],
      tamanho: [largura, BANCADA.tampo, profundidade],
    },
  ];

  for (const dx of [-largura / 2 + recuo, largura / 2 - recuo]) {
    for (const dz of [-profundidade / 2 + recuo, profundidade / 2 - recuo]) {
      pecas.push({
        centro: [dx, base + alturaDosPes / 2, dz],
        tamanho: [BANCADA.pe, alturaDosPes, BANCADA.pe],
      });
    }
  }

  return pecas;
}

/**
 * Tampo e quatro pés de uma bancada da planta, já no referencial do galpão.
 *
 * Delega a FORMA para `pecasDaMesa` e só translada: a bancada da planta e a mesa do
 * builder não podem ser dois móveis diferentes.
 */
export function pecasDaBancada(bloco: BlocoFisico): FaixaDePiso[] {
  if (bloco.tipo !== 'bancada') return [];

  const [cx, , cz] = bloco.centro;
  const [largura, altura, profundidade] = bloco.tamanho;

  return pecasDaMesa(largura, altura, profundidade).map(peca => ({
    centro: [cx + peca.centro[0], altura / 2 + peca.centro[1], cz + peca.centro[2]],
    tamanho: peca.tamanho,
  }));
}
