// Planilha e PDF viram as MESMAS linhas que alguém colaria à mão.
//
// ── O funil é um só ───────────────────────────────────────────────────────────
// Colar, planilha e PDF entram por portas diferentes e saem no mesmo lugar:
// `{codigo, caixas}` mais as linhas que precisam de atenção. Dali para a frente o
// caminho já existe e já está testado — prévia editável, resolução de EAN com fila de
// escolha, e `Reservar` travado enquanto houver pendência. Três fontes com três
// validações seriam três conjuntos de bugs para manter.
//
// ── O que NÃO entra aqui ──────────────────────────────────────────────────────
// Nenhuma escrita. Este arquivo lê arquivo e devolve texto estruturado; quem grava item
// é `pickingService`, por RPC, depois da conferência humana.
//
// ── Dependências ──────────────────────────────────────────────────────────────
// Nenhuma nova. `xlsx` já entra por `import()` dinâmico dentro do leitor do Comparador,
// e `pdfjs-dist` já é carregado sob demanda pelo `getPdfjs()` da Central de PDFs — com
// worker configurado e módulo em cache. Reaproveitar os dois evita somar megabytes ao
// pacote e evita um segundo parser do mesmo formato.

import type { CellValue } from '../spreadsheet-comparator/types';
import { interpretarLista, type LinhaDaLista, type LinhaRecusada, type ListaInterpretada } from './pickingService';

// ── Planilha ──────────────────────────────────────────────────────────────────

/** Sem acento, sem caixa, sem espaço das pontas — como cabeçalho de planilha real. */
const achatar = (v: CellValue): string =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const CABECALHO_DE_CODIGO = [
  'sku', 'codigo', 'cod', 'ean', 'gtin', 'produto', 'item', 'referencia', 'ref',
  'codigo do produto', 'codigo produto', 'cod produto',
];

const CABECALHO_DE_QUANTIDADE = [
  'qtd', 'qtde', 'quantidade', 'caixas', 'cx', 'qty', 'quant', 'volumes', 'volume',
  'qtd caixas', 'quantidade de caixas',
];

export type OrigemDaColuna = 'cabecalho' | 'conteudo' | 'nenhuma';

export interface ColunasDetectadas {
  codigo: number | null;
  quantidade: number | null;
  /** De onde veio cada palpite. `conteudo` e `nenhuma` são os casos de conferir. */
  origemDoCodigo: OrigemDaColuna;
  origemDaQuantidade: OrigemDaColuna;
}

/** A coluna é toda de inteiros positivos pequenos? É assim que quantidade se parece. */
function pareceQuantidade(grid: readonly CellValue[][], coluna: number, primeiraLinha: number): boolean {
  let vistos = 0;
  for (let i = primeiraLinha; i < grid.length; i += 1) {
    const bruto = grid[i]?.[coluna];
    if (bruto === undefined || String(bruto).trim() === '') continue;
    const n = Number(String(bruto).replace(',', '.'));
    // Teto de 9999 e inteiro: sem ele, uma coluna de EAN (13 dígitos) passaria por
    // quantidade e a planilha inteira seria lida ao contrário.
    if (!Number.isInteger(n) || n <= 0 || n > 9999) return false;
    vistos += 1;
  }
  return vistos > 0;
}

function preenchimentoDaColuna(grid: readonly CellValue[][], coluna: number, primeiraLinha: number): number {
  let cheias = 0;
  for (let i = primeiraLinha; i < grid.length; i += 1) {
    if (String(grid[i]?.[coluna] ?? '').trim() !== '') cheias += 1;
  }
  return cheias;
}

/**
 * Quais colunas são o código e a quantidade.
 *
 * Primeiro pelo CABEÇALHO, que é o que a pessoa escreveu e portanto o palpite mais
 * honesto. Só quando ele não responde é que o conteúdo decide — e, nesse caso, a origem
 * volta marcada como `conteudo` para a tela pedir conferência em vez de seguir calada.
 * Planilha lida ao contrário importa quantidade como código e vice-versa; é o tipo de
 * erro que só aparece quando o separador já está no corredor.
 */
export function detectarColunas(
  grid: readonly CellValue[][],
  linhaDoCabecalho: number,
): ColunasDetectadas {
  const cabecalho = grid[linhaDoCabecalho] ?? [];
  const largura = grid.reduce((m, l) => Math.max(m, l?.length ?? 0), 0);
  const primeiraLinha = linhaDoCabecalho + 1;

  let codigo: number | null = null;
  let quantidade: number | null = null;
  let origemDoCodigo: OrigemDaColuna = 'nenhuma';
  let origemDaQuantidade: OrigemDaColuna = 'nenhuma';

  for (let c = 0; c < largura; c += 1) {
    const titulo = achatar(cabecalho[c]);
    if (titulo === '') continue;
    if (codigo === null && CABECALHO_DE_CODIGO.includes(titulo)) {
      codigo = c;
      origemDoCodigo = 'cabecalho';
    } else if (quantidade === null && CABECALHO_DE_QUANTIDADE.includes(titulo)) {
      quantidade = c;
      origemDaQuantidade = 'cabecalho';
    }
  }

  if (quantidade === null) {
    for (let c = largura - 1; c >= 0; c -= 1) {
      if (c === codigo) continue;
      if (pareceQuantidade(grid, c, primeiraLinha)) {
        quantidade = c;
        origemDaQuantidade = 'conteudo';
        break;
      }
    }
  }

  if (codigo === null) {
    let melhor = -1;
    for (let c = 0; c < largura; c += 1) {
      if (c === quantidade) continue;
      const cheias = preenchimentoDaColuna(grid, c, primeiraLinha);
      if (cheias > melhor) { melhor = cheias; codigo = c; }
    }
    if (codigo !== null && melhor > 0) origemDoCodigo = 'conteudo';
    else codigo = null;
  }

  return { codigo, quantidade, origemDoCodigo, origemDaQuantidade };
}

