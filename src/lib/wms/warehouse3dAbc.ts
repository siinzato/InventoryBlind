// Cruza endereço do Pulmão com a classificação de GIRO da Curva ABC já publicada.
//
// Mora aqui, fora do componente, pelo mesmo motivo dos outros dois módulos do mapa: a
// regra de qual classe colore a vaga é verificável sem WebGL. Dentro do `<Canvas>` ela
// só poderia ser conferida por screenshot.
//
// NADA de schema novo. Consome duas coisas que já existem: a view de saldo do WMS
// (`skusByBin`) e a análise publicada da Curva ABC (`listAnalyses` + classe de giro por
// SKU). Nenhuma migration, nenhuma coluna nova, nenhum vínculo inventado.
//
// ── Por que GIRO, e não faturamento nem lucro ───────────────────────────────────
// A análise classifica cada SKU por três métricas. Só o giro — quantidade movimentada —
// tem relação com o custo de ir buscar a mercadoria no alto do porta-pallet. Faturamento
// e lucro respondem perguntas comerciais; colorir o armazém por eles sugeriria que a
// posição física deveria seguir margem, que não é a regra de nenhum WMS.
//
// ── O que o cruzamento NÃO garante ──────────────────────────────────────────────
// A classificação vem de uma análise com PERÍODO FECHADO (a vigente foi publicada sobre
// agosto/2026). Ela não é recalculada quando o estoque se move. Por isso a tela nomeia a
// análise que está colorindo: "curva A" aqui significa "era A naquele período", e quem
// olha precisa poder ver qual período é esse.
//
// Medido em produção: dos 6 saldos do pulmão, 3 casam com a análise vigente (2 de classe
// A, 1 de classe B) e 3 são de SKU que a análise não viu. Esses 3 ficam SEM COR de curva
// em vez de virarem 'C' — não ter sido classificado e ter girado pouco são coisas
// diferentes.

import { listAnalyses, turnoverClassBySku } from '../abcCurve/abcCurveService';
import { skusByBin } from './wmsService';
import type { Slot } from './warehouse3dSlots';

export type AbcClasse = 'A' | 'B' | 'C';

/** Prioridade de leitura: A domina B, que domina C. Não é alfabética por acaso — é a
 *  ordem de custo operacional, e é o que decide a cor de endereço misturado. */
const PRIORIDADE: Record<AbcClasse, number> = { A: 3, B: 2, C: 1 };

export interface ItemDaVaga {
  sku: string;
  /** `null` = o SKU não está na análise vigente. */
  classe: AbcClasse | null;
  caixas: number;
}

export interface AbcDaVaga {
  /**
   * Classe que COLORE a vaga: a mais alta presente nela.
   *
   * Endereço misturado é real — `PP-A01-N1` guarda dois SKUs hoje. A vaga não "é" uma
   * classe, ela contém um conjunto. Pintar pela mais alta é a escolha que serve à
   * operação: o que custa caro é um item de alto giro mal posicionado, e ele não deixa
   * de custar porque divide a vaga com um item parado. Pintar pela média esconderia
   * exatamente o caso que a tela existe para achar.
   */
  classe: AbcClasse;
  /** Tudo que está na vaga, inclusive o que não tem classe. A tela de detalhe mostra a
   *  lista inteira para que a cor nunca seja a única informação. */
  itens: ItemDaVaga[];
}

export interface AbcDoArmazem {
  porVaga: ReadonlyMap<string, AbcDaVaga>;
  /** Identificação da análise que classificou. `null` = não há análise publicada. */
  analise: { id: string; nome: string; periodoFim: string } | null;
  /** Quantos saldos têm SKU fora da análise vigente. */
  semClasse: number;
}

export const ABC_VAZIO: AbcDoArmazem = { porVaga: new Map(), analise: null, semClasse: 0 };

