// A aritmética do Modo Construção: onde a peça encaixa e com o que ela esbarra.
//
// Mora fora do componente porque é o que decide se um clique constrói ou não, e isso não
// se confere por screenshot. Um erro aqui produz peça dentro de peça — que no desenho
// parece só um pedaço escondido e na operação é um corredor que o mapa diz existir e que
// está bloqueado.
//
// ── O que este módulo NÃO sabe ─────────────────────────────────────────────────
// Cor, material, WebGL e React. Ele recebe medidas e devolve pegadas e veredito. É por
// isso que a colisão pode ser testada com números em vez de montar cena.
//
// ── Por que a rotação é só em múltiplos de 90° ─────────────────────────────────
// O builder gira de quarto em quarto de volta, como todo editor de planta. Isso não é
// limitação: é o que permite a pegada continuar sendo um retângulo alinhado aos eixos, e
// portanto a colisão ser uma comparação de quatro números em vez de um teste de polígonos
// rotacionados. Ângulo livre exigiria SAT, e ninguém constrói galpão em diagonal.

/** Pegada de uma peça no piso, em metros, já com a rotação aplicada. */
export interface Pegada {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** O mínimo de uma peça colocada para calcular pegada. */
export interface PecaNoPiso {
  id: string;
  /** Centro no piso, em metros. */
  x: number;
  z: number;
  /** Giro em torno de Y, em radianos. Múltiplos de 90°. */
  rotacaoY: number;
}

/** Passo da grade de construção, em metros — a mesma linha que o piso desenha. */
export const PASSO_DA_GRADE = 1;

/**
 * Quarto de volta. Exportado porque o atalho de teclado e o botão giram pelo MESMO valor:
 * duas constantes de 90° em dois arquivos divergem no dia em que alguém mudar uma.
 */
export const QUARTO_DE_VOLTA = Math.PI / 2;

/**
 * A peça está girada de lado?
 *
 * `Math.round` antes do módulo porque a rotação acumula em ponto flutuante: somar π/2
 * quatro vezes não dá exatamente 2π, e comparar o resto cru classificaria errado a peça
 * que deu a volta completa.
 */
export function deLado(rotacaoY: number): boolean {
  const quartos = Math.round(rotacaoY / QUARTO_DE_VOLTA);
  return Math.abs(quartos % 2) === 1;
}

/**
 * Normaliza a rotação para [0, 2π).
 *
 * Sem isto, girar cinquenta vezes guarda um número que cresce para sempre no banco, e a
 * peça recarregada vem com rotação de 78 radianos — que desenha certo e lê como erro.
 */
export function normalizarRotacao(rotacaoY: number): number {
  const volta = QUARTO_DE_VOLTA * 4;
  const quartos = Math.round(rotacaoY / QUARTO_DE_VOLTA);
  return ((quartos * QUARTO_DE_VOLTA) % volta + volta) % volta;
}

/** Encaixa um valor na grade. É o que faz o fantasma grudar na linha que se está vendo. */
export function encaixar(valor: number, passo: number = PASSO_DA_GRADE): number {
  if (passo <= 0) return valor;
  return Math.round(valor / passo) * passo;
}

/**
 * A pegada de uma peça, em metros.
 *
 * `largura` e `profundidade` são as medidas SEM giro; a troca entre elas é o giro. A
 * altura não entra: colisão de peça no piso é problema de planta, e duas coisas no mesmo
 * x,z se atrapalham mesmo que uma seja mais baixa — uma demarcação de doca sob um
 * porta-pallets é desenho mentindo sobre o que dá para fazer naquele metro quadrado.
 */
export function pegadaDaPeca(
  peca: PecaNoPiso,
  largura: number,
  profundidade: number,
): Pegada {
  const girada = deLado(peca.rotacaoY);
  const lx = (girada ? profundidade : largura) / 2;
  const lz = (girada ? largura : profundidade) / 2;
  return { x0: peca.x - lx, x1: peca.x + lx, z0: peca.z - lz, z1: peca.z + lz };
}

/**
 * Duas pegadas se sobrepõem?
 *
 * `folga` negativa permite encostar: com 0, duas peças que compartilham exatamente a borda
 * seriam dadas como colidindo, e encostar uma estante na outra é construção normal num
 * galpão. O padrão é uma folga mínima que só perdoa o erro de ponto flutuante.
 */
export function sobrepoe(a: Pegada, b: Pegada, folga = 1e-6): boolean {
  return (
    a.x0 < b.x1 - folga &&
    b.x0 < a.x1 - folga &&
    a.z0 < b.z1 - folga &&
    b.z0 < a.z1 - folga
  );
}

/** Uma peça colocada, com a pegada já resolvida. O id serve para excluir a si mesma. */
export interface PecaComPegada {
  id: string;
  pegada: Pegada;
}

/**
 * O lugar aceita a peça?
 *
 * `ignorar` é o id da peça que está sendo ARRASTADA: ela não pode colidir consigo mesma,
 * senão mover um centímetro seria sempre inválido.
 *
 * `obstaculos` são as pegadas que o builder não controla — as fileiras da planta e as
 * bancadas. Construir em cima do armazém cadastrado é pior que construir em cima de outra
 * peça do esboço: a primeira existe de verdade.
 */
export function lugarLivre(
  candidata: Pegada,
  colocadas: readonly PecaComPegada[],
  obstaculos: readonly Pegada[] = [],
  ignorar: string | null = null,
): boolean {
  for (const outra of colocadas) {
    if (outra.id === ignorar) continue;
    if (sobrepoe(candidata, outra.pegada)) return false;
  }
  for (const obstaculo of obstaculos) {
    if (sobrepoe(candidata, obstaculo)) return false;
  }
  return true;
}

/** Quem ocupa este ponto do piso? Serve ao clique que seleciona sem passar pelo raycast. */
export function pecaNoPonto(
  x: number,
  z: number,
  colocadas: readonly PecaComPegada[],
): string | null {
  // De trás para frente: a última colocada está por cima, e é nela que se clica.
  for (let i = colocadas.length - 1; i >= 0; i -= 1) {
    const { x0, x1, z0, z1 } = colocadas[i].pegada;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return colocadas[i].id;
  }
  return null;
}

/**
 * Posição de uma peça em texto, para o gerenciador.
 *
 * Uma casa decimal: a grade é de 1 m e o arraste encaixa nela, então a segunda casa só
 * apareceria como ruído de ponto flutuante. O sinal explícito do metro evita ler "4 2"
 * como quarenta e dois.
 */
export function posicaoEmTexto(peca: PecaNoPiso): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
  return `${n(peca.x)} m · ${n(peca.z)} m`;
}

