// A máquina de bipagem do separador: ordem dos passos, identidade do produto e a chave
// que impede a mesma caixa de sair duas vezes.
//
// Pura de propósito. Esta é a parte da separação que decide se uma baixa acontece, e
// num corredor com sinal ruim ela precisa ser conferível sem câmera, sem banco e sem
// aparelho — só com números.
//
// ── Até onde vai a cegueira ───────────────────────────────────────────────────
// A conferência de verdade é do BANCO: `picking_wave_pick` compara o produto bipado com
// o da parada e recusa sem dizer qual era o certo. O cliente conhece o SKU da parada
// (vem na rota), então a cegueira aqui é de TELA — a interface não mostra o SKU
// pendente. É a mesma limitação que a conferência cega de NF-e já aceita neste projeto,
// e está escrita aqui para ninguém confundir "a tela não mostra" com "o cliente não
// sabe".

/** Um item da onda, do ponto de vista de quem bipa: o que pode casar com uma leitura. */
export interface ItemBipavel {
  produtoId: string;
  sku: string;
  ean: string | null;
}

export type EtapaDaBipagem = 'endereco' | 'produto' | 'quantidade';

export interface EstadoDaBipagem {
  /** Endereço já conferido contra a parada ativa. */
  enderecoConfirmado: boolean;
  /** Código do produto já resolvido dentro da onda. */
  produtoConfirmado: string | null;
}

/**
 * Qual passo está em aberto.
 *
 * A ordem é estrita — endereço, depois produto, depois quantidade — e não é cerimônia:
 * conferir o produto antes do endereço aceitaria a caixa certa tirada da vaga errada,
 * que é como o saldo de dois endereços passa a mentir ao mesmo tempo.
 */
export function etapaDaBipagem(estado: EstadoDaBipagem): EtapaDaBipagem {
  if (!estado.enderecoConfirmado) return 'endereco';
  if (!estado.produtoConfirmado) return 'produto';
  return 'quantidade';
}

/** Normaliza o que veio do leitor: espaço das pontas e caixa alta. */
export const normalizarLeitura = (bruto: string): string => bruto.trim().toUpperCase();

/**
 * O endereço bipado é o da parada?
 *
 * Compara já normalizado dos dois lados. O leitor laser costuma mandar o código com um
 * `Enter` colado e, dependendo do aparelho, em caixa baixa — recusar por causa disso
 * mandaria o operador digitar um endereço que ele acabou de ler corretamente.
 */
export function enderecoConfere(bipado: string, esperado: string): boolean {
  const lido = normalizarLeitura(bipado);
  return lido !== '' && lido === normalizarLeitura(esperado);
}

/**
 * Quem, dentro da onda, atende este código.
 *
 * Devolve lista porque o cadastro tem EANs repetidos entre produtos — foram medidos 199.
 * Dentro de uma onda a chance de dois candidatos é menor, mas não é zero, e escolher o
 * primeiro em silêncio seria dar baixa no SKU errado com a confirmação do sistema.
 *
 * Lista vazia NÃO interrompe o envio: a leitura segue para o banco, que recusa e grava o
 * evento. Recusa que o cliente engole não existe para quem for investigar depois.
 */
export function candidatosNaOnda(codigo: string, itens: readonly ItemBipavel[]): ItemBipavel[] {
  const lido = normalizarLeitura(codigo);
  if (lido === '') return [];

  const porSku = itens.filter(i => normalizarLeitura(i.sku) === lido);
  if (porSku.length > 0) return porSku;

  return itens.filter(i => (i.ean ?? '').trim() !== '' && (i.ean ?? '').trim() === codigo.trim());
}

/** O que a quantidade digitada significa para esta parada. */
export type LeituraDaQuantidade = 'total' | 'parcial' | 'excesso' | 'invalida';

export function classificarQuantidade(caixas: number, restantes: number): LeituraDaQuantidade {
  if (!Number.isInteger(caixas) || caixas <= 0) return 'invalida';
  if (caixas > restantes) return 'excesso';
  if (caixas === restantes) return 'total';
  return 'parcial';
}

// ── A chave que impede a baixa dupla ──────────────────────────────────────────