/**
 * A grade vira linhas de demanda.
 *
 * O número que volta em `recusadas` é o da LINHA DA PLANILHA (1-based), não o índice do
 * laço: é esse número que aparece no Excel de quem vai corrigir.
 */
export function linhasDaPlanilha(
  grid: readonly CellValue[][],
  linhaDoCabecalho: number,
  colunaDoCodigo: number | null,
  colunaDaQuantidade: number | null,
): ListaInterpretada {
  const linhas: LinhaDaLista[] = [];
  const recusadas: LinhaRecusada[] = [];

  if (colunaDoCodigo === null || colunaDaQuantidade === null) return { linhas, recusadas };

  for (let i = linhaDoCabecalho + 1; i < grid.length; i += 1) {
    const linha = grid[i] ?? [];
    const codigo = String(linha[colunaDoCodigo] ?? '').trim();
    const quantidadeBruta = String(linha[colunaDaQuantidade] ?? '').trim();
    const numeroDaLinha = i + 1;
    const textoOriginal = `${codigo} ${quantidadeBruta}`.trim();

    // Linha totalmente vazia é separador visual da planilha, não erro de ninguém.
    if (codigo === '' && quantidadeBruta === '') continue;

    if (codigo === '') {
      recusadas.push({ linha: numeroDaLinha, texto: textoOriginal, motivo: 'sem_codigo' });
      continue;
    }
    if (quantidadeBruta === '') {
      recusadas.push({ linha: numeroDaLinha, texto: textoOriginal, motivo: 'sem_quantidade' });
      continue;
    }

    // Em planilha a coluna já diz o que é quantidade: não há a ambiguidade da vírgula
    // que a lista colada tem, e `10,0` exportado em pt-BR é dez.
    const caixas = Number(quantidadeBruta.replace(',', '.'));
    if (!Number.isInteger(caixas) || caixas <= 0) {
      recusadas.push({ linha: numeroDaLinha, texto: textoOriginal, motivo: 'quantidade_invalida' });
      continue;
    }

    linhas.push({ codigo, caixas });
  }

  return { linhas, recusadas };
}

// ── PDF ───────────────────────────────────────────────────────────────────────

/** Um pedaço de texto do PDF, com onde ele está na página. */
export interface FragmentoDePdf {
  texto: string;
  x: number;
  y: number;
}

/**
 * Tolerância vertical, em pontos, para dois fragmentos serem "a mesma linha".
 *
 * O PDF não tem linhas: tem pedaços de texto com coordenada. Fragmentos da mesma linha
 * raramente têm o mesmo Y exato — mudam com o tamanho da fonte e com sobrescrito. Três
 * pontos é menos que o entrelinhas de qualquer corpo de texto e mais que o ruído.
 */
const TOLERANCIA_Y = 3;

/**
 * Fragmentos soltos viram linhas de texto.
 *
 * Agrupa por Y (de cima para baixo) e ordena por X (da esquerda para a direita). Sem
 * isto, `getTextContent` devolve a ordem interna do arquivo, que não é a ordem visual —
 * e a lista sairia embaralhada, com o código de uma linha ao lado da quantidade de
 * outra.
 */
export function linhasDeFragmentos(fragmentos: readonly FragmentoDePdf[]): string[] {
  const uteis = fragmentos.filter(f => f.texto.trim() !== '');
  if (uteis.length === 0) return [];

  const grupos: { y: number; itens: FragmentoDePdf[] }[] = [];

  for (const f of [...uteis].sort((a, b) => b.y - a.y)) {
    const grupo = grupos.find(g => Math.abs(g.y - f.y) <= TOLERANCIA_Y);
    if (grupo) grupo.itens.push(f);
    else grupos.push({ y: f.y, itens: [f] });
  }

  return grupos
    .map(g => g.itens.sort((a, b) => a.x - b.x).map(i => i.texto.trim()).filter(Boolean).join(' ').trim())
    .filter(linha => linha !== '');
}