/** Rotação em graus, para o gerenciador. */
export function rotacaoEmGraus(rotacaoY: number): number {
  return (Math.round(normalizarRotacao(rotacaoY) / QUARTO_DE_VOLTA) * 90) % 360;
}

// ── Quem é o alvo da exclusão ────────────────────────────────────────────────────────
//
// ── As três coisas que a cena desenha, e por que só uma se apagava ──────────────
// O Modo Edição parecia ter um bug de seleção. Não tinha: a cena sobrepõe TRÊS coisas que
// moram em tabelas diferentes e significam coisas diferentes.
//
//   1. PEÇA DO ESBOÇO — `warehouse_builder_objects`. Desenho, sem dado. Nasce e morre no
//      builder, e some ao sair sem salvar. É a única que o builder sempre soube apagar.
//   2. FILEIRA DA PLANTA — não é linha de tabela nenhuma: é o enésimo retângulo gerado a
//      partir de `fileiras: 5` num trecho de `warehouse_plan_sections`. Não existe "a
//      fileira D" para apagar; existe um CONTADOR de fileiras e uma lista de rótulos.
//   3. ENDEREÇO — `warehouse_storage_bins`, o `PP-D16-N1` que recebe mercadoria. É o que
//      está debaixo do cursor quando se clica num vão.
//
// Clicar num vão selecionava o ENDEREÇO (abre a ficha da vaga), e o botão do builder só
// olhava para a peça do esboço — por isso ele ficava apagado. Esta função é a regra que
// decide qual dos dois o comando de excluir está mirando.
//
// A fileira inteira continua fora: removê-la é editar a planta publicada e deixar os 16
// endereços da rua órfãos, o que é mudança de plano do galpão e não exclusão do que está
// sob o cursor.

export type AlvoDeExclusao =
  | { tipo: 'peca'; id: string }
  | { tipo: 'endereco'; codigo: string }
  | null;

/**
 * O que o comando de excluir vai apagar.
 *
 * A peça do esboço VENCE quando as duas estão selecionadas, e a razão é a assimetria do
 * estrago: apagar peça de esboço se desfaz saindo sem salvar, apagar endereço vai ao
 * banco e não volta. Em dúvida, o comando mira no que é reversível.
 *
 * Fora do Modo Edição não há alvo: a ficha da vaga continua abrindo ao clicar, mas apagar
 * endereço não pode ser consequência de um clique em modo de leitura.
 */
export function alvoDeExclusao(
  modoVisor: string,
  pecaSelecionada: string | null,
  vagaSelecionada: { id: string } | null,
): AlvoDeExclusao {
  if (modoVisor !== 'edicao') return null;
  if (pecaSelecionada) return { tipo: 'peca', id: pecaSelecionada };
  if (vagaSelecionada) return { tipo: 'endereco', codigo: vagaSelecionada.id };
  return null;
}

// ── A POSIÇÃO, que é o que se chama de "aquele porta-pallets" ────────────────────────
//
// Clicar num vão seleciona UM endereço: `PP-D16-N1` é a rua D, posição 16, nível 1.
// Apagar só ele deixa os níveis de cima no ar — a estante continua lá, um vão a menos, e
// quem clicou acha que o comando não fez nada.
//
// O que a pessoa aponta quando aponta um porta-pallets é a POSIÇÃO: a coluna inteira de
// níveis naquele ponto da rua. É isso que esta função resolve.
//
// A rua inteira continua fora, e de propósito: ela não é linha de tabela nenhuma, é um
// contador de fileiras na planta publicada.

/** `PP-D16-N1` → `PP-D16`. `null` quando o código não segue o padrão do endereço. */
export function posicaoDoCodigo(codigo: string): string | null {
  const m = /^(.+)-N\d+$/.exec(codigo.trim());
  return m ? m[1] : null;
}

/**
 * Todos os endereços da MESMA posição, incluindo o informado.
 *
 * Ordenado pelo código para a confirmação listar os níveis de baixo para cima, que é a
 * ordem em que se olha para uma estante.
 *
 * Código fora do padrão devolve só ele mesmo: apagar o que se apontou é sempre defensável;
 * adivinhar um agrupamento a partir de um código que não se entende, não.
 */
export function codigosDaMesmaPosicao(codigo: string, todos: readonly string[]): string[] {
  const posicao = posicaoDoCodigo(codigo);
  if (!posicao) return [codigo];
  const irmaos = todos.filter(c => posicaoDoCodigo(c) === posicao);
  return irmaos.length > 0 ? [...irmaos].sort() : [codigo];
}