/**
 * Hash determinístico de 128 bits sobre um texto, no formato de UUID.
 *
 * Por que não `crypto.randomUUID()`: a chave precisa ser a MESMA quando o operador
 * reenvia a mesma ação. Chave nova a cada tentativa transformaria o reenvio depois de um
 * timeout em uma segunda baixa — a rede do galpão cai no meio do POST, o aparelho tenta
 * de novo, e duas caixas saem do saldo tendo uma saído da prateleira.
 *
 * `tentativa` é o que torna a chave diferente entre ações DISTINTAS na mesma parada: ela
 * sobe quando o operador começa uma ação nova, nunca quando a mesma ação é reenviada.
 *
 * FNV-1a em quatro rodadas com sementes diferentes. Não é criptográfico e não precisa
 * ser: ele só distingue tentativas dentro de uma onda, e a unicidade final quem garante
 * é o `UNIQUE` da coluna no banco.
 */
export function chaveDeterministica(semente: string): string {
  const bytes = new Uint8Array(16);

  for (let bloco = 0; bloco < 4; bloco += 1) {
    let h = 0x811c9dc5 ^ (bloco * 0x9e3779b9);
    for (let i = 0; i < semente.length; i += 1) {
      h ^= semente.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    bytes[bloco * 4 + 0] = (h >>> 24) & 0xff;
    bytes[bloco * 4 + 1] = (h >>> 16) & 0xff;
    bytes[bloco * 4 + 2] = (h >>> 8) & 0xff;
    bytes[bloco * 4 + 3] = h & 0xff;
  }

  // Marca de versão 4 e variante RFC 4122: o destino é uma coluna `uuid`, e um texto que
  // não é UUID válido seria recusado pelo banco no pior momento possível.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type AcaoDaParada = 'separar' | 'ruptura';

/**
 * A chave de uma tentativa.
 *
 * Entram a parada, a ação, a quantidade e o número da tentativa. A quantidade entra
 * porque separar 2 e separar 3 na mesma parada são ações diferentes — sem ela, corrigir
 * a quantidade antes de reenviar devolveria o resultado da primeira em vez de aplicar a
 * segunda.
 */
export function chaveDaTentativa(
  alocacaoId: string,
  acao: AcaoDaParada,
  caixas: number,
  tentativa: number,
): string {
  return chaveDeterministica(`${alocacaoId}|${acao}|${caixas}|${tentativa}`);
}

// ── Progresso ─────────────────────────────────────────────────────────────────

export interface ProgressoDaOnda {
  paradasTotais: number;
  paradasEncerradas: number;
  caixasPedidas: number;
  caixasSeparadas: number;
  /** 0 a 100, já arredondado. Serve à barra e ao texto. */
  percentual: number;
}

export function progressoDaRota(
  rota: readonly { estado: string; caixas: number; separadas: number }[],
): ProgressoDaOnda {
  const paradasTotais = rota.length;
  const paradasEncerradas = rota.filter(
    p => p.estado === 'separado' || p.estado === 'ruptura' || p.estado === 'cancelado',
  ).length;
  // ── Parada encerrada SEM mercadoria não conta como pedido ──────────────────
  //
  // Medido na tela: uma onda de 1 caixa, depois de uma ruptura com realocação, dizia
  // "2 caixas sem separar". A rota passa a ter DUAS linhas para a mesma caixa — a que
  // não tinha mercadoria e a que recebeu a realocação —, e somar `caixas` de todas
  // contava a mesma demanda duas vezes.
  //
  // Parada de ruptura ou cancelada entra pelo que REALMENTE saiu dela (uma parcial
  // seguida de ruptura deu caixa de verdade); o que faltou já está representado na
  // parada nova.
  const caixasPedidas = rota.reduce(
    (s, p) => s + (p.estado === 'ruptura' || p.estado === 'cancelado' ? p.separadas : p.caixas),
    0,
  );
  const caixasSeparadas = rota.reduce((s, p) => s + p.separadas, 0);

  return {
    paradasTotais,
    paradasEncerradas,
    caixasPedidas,
    caixasSeparadas,
    // Pelas CAIXAS, não pelas paradas: uma parada de 1 caixa e outra de 40 não valem o
    // mesmo para quem está empurrando o carrinho.
    percentual: caixasPedidas === 0 ? 0 : Math.round((caixasSeparadas / caixasPedidas) * 100),
  };
}
