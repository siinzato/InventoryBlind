// Onde uma vaga está no espaço, conforme a vista ativa do mapa 3D.
//
// O mapa desenha o mesmo galpão de DUAS maneiras, e as duas têm geometria própria:
//
//   vista por código   rua × rowSpacing em X, módulo × moduleWidth em Z
//                      (8 ruas = 28 m de largura, 16 módulos = 19,5 m de profundidade)
//   vista da planta    as 8 ruas cabem nos 10,3 m de largura do prédio e o comprimento
//                      da fileira corre pelos 45,2 m de Z
//
// Medido com o código real: `PP-E03-N2` fica em `[2; 2,5; −7,15]` na grade por código e
// em `[−4,3; 2,1; 1,32]` na planta — 10,6 m de distância. NÃO é um deslocamento que dá
// para somar: as escalas dos eixos são diferentes. Por isso aqui existe um RESOLVEDOR
// por vista, e não uma correção de offset.
//
// ── O erro que este módulo existe para impedir ──────────────────────────────────
// Câmera e radar liam a posição sempre da grade por código. Com a planta desenhada —
// que é o padrão da tela —, "Ir até", "Avançar para a parada N" e o clique no radar
// levavam a câmera para onde a vaga ESTARIA na outra geometria. Não dá erro nenhum: a
// câmera voa, a cena continua bonita, e a vaga não está lá.
//
// ── Local e mundo ───────────────────────────────────────────────────────────────
// As duas vistas desenham num `<group>` deslocado para centralizar o conjunto na origem.
// Então existe coordenada LOCAL (a que cada geometria produz) e coordenada de MUNDO (a
// que a câmera e o OrbitControls enxergam):
//
//   mundo = local + offset        local = mundo − offset
//
// Confundir as duas é o erro silencioso desta família de funções, e é o mesmo que
// `warehouse3dRadar` já documenta.

import { posicaoDaVaga, type Layout3DConfig } from './warehouse3dLayout';
import {
  PASSO_DA_POSICAO, PROFUNDIDADE_DA_FILEIRA, vaosDaFileira, type BlocoFisico,
} from './warehouse3dPlantaFisica';

export type Ponto = [number, number, number];

/** O mínimo que um resolvedor precisa saber da vaga para achá-la nas duas geometrias. */
export interface VagaLocalizavel {
  /** Código impresso (`PP-E03-N2`) — é a chave na planta. */
  id: string;
  rua: number;
  ruaCodigo: string;
  modulo: number;
  nivel: number;
}

/**
 * Posição LOCAL de uma vaga, ou `null` quando a vista ativa não sabe desenhá-la.
 *
 * O `null` é informação, não falha: na planta existe vaga cadastrada cujo vão não é
 * desenhado (rua que a planta não descreve). Devolver `[0,0,0]` nesse caso mandaria a
 * câmera para o canto do galpão como se fosse o endereço pedido.
 */
export type ResolvedorLocal = (vaga: VagaLocalizavel) => Ponto | null;

/** Soma local + offset. Existe como função para o teste poder afirmar a conta. */
export function emMundo(local: Ponto, offset: Ponto): Ponto {
  return [local[0] + offset[0], local[1] + offset[1], local[2] + offset[2]];
}

/**
 * Offset com que a planta física é desenhada.
 *
 * É o MESMO valor que `PlantaFisica3D` aplica no seu `<group>`. Duplicar a conta nos dois
 * lugares foi o que permitiu a câmera divergir do desenho; aqui ela passa a ter um dono.
 *
 * Centra pelo ENVELOPE do prédio, não pela massa desenhada — é o que o componente faz
 * hoje, e mudar isso moveria a cena inteira, que não é o escopo deste passo.
 */
export function offsetDaPlanta(largura: number, comprimento: number): Ponto {
  return [-largura / 2, 0, -comprimento / 2];
}

/**
 * O vão de um endereço: onde ele está e QUANTO ele mede.
 *
 * O tamanho entra junto porque o contorno do realce precisa dele: o vão muda de medida
 * por fileira (13 posições em 15,6 m na rua A, 12 em 15 m na E), então um contorno de
 * tamanho fixo desenharia a caixa da rua A em cima da rua E. E ele vem de graça — quem
 * monta o índice já tem o vão inteiro na mão.
 */
