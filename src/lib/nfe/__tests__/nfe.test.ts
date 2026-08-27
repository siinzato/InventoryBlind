import { describe, it, expect } from 'vitest';
import { normalizeEan, resolveItemEan, isValidEan, buildEanIndex } from '../nfeEanUtils';
import { parseNfeXml, NfeParseError } from '../nfeXmlParser';
import {
  resolveAssociation,
  buildProductLookups,
  suggestByName,
  jaccardSimilarity,
  normalizeNameTokens,
} from '../nfeAssociation';
import { computeItemStatus, computeReportStats } from '../nfeReportUtils';
import type { CatalogProduct, NfeInvoiceItem } from '../nfeTypes';

// ── EAN normalization ────────────────────────────────────────────────────────

describe('normalizeEan', () => {
  it('accepts valid 8/12/13/14-digit GTINs', () => {
    expect(normalizeEan('7891234567895')).toBe('7891234567895'); // 13
    expect(normalizeEan('12345678')).toBe('12345678'); // 8
    expect(normalizeEan('123456789012')).toBe('123456789012'); // 12
    expect(normalizeEan('12345678901234')).toBe('12345678901234'); // 14
  });

  it('preserves leading zeros', () => {
    expect(normalizeEan('0000000012345')).toBe('0000000012345');
  });

  it('treats SEM GTIN / 0 / empty / N/A as absent', () => {
    expect(normalizeEan('SEM GTIN')).toBeNull();
    expect(normalizeEan('SEMGTIN')).toBeNull();
    expect(normalizeEan('0')).toBeNull();
    expect(normalizeEan('')).toBeNull();
    expect(normalizeEan('   ')).toBeNull();
    expect(normalizeEan('N/A')).toBeNull();
    expect(normalizeEan(null)).toBeNull();
    expect(normalizeEan('000000')).toBeNull();
  });

  it('rejects invalid lengths', () => {
    expect(normalizeEan('123')).toBeNull();
    expect(normalizeEan('123456789')).toBeNull(); // 9 digits
  });

  it('isValidEan mirrors normalizeEan', () => {
    expect(isValidEan('7891234567895')).toBe(true);
    expect(isValidEan('SEM GTIN')).toBe(false);
  });
});

describe('resolveItemEan', () => {
  it('prefers cEAN when valid', () => {
    const r = resolveItemEan('7891234567895', '7899999999994');
    expect(r.normalized).toBe('7891234567895');
    expect(r.original).toBe('7891234567895');
  });

  it('falls back to cEANTrib only when cEAN absent/invalid', () => {
    const r = resolveItemEan('SEM GTIN', '7899999999994');
    expect(r.normalized).toBe('7899999999994');
  });

  it('returns null when both invalid', () => {
    const r = resolveItemEan('SEM GTIN', 'SEM GTIN');
    expect(r.normalized).toBeNull();
    expect(r.original).toBeNull();
  });
});

// ── EAN indexing (R3: duplicate EAN across NF-e lines) ───────────────────────