/**
 * Agrupa saldo por endereço e resolve a classe que colore cada vaga.
 *
 * Puro: recebe o saldo e o mapa de classes, devolve o que desenhar. Sem rede, sem
 * Supabase, sem WebGL — é esta função que os testes exercitam.
 */
export function abcPorVaga(
  saldoPorVaga: ReadonlyMap<string, readonly { sku: string; boxes: number }[]>,
  classePorSku: ReadonlyMap<string, AbcClasse>,
): { porVaga: Map<string, AbcDaVaga>; semClasse: number } {
  const porVaga = new Map<string, AbcDaVaga>();
  let semClasse = 0;

  for (const [binCode, linhas] of saldoPorVaga) {
    const itens: ItemDaVaga[] = [];
    let melhor: AbcClasse | null = null;

    for (const linha of linhas) {
      const classe = classePorSku.get(linha.sku) ?? null;
      if (classe === null) semClasse += 1;
      else if (melhor === null || PRIORIDADE[classe] > PRIORIDADE[melhor]) melhor = classe;
      itens.push({ sku: linha.sku, classe, caixas: linha.boxes });
    }

    // Vaga só com SKU não classificado fica FORA do mapa: a cena a desenha atenuada,
    // que é o que "não sei a curva disto" deve parecer. Entrar como 'C' seria afirmar
    // baixo giro sem ter medido.
    if (melhor !== null) porVaga.set(binCode, { classe: melhor, itens });
  }

  return { porVaga, semClasse };
}

/**
 * Primeiro nível que exige elevar o garfo.
 *
 * A especificação pedia `nivel >= 4`. Neste armazém o nível mais alto é 3 — o alerta
 * nunca dispararia, e a tela mostraria "0 itens em nível alto" para sempre, parecendo
 * que está tudo certo quando na verdade a régua é que não cabe aqui.
 *
 * A régua real não é um número absoluto: é se a empilhadeira precisa subir. O nível 1 é
 * a face de piso, alcançável sem elevar. Do 2 em diante há ciclo de elevação, que é
 * exatamente o desperdício que a regra quer apontar.
 */
export const NIVEL_DE_PISO = 1;

/**
 * Itens de alto giro guardados fora da face de piso.
 *
 * Só classe A. Estender a B dobraria a lista e diluiria o sinal: o ganho de remanejar um
 * item de giro médio raramente paga a movimentação, e um alerta que aponta demais é
 * ignorado tão rápido quanto um que nunca aponta.
 */
export function alertasDeGiro(
  slots: readonly Slot[],
  porVaga: ReadonlyMap<string, AbcDaVaga>,
): Slot[] {
  return slots.filter(slot => slot.nivel > NIVEL_DE_PISO && porVaga.get(slot.id)?.classe === 'A');
}

/**
 * Carrega a classificação de giro de todo o pulmão.
 *
 * Sem empresa ou sem análise publicada, devolve vazio em vez de falhar: a Curva ABC é um
 * módulo opcional, e o mapa 3D não pode deixar de abrir porque ninguém publicou análise.
 * Quem chama distingue os dois casos por `analise === null`.
 */
export async function loadAbcDoArmazem(companyId: string): Promise<AbcDoArmazem> {
  if (!companyId) return ABC_VAZIO;

  // `listAnalyses` já filtra por publicada e ordena da mais recente para a mais antiga.
  const analises = await listAnalyses(companyId);
  const vigente = analises[0];
  if (!vigente) return ABC_VAZIO;

  const saldoPorVaga = await skusByBin();
  const skus = [...new Set([...saldoPorVaga.values()].flat().map(l => l.sku))];
  const classePorSku = await turnoverClassBySku(companyId, vigente.id, skus);

  const { porVaga, semClasse } = abcPorVaga(saldoPorVaga, classePorSku);
  return {
    porVaga,
    analise: { id: vigente.id, nome: vigente.name, periodoFim: vigente.salesPeriodEnd },
    semClasse,
  };
}