export interface VaoIndexado {
  centro: Ponto;
  tamanho: Ponto;
}

/**
 * Código do endereço -> vão desenhado, em coordenada local da planta.
 *
 * Construído a partir dos blocos que a cena JÁ desenha, então o índice não pode apontar
 * para um vão que não existe na tela: é a mesma `vaosDaFileira` que monta o clique.
 *
 * Vão sem código (fileira sem rua cadastrada) fica de fora — ele não corresponde a
 * endereço nenhum.
 */
export function indiceDosVaos(
  blocos: readonly BlocoFisico[],
  prefixo = 'PP',
): Map<string, VaoIndexado> {
  const indice = new Map<string, VaoIndexado>();
  for (const bloco of blocos) {
    if (bloco.tipo !== 'fileira') continue;
    for (const vao of vaosDaFileira(bloco, prefixo)) {
      if (vao.codigo) indice.set(vao.codigo, { centro: vao.centro, tamanho: vao.tamanho });
    }
  }
  return indice;
}

/**
 * Folga entre a cabeceira e a primeira fileira, em metros.
 *
 * Metade do corredor transversal de entrada do prédio atual (1,4 m): a rota atravessa
 * pelo MEIO do corredor, não encostada na ponta da estante.
 */
const FOLGA_DA_CABECEIRA = 0.7;

/**
 * Z da cabeceira na planta física: o corredor transversal por onde se troca de rua.
 *
 * Na grade por código a cabeceira é `-moduleWidth * 0,9` — um ponto ANTES do módulo 1,
 * que ali fica em z=0. Na planta as fileiras começam depois do corredor de entrada do
 * trecho, então aquele valor cairia fora do prédio e a rota sairia pela parede dos fundos
 * para trocar de corredor.
 *
 * Sem fileira nenhuma devolve 0 — não há travessia a desenhar, e um `Infinity` vindo de
 * `Math.min` de lista vazia produziria uma linha até o infinito.
 */
export function cabeceiraDaPlanta(blocos: readonly BlocoFisico[]): number {
  const inicios = blocos
    .filter(b => b.tipo === 'fileira')
    .map(b => b.centro[2] - b.tamanho[2] / 2);
  return inicios.length === 0 ? 0 : Math.min(...inicios) - FOLGA_DA_CABECEIRA;
}

/** Multiplicador do recuo sobre o passo da geometria. 2,2 é o valor que a tela já usava. */
const FATOR_DO_RECUO = 2.2;

/**
 * Quanto a câmera recua ao focar uma vaga, conforme a vista ATIVA.
 *
 * O recuo sempre saiu da grade por código: `max(rowSpacing, moduleWidth) × 2,2` = 8,8 m
 * com os padrões. Na planta física o corredor tem 2,65 m no galpão novo e 1,20 m no prédio
 * atual — recuar 8,8 m põe a câmera DENTRO da estante vizinha, ou duas fileiras adiante.
 * Foi o que apareceu ao usar "Avançar para a parada 1" com a planta desenhada.
 *
 * Na planta o passo é a profundidade da fileira e o vão da posição, não o espaçamento de
 * rua: ~2,64 m, que deixa a câmera no meio do corredor seguinte em vez de dentro do aço.
 */
export function recuoDeFoco(
  cfg: Pick<Layout3DConfig, 'rowSpacing' | 'moduleWidth'>,
  naPlanta: boolean,
): number {
  if (naPlanta) return Math.max(PROFUNDIDADE_DA_FILEIRA, PASSO_DA_POSICAO) * FATOR_DO_RECUO;
  return Math.max(cfg.rowSpacing, cfg.moduleWidth) * FATOR_DO_RECUO;
}

/** Resolvedor da vista por código: a aritmética do endereço. */
export function resolvedorDaGrade(cfg: Layout3DConfig): ResolvedorLocal {
  return vaga => posicaoDaVaga(vaga, cfg);
}

/** Resolvedor da vista da planta: o índice dos vãos desenhados. */
export function resolvedorDaPlanta(indice: ReadonlyMap<string, VaoIndexado>): ResolvedorLocal {
  return vaga => indice.get(vaga.id)?.centro ?? null;
}
