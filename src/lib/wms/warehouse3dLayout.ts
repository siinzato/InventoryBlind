// Geometria configurável do porta-pallets: onde cada vaga fica no espaço.
//
// Mora fora do componente porque é aritmética, e aritmética se confere sem WebGL.
// Dentro do `<Canvas>` só daria para checar por screenshot, que não distingue "subiu
// 2,5 m" de "subiu 2,4 m".
//
// ── Por que isto virou configurável ─────────────────────────────────────────────
// Parte dos porta-pallets do Pulmão é estrutura AÉREA: a primeira prateleira começa
// acima do piso, sobre vigas. Desenhar tudo apoiado em Y=0 põe mercadoria no chão que
// na vida real está a três metros de altura — e quem olha o mapa para planejar
// separação tira a conclusão errada sobre o que alcança sem equipamento.
//
// O banco NÃO guarda essas medidas. São propriedade do galpão, não do endereço, então
// vivem como preferência local de quem monta o mapa.

/** Dimensões de uma vaga, em METROS. Palete PBR carregado. */
export const VAGA = { largura: 1.2, altura: 1.4, profundidade: 1.2 } as const;

export interface Layout3DConfig {
  /** Altura do piso até a base da primeira prateleira. 0 = apoiado no chão. */
  baseOffsetY: number;
  /** Distância vertical entre andares. */
  levelHeight: number;
  /** Passo entre módulos, ao longo da rua (eixo Z). */
  moduleWidth: number;
  /** Passo entre eixos de rua (eixo X). Inclui o corredor de manobra. */
  rowSpacing: number;
  /** Elevação própria de uma rua, pela LETRA dela. Sobrepõe `baseOffsetY`. */
  baseByStreet: Record<string, number>;
}

/**
 * Os padrões reproduzem exatamente o desenho atual, então abrir o configurador e não
 * mexer em nada não muda um pixel.
 *
 * 1,8 = 1,4 de carga + 0,4 de longarina e folga de garfo.
 * 4,0 = 1,2 de vaga + 2,8 de corredor (faixa de empilhadeira contrabalançada).
 * 1,3 = 1,2 de vaga + 0,1, porque módulos vizinhos dividem o montante vertical.
 */
export const LAYOUT_PADRAO: Layout3DConfig = {
  baseOffsetY: 0,
  levelHeight: 1.8,
  moduleWidth: 1.3,
  rowSpacing: 4.0,
  baseByStreet: {},
};

/**
 * Limites de cada campo.
 *
 * Não são capricho: `levelHeight` menor que a altura da vaga faz os níveis se
 * atravessarem, e um `rowSpacing` de 200 joga a rua 4 para fora do campo de visão sem
 * aviso nenhum. O formulário aceita o que estiver dentro; fora disso, corrige.
 */
export const LIMITES = {
  baseOffsetY: { min: 0, max: 20 },
  levelHeight: { min: VAGA.altura, max: 6 },
  moduleWidth: { min: VAGA.profundidade, max: 6 },
  rowSpacing: { min: VAGA.largura, max: 20 },
} as const;

const prender = (valor: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, valor));

const numeroOu = (valor: unknown, padrao: number): number =>
  typeof valor === 'number' && Number.isFinite(valor) ? valor : padrao;

/**
 * Normaliza qualquer coisa vinda do localStorage num config válido.
 *
 * O que está gravado veio de uma versão anterior do app ou de edição manual, então é
 * dado não confiável: campo faltando, texto no lugar de número, chave a mais. Nada
 * disso pode derrubar a tela — na pior hipótese volta ao padrão.
 */
export function sanearLayout(bruto: unknown): Layout3DConfig {
  if (typeof bruto !== 'object' || bruto === null) return { ...LAYOUT_PADRAO };
  const fonte = bruto as Record<string, unknown>;

  const baseByStreet: Record<string, number> = {};
  const porRua = fonte.baseByStreet;
  if (typeof porRua === 'object' && porRua !== null) {
    for (const [letra, valor] of Object.entries(porRua as Record<string, unknown>)) {
      if (typeof valor === 'number' && Number.isFinite(valor)) {
        baseByStreet[letra.toUpperCase()] = prender(valor, LIMITES.baseOffsetY);
      }
    }
  }

  return {
    baseOffsetY: prender(numeroOu(fonte.baseOffsetY, LAYOUT_PADRAO.baseOffsetY), LIMITES.baseOffsetY),
    levelHeight: prender(numeroOu(fonte.levelHeight, LAYOUT_PADRAO.levelHeight), LIMITES.levelHeight),
    moduleWidth: prender(numeroOu(fonte.moduleWidth, LAYOUT_PADRAO.moduleWidth), LIMITES.moduleWidth),
    rowSpacing: prender(numeroOu(fonte.rowSpacing, LAYOUT_PADRAO.rowSpacing), LIMITES.rowSpacing),
    baseByStreet,
  };
}

/** Elevação da base desta rua: a dela, se houver; senão a geral. */
export function baseDaRua(ruaCodigo: string, cfg: Layout3DConfig): number {
  const propria = cfg.baseByStreet[ruaCodigo.toUpperCase()];
  return typeof propria === 'number' ? propria : cfg.baseOffsetY;
}

/**
 * Posição do CENTRO da vaga no espaço, em metros.
 *
 * O `+ VAGA.altura / 2` existe porque a caixa é desenhada centrada na posição: sem ele
 * o nível 1 ficaria metade enterrado no piso. Com ele, a BASE do nível 1 encosta
 * exatamente em `baseOffsetY` — que é o que a medida significa para quem está no
 * galpão olhando para a estrutura.
 *
 * `rua` é o ÍNDICE da rua (1, 2, 3...), não a letra; `ruaCodigo` é a letra, usada só
 * para achar a elevação própria daquela rua.
 */
export function posicaoDaVaga(
  slot: { rua: number; ruaCodigo: string; modulo: number; nivel: number },
  cfg: Layout3DConfig,
): [number, number, number] {
  return [
    (slot.rua - 1) * cfg.rowSpacing,
    baseDaRua(slot.ruaCodigo, cfg) + (slot.nivel - 1) * cfg.levelHeight + VAGA.altura / 2,
    (slot.modulo - 1) * cfg.moduleWidth,
  ];
}

const CHAVE = 'ib.wms.layout3d';

/** Lê a preferência gravada. Em modo privado ou com dado corrompido, devolve o padrão. */
export function carregarLayout(): Layout3DConfig {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return { ...LAYOUT_PADRAO };
    return sanearLayout(JSON.parse(cru));
  } catch {
    return { ...LAYOUT_PADRAO };
  }
}

/** Grava a preferência. Falhar aqui não pode quebrar a tela — o mapa segue funcionando. */
export function salvarLayout(cfg: Layout3DConfig): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(cfg));
  } catch {
    /* modo privado, cota cheia: a preferência só não sobrevive ao reload */
  }
}
