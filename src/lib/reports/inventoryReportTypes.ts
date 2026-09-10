// Emitir Relatório — tipos puros da folha de contagem física. Zero imports:
// tudo aqui é consumido tanto pelo algoritmo (testável sem React) quanto pela
// UI e pelo gerador de PDF.

/** Produto do workspace ativo, já reduzido ao que a folha usa. */
export interface ReportProduct {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  /** `products.location` — este app associa no máximo UM endereço por produto. */
  location: string | null;
  brandId: string | null;
  lineId: string | null;
}

export type ReportSelectionMode = 'location' | 'brand' | 'manual';

/** De onde vem a coluna Saldo/Contagem. Nada aqui escreve no estoque. */
export type BalanceSource = 'blank' | 'manual' | 'tiny';

/** Como o saldo daquela linha foi resolvido — governa o que a folha imprime. */
export type BalanceStatus =
  | 'blank'      // em branco, para preencher à mão
  | 'matched'    // veio da planilha do Tiny (SKU ou EAN exato)
  | 'manual'     // digitado na pré-visualização
  | 'not-found'  // não existe na planilha importada
  | 'ambiguous'; // SKU/EAN duplicado na planilha — nunca chutar de quem é

export interface InventoryReportRow {
  productId: string;
  name: string;
  sku: string;
  ean: string | null;
  location: string | null;
  /** Texto já formatado; preserva zeros à esquerda e o "0" legítimo. null = vazio. */
  balance: string | null;
  balanceStatus: BalanceStatus;
  /** Só usado no agrupamento do relatório por linha/marca. */
  groupLabel: string | null;
}

export interface LocationRangeSelection {
  from: string;
  to: string;
}

/** Cabeçalho da folha — o que descreve a emissão. */
export interface ReportMeta {
  workspaceName: string;
  emittedAt: Date;
  mode: ReportSelectionMode;
  filterDescription: string;
  productCount: number;
  locationCount: number;
  groupNames: string[];
}
