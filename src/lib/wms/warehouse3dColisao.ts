// Onde o caminhante pode pisar: a cerca do prédio e as caixas que barram passagem.
//
// Até aqui a caminhada tinha uma cerca só — `±extensao`, que com o galpão atual dá
// ±45,2 m nos dois eixos. O prédio mede 10,3 × 45,2, ou seja X de −5,15 a 5,15: dava
// para andar 8,8 vezes a meia-largura do galpão para fora dele. E colisão não existia:
// a câmera atravessava fileira, palete e mesa.
//
// As paredes que aparecem na cena NÃO são o prédio — `WarehouseEnvironment` desenha um
// caixote de `extensao × 1,9` (meio-lado 42,94 m) como cenário. Bater nelas seria bater
// em decoração. A cerca de verdade vem das medidas da planta.
//
// ── Por que resolver eixo a eixo ────────────────────────────────────────────────
// Travar X e Z juntos faz a pessoa GRUDAR na estante ao encostar de lado: o movimento
// inteiro é recusado porque uma das componentes bateu. Testando um eixo de cada vez, a
// componente que não bateu passa — e andar colado na fileira vira deslizar, que é o que
// o corpo faz no corredor de verdade.
//
// ── Por que caixa plana, e não a geometria ──────────────────────────────────────
// Uma fileira inteira é UMA caixa em X/Z. Com 9 fileiras e 9 mesas são 18 testes por
// quadro, contra 303 vãos se a colisão fosse por vaga. O vão não precisa ser testado: ele
// está dentro da fileira que já barra.