describe('buildEanIndex', () => {
  const mkItem = (over: Partial<NfeInvoiceItem>): NfeInvoiceItem => ({
    id: 'i', invoice_id: 'v', company_id: 'c', line_number: 1, nfe_code: 'x',
    description: 'd', unit: 'UN', expected_quantity: 10, unit_value: null, total_value: null,
    nfe_ean: null, nfe_ean_normalized: null, product_id: null, link_method: 'none',
    physical_quantity: null, result_status: null, snapshot_product_name: null,
    snapshot_sku: null, snapshot_ean: null, created_at: '', updated_at: '', ...over,
  });

  it('indexes a unique EAN to a single-item list', () => {
    const items = [mkItem({ id: 'a', nfe_ean_normalized: '7891234567895' })];
    const idx = buildEanIndex(items, new Map());
    expect(idx.get('7891234567895')).toHaveLength(1);
    expect(idx.get('7891234567895')?.[0].id).toBe('a');
  });

  it('groups every line sharing the same EAN instead of overwriting (R3)', () => {
    const items = [
      mkItem({ id: 'a', line_number: 1, nfe_ean_normalized: '789123', description: 'Produto A' }),
      mkItem({ id: 'b', line_number: 2, nfe_ean_normalized: '789123', description: 'Produto B' }),
    ];
    const idx = buildEanIndex(items, new Map());
    const candidates = idx.get('789123');
    expect(candidates).toHaveLength(2);
    expect(candidates?.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('lets the caller pick the correct line out of the duplicate-EAN group', () => {
    const items = [
      mkItem({ id: 'a', line_number: 3, nfe_ean_normalized: '789123' }),
      mkItem({ id: 'b', line_number: 7, nfe_ean_normalized: '789123' }),
    ];
    const idx = buildEanIndex(items, new Map());
    const candidates = idx.get('789123') ?? [];
    const chosen = candidates.find((i) => i.line_number === 7);
    expect(chosen?.id).toBe('b');
  });

  it('returns undefined for a code that does not belong to the invoice', () => {
    const items = [mkItem({ id: 'a', nfe_ean_normalized: '789123' })];
    const idx = buildEanIndex(items, new Map());
    expect(idx.get('000000')).toBeUndefined();
  });

  it('still resolves via the linked product catalog EAN when the NF-e line has none', () => {
    const items = [mkItem({ id: 'a', nfe_ean_normalized: null, product_id: 'p' })];
    const products = new Map([['p', { id: 'p', name: 'Produto', sku: 'S1', ean: '7891234567895', location: null }]]);
    const idx = buildEanIndex(items, products);
    expect(idx.get('7891234567895')?.[0].id).toBe('a');
  });
});

// ── XML parsing ──────────────────────────────────────────────────────────────

const singleItemNfe = `<?xml version="1.0"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe35240112345678000190550010000000011000000010">
    <ide><nNF>123</nNF><serie>1</serie><dhEmi>2024-01-10T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor Alpha</xNome></emit>
    <det nItem="1"><prod>
      <cProd>ABC001</cProd><cEAN>7891234567895</cEAN><xProd>Caneta Azul</xProd>
      <uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>1.50</vUnCom><vProd>15.00</vProd>
      <cEANTrib>7891234567895</cEANTrib>
    </prod></det>
  </infNFe></NFe>
</nfeProc>`;

const multiItemIsolatedNfe = `<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe99990112345678000190550010000000011000000010">
  <ide><nNF>777</nNF><serie>2</serie></ide>
  <emit><CNPJ>99990000000190</CNPJ><xNome>Beta LTDA</xNome></emit>
  <det nItem="1"><prod><cProd>0010</cProd><cEAN>SEM GTIN</cEAN><cEANTrib>0000000012345</cEANTrib><xProd>Item A</xProd><uCom>CX</uCom><qCom>5</qCom></prod></det>
  <det nItem="2"><prod><cProd>0020</cProd><cEAN>7899999999994</cEAN><xProd>Item B</xProd><uCom>UN</uCom><qCom>3</qCom></prod></det>
</infNFe></NFe>`;

describe('parseNfeXml', () => {
  it('parses nfeProc with a single det as object', () => {
    const nfe = parseNfeXml(singleItemNfe);
    expect(nfe.invoiceKey).toBe('35240112345678000190550010000000011000000010');
    expect(nfe.invoiceNumber).toBe('123');
    expect(nfe.supplierName).toBe('Fornecedor Alpha');
    expect(nfe.items).toHaveLength(1);
    expect(nfe.items[0].nfeCode).toBe('ABC001');
    expect(nfe.items[0].eanNormalized).toBe('7891234567895');
    expect(nfe.items[0].expectedQuantity).toBe(10);
  });

  it('parses isolated NFe with multiple det as array + SEM GTIN + cEANTrib fallback + leading zeros', () => {
    const nfe = parseNfeXml(multiItemIsolatedNfe);
    expect(nfe.invoiceKey).toBe('99990112345678000190550010000000011000000010');
    expect(nfe.items).toHaveLength(2);
    expect(nfe.items[0].nfeCode).toBe('0010'); // leading zeros preserved
    expect(nfe.items[0].eanNormalized).toBe('0000000012345'); // cEANTrib fallback
    expect(nfe.items[1].eanNormalized).toBe('7899999999994');
  });

  it('throws on malformed / missing structure', () => {
    expect(() => parseNfeXml('not xml <<<')).toThrow(NfeParseError);
    expect(() => parseNfeXml('<root><foo/></root>')).toThrow(NfeParseError);
    expect(() => parseNfeXml('')).toThrow(NfeParseError);
  });

  it('extracts finNFe (purposeCode) and the referenced original NF-e key (NFref/refNFe), used by Logística Reversa', () => {
    const devolucaoNfe = `<?xml version="1.0"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe35240112345678000190550010000000021000000021">
    <ide>
      <nNF>456</nNF><serie>1</serie><finNFe>4</finNFe>
      <NFref><refNFe>35240112345678000190550010000000011000000010</refNFe></NFref>
    </ide>
    <emit><CNPJ>98765432000199</CNPJ><xNome>Cliente Devolvendo</xNome></emit>
    <det nItem="1"><prod><cProd>ABC001</cProd><xProd>Caneta Azul</xProd><uCom>UN</uCom><qCom>2</qCom></prod></det>
  </infNFe></NFe>
</nfeProc>`;
    const nfe = parseNfeXml(devolucaoNfe);
    expect(nfe.purposeCode).toBe('4');
    expect(nfe.referencedInvoiceKey).toBe('35240112345678000190550010000000011000000010');
  });

  it('purposeCode/referencedInvoiceKey são null quando a NF-e não referencia nenhuma nota original', () => {
    const nfe = parseNfeXml(singleItemNfe);
    expect(nfe.purposeCode).toBeNull();
    expect(nfe.referencedInvoiceKey).toBeNull();
  });

  it('extrai destinatário (nome, CNPJ ou CPF) e informações complementares, quando presentes', () => {
    const withDest = `<?xml version="1.0"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe35240112345678000190550010000000031000000031">
    <ide><nNF>789</nNF><serie>1</serie></ide>
    <emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor Alpha</xNome></emit>
    <dest><CNPJ>98765432000199</CNPJ><xNome>Cliente Devolvendo LTDA</xNome></dest>
    <det nItem="1"><prod><cProd>ABC001</cProd><xProd>Caneta Azul</xProd><uCom>UN</uCom><qCom>2</qCom></prod></det>
    <infAdic><infCpl>Devolução referente ao pedido 5521 — produto com defeito de fábrica.</infCpl></infAdic>
  </infNFe></NFe>
</nfeProc>`;
    const nfe = parseNfeXml(withDest);
    expect(nfe.destName).toBe('Cliente Devolvendo LTDA');
    expect(nfe.destCnpj).toBe('98765432000199');
    expect(nfe.destCpf).toBeNull();
    expect(nfe.additionalInfo).toBe('Devolução referente ao pedido 5521 — produto com defeito de fábrica.');
  });

  it('destinatário pessoa física usa CPF em vez de CNPJ', () => {
    const withCpfDest = `<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe35240112345678000190550010000000041000000041">
  <ide><nNF>111</nNF><serie>1</serie></ide>
  <emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor Alpha</xNome></emit>
  <dest><CPF>11122233344</CPF><xNome>Maria Consumidora</xNome></dest>
  <det nItem="1"><prod><cProd>ABC001</cProd><xProd>Caneta Azul</xProd><uCom>UN</uCom><qCom>1</qCom></prod></det>
</infNFe></NFe>`;
    const nfe = parseNfeXml(withCpfDest);
    expect(nfe.destName).toBe('Maria Consumidora');
    expect(nfe.destCnpj).toBeNull();
    expect(nfe.destCpf).toBe('11122233344');
  });

  it('destName/destCnpj/destCpf/additionalInfo são null quando a NF-e não os declara', () => {
    const nfe = parseNfeXml(singleItemNfe);
    expect(nfe.destName).toBeNull();
    expect(nfe.destCnpj).toBeNull();
    expect(nfe.destCpf).toBeNull();
    expect(nfe.additionalInfo).toBeNull();
  });

  it('extrai o lote (rastro/nLote) do item quando presente, usando o primeiro lote informado', () => {
    const withLote = `<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe35240112345678000190550010000000051000000051">
  <ide><nNF>222</nNF><serie>1</serie></ide>
  <emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor Alpha</xNome></emit>
  <det nItem="1"><prod>
    <cProd>ABC001</cProd><xProd>Remédio X</xProd><uCom>CX</uCom><qCom>4</qCom>
    <rastro><nLote>L2024-01</nLote><qLote>4</qLote></rastro>
  </prod></det>
</infNFe></NFe>`;
    const nfe = parseNfeXml(withLote);
    expect(nfe.items[0].lotNumber).toBe('L2024-01');
  });

  it('lotNumber é null quando o item não declara rastro', () => {
    const nfe = parseNfeXml(singleItemNfe);
    expect(nfe.items[0].lotNumber).toBeNull();
  });

  it('extrai evidências do intermediador (indIntermed, infIntermed/CNPJ, infIntermed/idCadIntTran) e xPed/nItemPed do item, usadas pelo resolvedor de canal de origem', () => {
    const withIntermed = `<?xml version="1.0"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe35240112345678000190550010000000061000000061">
    <ide><nNF>333</nNF><serie>1</serie><indIntermed>1</indIntermed></ide>
    <emit><CNPJ>12345678000190</CNPJ><xNome>Fornecedor Alpha</xNome></emit>
    <det nItem="1"><prod>
      <cProd>ABC001</cProd><xProd>Caneta Azul</xProd><uCom>UN</uCom><qCom>1</qCom>
      <xPed>2000001234567890</xPed><nItemPed>1</nItemPed>
    </prod></det>
    <infIntermed><CNPJ>03007331000141</CNPJ><idCadIntTran>GOCASE123</idCadIntTran></infIntermed>
  </infNFe></NFe>
</nfeProc>`;
    const nfe = parseNfeXml(withIntermed);
    expect(nfe.indIntermed).toBe('1');
    expect(nfe.intermediaryCnpj).toBe('03007331000141');
    expect(nfe.intermediaryIdCadIntTran).toBe('GOCASE123');
    expect(nfe.items[0].externalOrderRef).toBe('2000001234567890');
    expect(nfe.items[0].externalOrderItemRef).toBe('1');
  });

  it('indIntermed/intermediaryCnpj/intermediaryIdCadIntTran/externalOrderRef são null quando a NF-e não declara intermediador (a maioria não declara)', () => {
    const nfe = parseNfeXml(singleItemNfe);
    expect(nfe.indIntermed).toBeNull();
    expect(nfe.intermediaryCnpj).toBeNull();
    expect(nfe.intermediaryIdCadIntTran).toBeNull();
    expect(nfe.items[0].externalOrderRef).toBeNull();
    expect(nfe.items[0].externalOrderItemRef).toBeNull();
  });
});

// ── Association priority ─────────────────────────────────────────────────────

const catalog: CatalogProduct[] = [
  { id: 'p-sku', name: 'Produto SKU', sku: 'ABC001', ean: '1111111111116', location: null },
  { id: 'p-ean', name: 'Produto EAN', sku: 'ZZZ999', ean: '7891234567895', location: null },
];

describe('resolveAssociation', () => {
  const { bySku, byEan } = buildProductLookups(catalog);
  const emptyLearned = { bySku: new Map(), byEan: new Map() };

  it('prioritizes exact SKU over EAN', () => {
    const r = resolveAssociation(
      { nfeCode: 'ABC001', eanNormalized: '7891234567895' },
      bySku, byEan, emptyLearned,
    );
    expect(r.method).toBe('sku');
    expect(r.productId).toBe('p-sku');
  });

  it('falls back to EAN when SKU unknown', () => {
    const r = resolveAssociation(
      { nfeCode: 'UNKNOWN', eanNormalized: '7891234567895' },
      bySku, byEan, emptyLearned,
    );
    expect(r.method).toBe('ean');
    expect(r.productId).toBe('p-ean');
  });

  it('uses learned association only as a fallback, never overriding exact', () => {
    const learned = { bySku: new Map([['ABC001', 'p-wrong']]), byEan: new Map() };
    const exact = resolveAssociation(
      { nfeCode: 'ABC001', eanNormalized: null }, bySku, byEan, learned,
    );
    expect(exact.method).toBe('sku'); // exact wins over learned
    expect(exact.productId).toBe('p-sku');

    const fallback = resolveAssociation(
      { nfeCode: 'NEW01', eanNormalized: null },
      bySku, byEan, { bySku: new Map([['NEW01', 'p-ean']]), byEan: new Map() },
    );
    expect(fallback.method).toBe('learned');
  });

  it('returns none when nothing matches', () => {
    const r = resolveAssociation(
      { nfeCode: 'NOPE', eanNormalized: null }, bySku, byEan, emptyLearned,
    );
    expect(r.method).toBe('none');
    expect(r.productId).toBeNull();
  });
});

// ── Name similarity ──────────────────────────────────────────────────────────

describe('name similarity', () => {
  it('ignores accents, case and stopwords', () => {
    const a = normalizeNameTokens('Café com Leite Integral');
    const b = normalizeNameTokens('CAFE LEITE integral');
    expect(jaccardSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it('suggests a product above threshold but never auto-confirms', () => {
    const products: CatalogProduct[] = [
      { id: 'x', name: 'Caneta Esferografica Azul', sku: 'S1', ean: null, location: null },
      { id: 'y', name: 'Borracha Branca', sku: 'S2', ean: null, location: null },
    ];
    const s = suggestByName('Caneta Azul', products);
    expect(s?.product.id).toBe('x');
    expect(s?.score).toBeGreaterThanOrEqual(0.25);
  });

  it('returns null when nothing is similar enough', () => {
    const products: CatalogProduct[] = [
      { id: 'y', name: 'Parafuso Sextavado', sku: 'S2', ean: null, location: null },
    ];
    expect(suggestByName('Caneta Azul', products)).toBeNull();
  });
});

// ── Report status calculation ────────────────────────────────────────────────

describe('computeItemStatus', () => {
  it('classifies each outcome', () => {
    expect(computeItemStatus({ product_id: null, physical_quantity: null, expected_quantity: 5 })).toBe('unlinked');
    expect(computeItemStatus({ product_id: 'p', physical_quantity: null, expected_quantity: 5 })).toBe('pending');
    expect(computeItemStatus({ product_id: 'p', physical_quantity: 5, expected_quantity: 5 })).toBe('ok');
    expect(computeItemStatus({ product_id: 'p', physical_quantity: 3, expected_quantity: 5 })).toBe('missing');
    expect(computeItemStatus({ product_id: 'p', physical_quantity: 8, expected_quantity: 5 })).toBe('surplus');
  });
});

describe('computeReportStats', () => {
  const mk = (over: Partial<NfeInvoiceItem>): NfeInvoiceItem => ({
    id: 'i', invoice_id: 'v', company_id: 'c', line_number: 1, nfe_code: 'x',
    description: 'd', unit: 'UN', expected_quantity: 10, unit_value: null, total_value: null,
    nfe_ean: null, nfe_ean_normalized: null, product_id: 'p', link_method: 'sku',
    physical_quantity: null, result_status: null, snapshot_product_name: null,
    snapshot_sku: null, snapshot_ean: null, created_at: '', updated_at: '', ...over,
  });

  it('counts divergences that numerically cancel as TWO divergences, not zero', () => {
    const items = [
      mk({ id: 'a', expected_quantity: 10, physical_quantity: 0, result_status: 'missing' }),  // -10
      mk({ id: 'b', expected_quantity: 10, physical_quantity: 20, result_status: 'surplus' }), // +10
    ];
    const s = computeReportStats(items);
    expect(s.missingCount).toBe(1);
    expect(s.surplusCount).toBe(1);
    expect(s.okCount).toBe(0);
    expect(s.conformityPct).toBe(0); // not 100
  });

  it('computes ok/missing/surplus/uncounted and conformity on conferred items', () => {
    const items = [
      mk({ id: 'a', expected_quantity: 5, physical_quantity: 5, result_status: 'ok' }),
      mk({ id: 'b', expected_quantity: 5, physical_quantity: 2, result_status: 'missing' }),
      mk({ id: 'c', expected_quantity: 5, physical_quantity: null, result_status: 'pending' }),
    ];
    const s = computeReportStats(items);
    expect(s.okCount).toBe(1);
    expect(s.missingCount).toBe(1);
    expect(s.uncountedCount).toBe(1);
    expect(s.conferredCount).toBe(2);
    expect(s.conformityPct).toBe(50); // 1 OK of 2 conferred
    expect(s.totalNfQty).toBe(15);
    expect(s.totalPhysicalQty).toBe(7);
  });
});
