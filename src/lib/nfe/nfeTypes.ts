// NF-e Blind Conference — shared types (Etapa 1)

export type InvoiceStatus = 'not_started' | 'in_progress' | 'completed' | 'with_divergences';
export type ItemResultStatus = 'unlinked' | 'pending' | 'ok' | 'missing' | 'surplus';
export type LinkMethod = 'none' | 'sku' | 'ean' | 'learned' | 'manual';
export type CountSource = 'scanner' | 'manual' | 'camera' | 'voice';
export type CountMode = 'increment' | 'set';

// ── Parsed XML shapes (before persistence) ──────────────────────────────────

export interface ParsedNfeItem {
  lineNumber: number;
  nfeCode: string;          // cProd, preserved as string
  description: string;      // xProd
  unit: string;             // uCom
  expectedQuantity: number; // qCom
  unitValue: number | null; // vUnCom
  totalValue: number | null;// vProd
  ean: string | null;         // original valid EAN (cEAN preferred, else cEANTrib)
  eanNormalized: string | null; // normalized comparison form
  /** det/prod/rastro/nLote — primeiro lote informado, quando o item tem rastreabilidade.
   *  Null quando a NF-e não declara lote (a maioria dos itens não declara). */
  lotNumber: string | null;
  /** det/prod/xPed — número do pedido de compra/venda externo, quando a NF-e o
   *  declara. Só referência/auditoria: nunca cria um pedido interno nem é usado
   *  para decidir o canal de origem da devolução. */
  externalOrderRef: string | null;
  /** det/prod/nItemPed — número do item dentro do pedido externo acima. */
  externalOrderItemRef: string | null;
}

export interface ParsedNfe {
  invoiceKey: string;       // chave, "NFe" prefix removed
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  issueDate: string | null; // ISO
  supplierName: string | null;
  supplierCnpj: string | null;
  /** dest/xNome, dest/CNPJ, dest/CPF — o destinatário da nota. Uma pessoa física
   *  tem CPF em vez de CNPJ, então os dois campos convivem, nunca inventados. */
  destName: string | null;
  destCnpj: string | null;
  destCpf: string | null;
  /** infAdic/infCpl — texto livre, informação complementar genérica da NF-e.
   *  Nunca usada para preencher automaticamente motivo, canal de origem ou
   *  qualquer outro campo — é texto livre, exatamente o tipo de fonte que não
   *  é uma evidência estruturada. */
  additionalInfo: string | null;
  items: ParsedNfeItem[];
  purposeCode: string | null;          // finNFe (1=normal, 2=complementar, 3=ajuste, 4=devolução)
  referencedInvoiceKey: string | null; // ide/NFref/refNFe — chave da NF-e original, quando referenciada
  /** ide/indIntermed — indicador de operação em site/plataforma de terceiros
   *  (intermediador). "1" = com intermediador. Evidência bruta, exibida para
   *  contexto; a resolução do canal de origem depende de intermediaryIdCadIntTran. */
  indIntermed: string | null;
  /** infIntermed/CNPJ — CNPJ do intermediador (ex.: o CNPJ do próprio Mercado
   *  Livre). Sozinho não distingue contas/lojas diferentes do mesmo intermediador. */
  intermediaryCnpj: string | null;
  /** infIntermed/idCadIntTran — identificador do cadastro do vendedor no
   *  intermediador. É o identificador que de fato diferencia contas/lojas
   *  distintas por trás do mesmo CNPJ de intermediador (ex.: várias contas
   *  Mercado Livre de um mesmo CNPJ). */
  intermediaryIdCadIntTran: string | null;
}

// ── Product catalog (shared, global) ─────────────────────────────────────────

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  location: string | null;
}

// ── Persisted rows ───────────────────────────────────────────────────────────

export interface NfeInvoice {
  id: string;
  company_id: string;
  invoice_key: string;
  invoice_number: string | null;
  invoice_series: string | null;
  issue_date: string | null;
  supplier_name: string | null;
  supplier_cnpj: string | null;
  status: InvoiceStatus;
  total_items: number;
  raw_xml: string | null;
  created_by: string | null;
  started_at: string | null;
  started_by: string | null;
  finished_at: string | null;
  finished_by: string | null;
  created_at: string;
  updated_at: string;
  /** Arquivamento (migration 062). Preenchido, a nota sai do histórico visível e
   *  não aceita mais escrita nenhuma — o trigger nfe_invoices_guard_archived
   *  recusa. Nada é apagado: itens, eventos e XML continuam gravados.
   *
   *  Opcional no tipo de propósito: `select('*')` não devolve estas colunas
   *  enquanto a migration não for aplicada, e o resto da tela precisa continuar
   *  funcionando. Ver isArchived()/filterActive() em lib/admin/recordAdmin.ts. */
  deleted_at?: string | null;
  deleted_by?: string | null;
  deletion_reason?: string | null;
}

export interface NfeInvoiceItem {
  id: string;
  invoice_id: string;
  company_id: string;
  line_number: number | null;
  nfe_code: string | null;
  description: string | null;
  unit: string | null;
  expected_quantity: number;
  unit_value: number | null;
  total_value: number | null;
  nfe_ean: string | null;
  nfe_ean_normalized: string | null;
  product_id: string | null;
  link_method: LinkMethod;
  physical_quantity: number | null;
  result_status: ItemResultStatus | null;
  snapshot_product_name: string | null;
  snapshot_sku: string | null;
  snapshot_ean: string | null;
  created_at: string;
  updated_at: string;
}

export interface LearnedAssociation {
  id: string;
  company_id: string;
  match_type: 'sku' | 'ean';
  match_value: string;
  product_id: string;
  created_by: string | null;
  created_at: string;
}

// ── Association resolution result (preparation stage) ────────────────────────

export interface LinkResolution {
  productId: string | null;
  method: LinkMethod;
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  not_started: 'Não iniciada',
  in_progress: 'Em contagem',
  completed: 'Concluída',
  with_divergences: 'Com divergências',
};

export const ITEM_RESULT_LABEL: Record<ItemResultStatus, string> = {
  unlinked: 'Não vinculado',
  pending: 'Não conferido',
  ok: 'OK',
  missing: 'Falta',
  surplus: 'Sobra',
};