/** Retângulo no plano do piso. Y não entra: a caminhada é na altura dos olhos, sempre. */
export interface CaixaPlana {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** O mínimo de um bloco da planta para virar caixa. */
interface BlocoComCaixa {
  tipo: string;
  centro: [number, number, number];
  tamanho: [number, number, number];
}

export type Offset = readonly [number, number, number];

/** Caixa de um bloco, já em coordenada de MUNDO. */
export function caixaDoBloco(bloco: BlocoComCaixa, offset: Offset): CaixaPlana {
  const [cx, , cz] = bloco.centro;
  const [largura, , comprimento] = bloco.tamanho;
  return {
    x0: cx - largura / 2 + offset[0],
    x1: cx + largura / 2 + offset[0],
    z0: cz - comprimento / 2 + offset[2],
    z1: cz + comprimento / 2 + offset[2],
  };
}

/**
 * As caixas que barram passagem na planta física.
 *
 * `expedicao` fica de FORA de propósito: é tinta no chão, com 4 cm de altura. Barrar ali
 * trancaria a pessoa fora justamente da área de carga, que é onde ela mais precisa andar.
 */
export function caixasDaPlanta(
  blocos: readonly BlocoComCaixa[],
  mesas: readonly BlocoComCaixa[],
  offset: Offset,
): CaixaPlana[] {
  const caixas: CaixaPlana[] = [];
  for (const b of blocos) {
    if (b.tipo !== 'fileira') continue;
    caixas.push(caixaDoBloco(b, offset));
  }
  for (const m of mesas) caixas.push(caixaDoBloco(m, offset));
  return caixas;
}

/**
 * A cerca: o contorno interno do prédio, em coordenada de mundo.
 *
 * `margem` encolhe o retângulo — útil para a pessoa não encostar o nariz na parede.
 */
export function cercaDaPlanta(
  largura: number,
  comprimento: number,
  offset: Offset,
  margem = 0,
): CaixaPlana {
  return {
    x0: offset[0] + margem,
    x1: offset[0] + largura - margem,
    z0: offset[2] + margem,
    z1: offset[2] + comprimento - margem,
  };
}

/** Cerca a partir de um retângulo já conhecido (usada pela vista por código). */
export function cercaDeContorno(
  larguraTotal: number,
  profundidadeTotal: number,
  offset: Offset,
  folga: number,
): CaixaPlana {
  return {
    x0: offset[0] - folga,
    x1: offset[0] + larguraTotal + folga,
    z0: offset[2] - folga,
    z1: offset[2] + profundidadeTotal + folga,
  };
}

/** O ponto invade a caixa, contando o raio do caminhante. */
export function bate(x: number, z: number, caixa: CaixaPlana, raio: number): boolean {
  return (
    x > caixa.x0 - raio && x < caixa.x1 + raio && z > caixa.z0 - raio && z < caixa.z1 + raio
  );
}

const bateEmAlguma = (x: number, z: number, caixas: readonly CaixaPlana[], raio: number): boolean => {
  for (const c of caixas) if (bate(x, z, c, raio)) return true;
  return false;
};

/** Prende o ponto dentro da cerca, descontando o raio. */
export function naCerca(x: number, z: number, cerca: CaixaPlana, raio: number): [number, number] {
  return [
    Math.min(Math.max(x, cerca.x0 + raio), cerca.x1 - raio),
    Math.min(Math.max(z, cerca.z0 + raio), cerca.z1 - raio),
  ];
}

/**
 * Resolve o movimento de `de` para `para`, escorregando no que bater.
 *
 * Cada eixo é testado sozinho e a partir da posição ANTERIOR, nunca da candidata do
 * outro eixo — testar em cadeia deixaria passar o movimento diagonal que corta a quina
 * de uma caixa.
 *
 * Quando a origem já está dentro de uma caixa (estante recém-construída em cima da
 * pessoa, ou entrada mal escolhida), o movimento é LIBERADO em vez de recusado: prender
 * alguém dentro da geometria é pior do que deixá-la sair andando.
 */
export function deslizar(
  de: readonly [number, number],
  para: readonly [number, number],
  caixas: readonly CaixaPlana[],
  cerca: CaixaPlana,
  raio: number,
): [number, number] {
  const [x0, z0] = naCerca(de[0], de[1], cerca, raio);
  const [xAlvo, zAlvo] = naCerca(para[0], para[1], cerca, raio);

  if (bateEmAlguma(x0, z0, caixas, raio)) return [xAlvo, zAlvo];

  const x = bateEmAlguma(xAlvo, z0, caixas, raio) ? x0 : xAlvo;
  const z = bateEmAlguma(x0, zAlvo, caixas, raio) ? z0 : zAlvo;

  // A diagonal pode cair numa quina que nenhum dos dois eixos sozinho acusou.
  if (x !== x0 && z !== z0 && bateEmAlguma(x, z, caixas, raio)) return [x, z0];

  return [x, z];
}

/** Passo da varredura do ponto de entrada, em metros. */
const PASSO_DA_VARREDURA = 0.5;

/**
 * Folga mínima em volta do ponto de entrada, em metros.
 *
 * Não basta o ponto estar livre: medido na planta real, o centro da área de expedição está
 * livre e fica a 0,5 m de uma baia de pallets — a pessoa entrava e travava no primeiro
 * passo. Exigindo quase um metro de folga, a entrada cai em corredor ou em piso aberto, de
 * onde dá para andar.
 */
const FOLGA_DA_ENTRADA = 0.9;

/** Distância do ponto até a caixa (0 se estiver dentro dela). */
function distanciaAteACaixa(x: number, z: number, c: CaixaPlana): number {
  const dx = Math.max(c.x0 - x, 0, x - c.x1);
  const dz = Math.max(c.z0 - z, 0, z - c.z1);
  return Math.hypot(dx, dz);
}

/** Folga até o obstáculo mais próximo. `Infinity` quando não há obstáculo nenhum. */
export function folgaNoPonto(x: number, z: number, caixas: readonly CaixaPlana[]): number {
  let menor = Infinity;
  for (const c of caixas) menor = Math.min(menor, distanciaAteACaixa(x, z, c));
  return menor;
}

/**
 * Um ponto livre para começar a caminhada, o mais perto possível do preferido.
 *
 * Existe porque a entrada antes era fixa em `(0; z)`, e com colisão um ponto dentro de
 * geometria prende a pessoa no lugar: ela aperta W e nada acontece, sem nada na tela
 * explicando. A varredura roda UMA vez, na montagem.
 *
 * Sem ponto livre devolve o preferido preso à cerca — melhor começar dentro de uma
 * estante e poder sair do que não entrar no modo.
 */
export function pontoDeEntrada(
  preferido: readonly [number, number],
  caixas: readonly CaixaPlana[],
  cerca: CaixaPlana,
  raio: number,
): [number, number] {
  const [px, pz] = naCerca(preferido[0], preferido[1], cerca, raio);
  if (folgaNoPonto(px, pz, caixas) >= FOLGA_DA_ENTRADA) return [px, pz];

  // Duas candidatas, porque "livre" e "dá para andar daqui" não são a mesma coisa: a
  // folgada é a preferida; a só-livre é a rede de segurança para um galpão tão cheio que
  // não sobre um metro em lugar nenhum.
  let folgada: [number, number] | null = null;
  let distanciaDaFolgada = Infinity;
  let livre: [number, number] | null = null;
  let distanciaDaLivre = Infinity;

  for (let x = cerca.x0 + raio; x <= cerca.x1 - raio; x += PASSO_DA_VARREDURA) {
    for (let z = cerca.z0 + raio; z <= cerca.z1 - raio; z += PASSO_DA_VARREDURA) {
      if (bateEmAlguma(x, z, caixas, raio)) continue;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < distanciaDaLivre) {
        distanciaDaLivre = d;
        livre = [x, z];
      }
      if (folgaNoPonto(x, z, caixas) >= FOLGA_DA_ENTRADA && d < distanciaDaFolgada) {
        distanciaDaFolgada = d;
        folgada = [x, z];
      }
    }
  }

  return folgada ?? livre ?? [px, pz];
}
