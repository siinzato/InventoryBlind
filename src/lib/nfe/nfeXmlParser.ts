// NF-e XML parser (pure). Uses fast-xml-parser with namespace prefixes removed.

import { XMLParser } from 'fast-xml-parser';
import type { ParsedNfe, ParsedNfeItem } from './nfeTypes';
import { resolveItemEan } from './nfeEanUtils';

export class NfeParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,   // keep cProd / EAN as strings, preserve leading zeros
  parseAttributeValue: false,
  trimValues: true,
});

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function findInfNFe(root: any): any | null {
  // Accept <nfeProc><NFe><infNFe> or isolated <NFe><infNFe>, regardless of order.
  const candidates = [
    root?.nfeProc?.NFe?.infNFe,
    root?.NFe?.infNFe,
    root?.nfeProc?.infNFe,
    root?.infNFe,
  ];
  for (const c of candidates) {
    if (c) return c;
  }
  // Deep fallback: breadth-first search for an infNFe key.
  const queue: any[] = [root];
  while (queue.length) {
    const node = queue.shift();
    if (node == null || typeof node !== 'object') continue;
    for (const key of Object.keys(node)) {
      if (key === 'infNFe' && node[key]) return node[key];
      const val = node[key];
      if (val && typeof val === 'object') queue.push(val);
    }
  }
  return null;
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseNfeXml(xml: string): ParsedNfe {
  if (!xml || xml.trim() === '') {
    throw new NfeParseError('XML vazio.');
  }

  let root: any;
  try {
    root = parser.parse(xml);
  } catch {
    throw new NfeParseError('XML malformado — não foi possível interpretar o arquivo.');
  }

  const infNFe = findInfNFe(root);
  if (!infNFe) {
    throw new NfeParseError('Não foi encontrada a estrutura infNFe. O arquivo não parece ser uma NF-e válida.');
  }

  const idAttr = asString(infNFe['@_Id']);
  if (!idAttr) {
    throw new NfeParseError('A NF-e não possui chave de acesso (Id).');
  }
  // Strip only the "NFe" prefix, keep the 44-digit key intact (leading zeros preserved).
  const invoiceKey = idAttr.replace(/^NFe/i, '').trim();
  if (invoiceKey === '') {
    throw new NfeParseError('Chave de acesso inválida.');
  }

  const ide = infNFe.ide ?? {};
  const emit = infNFe.emit ?? {};
  const dest = infNFe.dest ?? {};
  const infAdic = infNFe.infAdic ?? {};
  const infIntermed = infNFe.infIntermed ?? {};

  const detRaw = toArray(infNFe.det);
  if (detRaw.length === 0) {
    throw new NfeParseError('A NF-e não possui itens (det/prod).');
  }

  const items: ParsedNfeItem[] = [];
  detRaw.forEach((det: any, idx: number) => {
    const prod = det?.prod;
    if (!prod) return;
    const ean = resolveItemEan(prod.cEAN, prod.cEANTrib);
    // rastro pode ser objeto único ou array (vários lotes do mesmo item) — usa o
    // primeiro. A maioria dos itens não declara rastro; nesse caso fica null.
    const rastroList = toArray(prod.rastro);
    const lotNumber = asString((rastroList[0] as { nLote?: unknown } | undefined)?.nLote);
    items.push({
      lineNumber: Number(asString(det['@_nItem']) ?? idx + 1),
      nfeCode: asString(prod.cProd) ?? '',
      description: asString(prod.xProd) ?? '',
      unit: asString(prod.uCom) ?? '',
      expectedQuantity: asNumber(prod.qCom) ?? 0,
      unitValue: asNumber(prod.vUnCom),
      totalValue: asNumber(prod.vProd),
      ean: ean.original,
      eanNormalized: ean.normalized,
      lotNumber,
      externalOrderRef: asString(prod.xPed),
      externalOrderItemRef: asString(prod.nItemPed),
    });
  });

  if (items.length === 0) {
    throw new NfeParseError('Nenhum item com dados de produto (prod) foi encontrado na NF-e.');
  }

  // NFref pode aparecer como objeto único ou array (múltiplas notas referenciadas);
  // usa a primeira refNFe encontrada — é a chave da nota original de uma devolução.
  const nfRefList = toArray(ide.NFref);
  const referencedInvoiceKey = nfRefList
    .map((r: unknown) => asString((r as { refNFe?: unknown } | null)?.refNFe))
    .find((k): k is string => !!k) ?? null;

  return {
    invoiceKey,
    invoiceNumber: asString(ide.nNF),
    invoiceSeries: asString(ide.serie),
    issueDate: asString(ide.dhEmi) ?? asString(ide.dEmi),
    supplierName: asString(emit.xNome),
    supplierCnpj: asString(emit.CNPJ),
    destName: asString(dest.xNome),
    destCnpj: asString(dest.CNPJ),
    destCpf: asString(dest.CPF),
    additionalInfo: asString(infAdic.infCpl),
    items,
    purposeCode: asString(ide.finNFe),
    referencedInvoiceKey,
    indIntermed: asString(ide.indIntermed),
    intermediaryCnpj: asString(infIntermed.CNPJ),
    intermediaryIdCadIntTran: asString(infIntermed.idCadIntTran),
  };
}