/**
 * O texto do PDF vira linhas de demanda.
 *
 * Passa pelo MESMO `interpretarLista` da lista colada: o texto de um PDF é texto solto,
 * com as mesmas armadilhas (quantidade no fim, separador variado, número solto no meio),
 * e uma segunda interpretação divergiria da primeira no primeiro caso estranho.
 */
export function linhasDoPdf(fragmentos: readonly FragmentoDePdf[]): ListaInterpretada {
  return interpretarLista(linhasDeFragmentos(fragmentos).join('\n'));
}

// ── Leitura dos arquivos (a parte que toca disco e rede) ──────────────────────

export interface PlanilhaLida {
  grid: CellValue[][];
  linhaDoCabecalho: number;
  colunas: ColunasDetectadas;
  abas: string[];
  abaAtiva: string;
  truncada: boolean;
}

export async function lerPlanilha(arquivo: File, aba?: string): Promise<PlanilhaLida> {
  const { readSpreadsheetGrid, detectHeaderRowIndex, validateFileBeforeParse } =
    await import('../spreadsheet-comparator/fileParser');

  const problema = validateFileBeforeParse(arquivo);
  if (problema) throw new Error(problema);

  const lida = await readSpreadsheetGrid(arquivo, aba);
  const linhaDoCabecalho = detectHeaderRowIndex(lida.grid);

  return {
    grid: lida.grid,
    linhaDoCabecalho,
    colunas: detectarColunas(lida.grid, linhaDoCabecalho),
    abas: lida.sheetNames,
    abaAtiva: lida.activeSheet,
    truncada: lida.truncated,
  };
}

export class PdfSemTexto extends Error {
  constructor() {
    super('Este PDF não tem texto para extrair — provavelmente é uma imagem escaneada. Use planilha ou cole a lista.');
    this.name = 'PdfSemTexto';
  }
}

/**
 * Extrai os fragmentos de texto de todas as páginas.
 *
 * PDF escaneado não tem texto nenhum: tem uma foto da página. Leitura por OCR está fora
 * desta etapa, e fingir que o arquivo veio vazio deixaria a pessoa esperando uma prévia
 * que nunca chega — por isso o caso tem erro próprio, com a saída dita em voz alta.
 */
export async function lerPdf(arquivo: File): Promise<FragmentoDePdf[]> {
  const { getPdfjs } = await import('../pdfCenter/pdfLoader');
  const pdfjs = await getPdfjs();

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('O arquivo está vazio.');

  const tarefa = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await tarefa.promise;

  try {
    const fragmentos: FragmentoDePdf[] = [];

    for (let p = 1; p <= doc.numPages; p += 1) {
      const pagina = await doc.getPage(p);
      const conteudo = await pagina.getTextContent();

      for (const item of conteudo.items) {
        if (!('str' in item)) continue;
        const transform = item.transform as number[];
        fragmentos.push({
          texto: item.str,
          x: transform[4] ?? 0,
          // O Y do PDF cresce para CIMA. Somar o número da página mantém a ordem entre
          // páginas quando os fragmentos de todas elas vão para a mesma lista.
          y: (transform[5] ?? 0) - p * 100_000,
        });
      }
    }

    if (fragmentos.every(f => f.texto.trim() === '')) throw new PdfSemTexto();
    return fragmentos;
  } finally {
    await tarefa.destroy();
  }
}

// ── Correção no lugar, venha a linha de onde vier ─────────────────────────────

/**
 * Reaplica as correções que a pessoa digitou sobre as linhas recusadas.
 *
 * ── Por que isto existe ───────────────────────────────────────────────────────
 * Quem cola a lista corrige no próprio texto. Quem sobe planilha ou PDF não tem texto
 * para corrigir — e mandar a pessoa voltar ao Excel, arrumar e subir de novo por causa
 * de uma linha é o tipo de atrito que faz a importação ser abandonada no meio.
 *
 * A linha corrigida passa a ser TEXTO LIVRE e volta pelo `interpretarLista`, com as
 * mesmas regras da lista colada — inclusive a da ambiguidade. Depois da edição não há
 * mais coluna dizendo o que é quantidade, então não há como ser mais permissivo aqui
 * sem voltar a adivinhar.
 */
export function aplicarAjustes(
  previa: ListaInterpretada,
  ajustes: Readonly<Record<number, string>>,
): ListaInterpretada {
  const linhas = [...previa.linhas];
  const recusadas: LinhaRecusada[] = [];

  for (const recusada of previa.recusadas) {
    const novo = ajustes[recusada.linha];
    if (novo === undefined || novo.trim() === recusada.texto.trim()) {
      recusadas.push(recusada);
      continue;
    }

    const relida = interpretarLista(novo);
    if (relida.linhas.length > 0) {
      linhas.push(...relida.linhas);
      continue;
    }

    // Continua ruim: mantém o NÚMERO da linha de origem, que é por onde a pessoa se
    // localiza no arquivo, e mostra o texto já corrigido com o motivo novo.
    recusadas.push({
      linha: recusada.linha,
      texto: novo,
      motivo: relida.recusadas[0]?.motivo ?? 'sem_quantidade',
    });
  }

  return { linhas, recusadas };
}
