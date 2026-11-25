// As medidas da planta física lidas do banco (migration 133).
//
// Antes elas eram constante em `warehouse3dPlantaFisica.ts`. Medida de galpão não é regra
// de negócio: é levantamento, e levantamento muda — corrigir "o corredor tem 2,65" para
// "o corredor tem 2,40" exigia build e deploy para mexer num número de trena.
//
// A constante CONTINUA existindo, e de propósito: ela é o retrato do que a planta dizia e
// vira o fallback quando o banco não responde, quando a empresa não tem trecho cadastrado
// ou quando o módulo é usado em teste. Mapa 3D sem planta é tela vazia — pior do que mapa
// com a medida de ontem.

import { supabase } from '../supabase';
import { AZ2027_TERREO, type TrechoDaPlanta } from './warehouse3dPlantaFisica';

/** Rótulos de rua por trecho, no formato que `blocosDaPlanta` espera. */
export type RotulosPorTrecho = Record<string, string[]>;

/**
 * O padrão que vigorava como valor fixo de parâmetro em `blocosDaPlanta`.
 *
 * Fica aqui para o fallback ser EXATAMENTE o que a tela desenhava antes desta migration —
 * um fallback que desenha outra coisa não é fallback, é um segundo layout escondido.
 */
export const ROTULOS_PADRAO: RotulosPorTrecho = {
  'Prédio atual': ['A', 'B', 'C', 'D'],
  'Galpão novo': ['E', 'F', 'G', 'H'],
};

export interface PlantaFisicaCarregada {
  trechos: TrechoDaPlanta[];
  rotulos: RotulosPorTrecho;
  /**
   * De onde veio o desenho.
   *
   * `constante` = o banco não tinha o que dizer e o TÉRREO caiu no retrato.
   * `vazio` = este pavimento não tem planta cadastrada. Não é o mesmo que `constante`, e
   * a diferença é o ponto: cair na constante fora do térreo desenharia o térreo rotulado
   * como mezanino — sem erro nenhum, e ninguém descobriria.
   */
  origem: 'banco' | 'constante' | 'vazio';
}

/** Térreo. O único pavimento para o qual a constante é um retrato legítimo. */
export const ANDAR_TERREO = 1;

interface LinhaDoBanco {
  nome: string;
  z_inicio: number | string;
  comprimento: number | string;
  fileiras: number;
  comprimento_da_fileira: number | string;
  corredor_inicio: number | string;
  distribuicao: string;
  corredor_longitudinal: number | string;
  rotulos: string[] | null;
}

/**
 * `numeric` do Postgres chega como STRING no supabase-js em parte dos casos.
 *
 * Aqui isso não é detalhe de tipagem: `'18.6' + 26.6` daria `"18.626.6"` e a cena nasceria
 * com o galpão novo a dezoito mil metros do prédio atual. Normalizar na borda é o que
 * impede uma string de entrar numa conta de geometria.
 */
const numero = (v: number | string): number => (typeof v === 'number' ? v : Number(v));

const daLinha = (l: LinhaDoBanco): TrechoDaPlanta => ({
  nome: l.nome,
  zInicio: numero(l.z_inicio),
  comprimento: numero(l.comprimento),
  fileiras: l.fileiras,
  comprimentoDaFileira: numero(l.comprimento_da_fileira),
  corredorInicio: numero(l.corredor_inicio),
  // O CHECK do banco só deixa passar estes dois valores; o `as` aqui é a borda onde o
  // texto vira união, não uma suposição sobre o conteúdo.
  distribuicao: l.distribuicao as TrechoDaPlanta['distribuicao'],
  corredorLongitudinal: numero(l.corredor_longitudinal),
});

const comOConstante = (): PlantaFisicaCarregada => ({
  trechos: AZ2027_TERREO,
  rotulos: ROTULOS_PADRAO,
  origem: 'constante',
});

/**
 * Pavimento sem planta cadastrada.
 *
 * O fallback para a constante vale SÓ no térreo, porque a constante é o retrato do
 * térreo. Em qualquer outro andar ela seria uma afirmação falsa com cara de desenho
 * pronto — e o mezanino apareceria com as fileiras, as ruas e as medidas do andar de
 * baixo. Vazio é a resposta honesta; quem chama mostra isso na tela.
 */
const semPlanta = (): PlantaFisicaCarregada => ({ trechos: [], rotulos: {}, origem: 'vazio' });

const semDados = (andar: number): PlantaFisicaCarregada =>
  andar === ANDAR_TERREO ? comOConstante() : semPlanta();

/**
 * Os trechos da planta de um pavimento, em ordem ao longo do galpão.
 *
 * A ordem vem do `z_inicio` e não do nome nem da data de criação: o módulo que desenha
 * trata o último trecho como o fim do prédio (é onde ele põe a expedição), então vir fora
 * de ordem poria a área de carga no meio do galpão.
 *
 * Nunca estoura. Erro de rede ou pavimento sem cadastro caem em `semDados`, que devolve o
 * retrato só no TÉRREO e vazio nos demais andares. Quem chama distingue por `origem`.
 */
export async function carregarPlantaFisica(andar = ANDAR_TERREO): Promise<PlantaFisicaCarregada> {
  const { data, error } = await supabase
    .from('warehouse_plan_sections')
    .select('nome, z_inicio, comprimento, fileiras, comprimento_da_fileira, corredor_inicio, distribuicao, corredor_longitudinal, rotulos')
    .eq('andar', andar)
    .order('z_inicio');

  if (error) {
    console.error('[Planta física] Erro ao ler os trechos:', error);
    return semDados(andar);
  }

  const linhas = (data ?? []) as LinhaDoBanco[];
  if (linhas.length === 0) return semDados(andar);

  const rotulos: RotulosPorTrecho = {};
  for (const l of linhas) {
    // Array vazio é diferente de ausente: significa "este trecho não tem rua cadastrada",
    // e a fileira fica sem nome em vez de herdar a letra do padrão — herdar faria o vão
    // montar um código de endereço que não existe.
    rotulos[l.nome] = l.rotulos ?? [];
  }

  return { trechos: linhas.map(daLinha), rotulos, origem: 'banco' };
}

/**
 * Pavimentos que têm planta cadastrada, em ordem.
 *
 * O térreo entra SEMPRE, mesmo sem linha no banco: ele tem o retrato na constante, e um
 * seletor sem o térreo esconderia o único andar que o mapa sabe desenhar hoje.
 *
 * Serve para o seletor não oferecer andar que desenharia tela vazia por engano — oferecer
 * só o que existe é diferente de oferecer tudo e explicar depois.
 */
export async function listarPavimentos(): Promise<number[]> {
  const { data, error } = await supabase
    .from('warehouse_plan_sections')
    .select('andar')
    .order('andar');

  if (error) {
    console.error('[Planta física] Erro ao listar os pavimentos:', error);
    return [ANDAR_TERREO];
  }

  const andares = new Set<number>([ANDAR_TERREO]);
  for (const linha of (data ?? []) as { andar: number }[]) andares.add(linha.andar);
  return [...andares].sort((a, b) => a - b);
}
