import { describe, expect, it } from 'vitest';
import {
  EMPTY_EBOOK_FILTERS, applyEbookFilters, authorLine, creditEntries, deriveEbookFilterOptions,
  downloadFileName, isExternalContent, matchesLibrarySearch, metaLine, resolveEbookAccess,
} from '../libraryEbooks';
import type { LibraryResource } from '../../supabase';

function resource(overrides: Partial<LibraryResource> = {}): LibraryResource {
  return {
    id: 'r1',
    title: 'Material',
    description: null,
    category: 'ebook',
    external_url: null,
    is_placeholder: false,
    order_index: 0,
    created_at: '2026-09-01T00:00:00Z',
    publisher: null,
    page_count: null,
    format: null,
    cover_url: null,
    themes: null,
    subject: null,
    authors: null,
    source_url: null,
    storage_path: null,
    language: null,
    subcategory: null,
    level: null,
    published_year: null,
    content_origin: 'ib',
    license_name: null,
    license_url: null,
    rights_note: null,
    ...overrides,
  };
}

/** O e-book realmente cadastrado hoje (migration 097 + 105). */
const LEGACY_EBOOK = resource({
  id: 'legacy',
  title: 'Gestão de entregas inteligente: como otimizar sua logística de ponta a ponta',
  category: 'ebook',
  external_url: '/library/gestao-de-entregas-inteligente.pdf',
  publisher: 'Senior',
  page_count: 41,
  format: 'PDF',
  subject: 'Logística',
  themes: ['Otimização logística', 'Torre de controle'],
  content_origin: 'external',
});

/** Recursos antigos: checklists/POPs/templates continuam sendo conteúdo I.B, sem arquivo. */
const LEGACY_CHECKLIST = resource({
  id: 'checklist', title: 'Checklist de Organização — Pilar 1', category: 'checklist',
  is_placeholder: true, content_origin: 'ib',
});

describe('resolveEbookAccess — Storage tem prioridade, legado continua funcionando', () => {
  it('1/2. o e-book legado continua abrindo pelo external_url', () => {
    expect(resolveEbookAccess(LEGACY_EBOOK).file).toEqual({
      kind: 'legacy', url: '/library/gestao-de-entregas-inteligente.pdf',
    });
  });

  it('3. storage_path tem prioridade quando existe, mesmo com external_url preenchido', () => {
    const migrated = resource({ ...LEGACY_EBOOK, storage_path: 'ebooks/logistica/gestao-de-entregas.pdf' });
    expect(resolveEbookAccess(migrated).file).toEqual({
      kind: 'storage', path: 'ebooks/logistica/gestao-de-entregas.pdf',
    });
  });

  it('sem arquivo nenhum não há origem de leitura — a UI não monta botão morto', () => {
    expect(resolveEbookAccess(LEGACY_CHECKLIST).file).toBeNull();
  });

  it('4. source_url é exposto separadamente do arquivo', () => {
    const withSource = resource({
      storage_path: 'ebooks/logistica/warehouse-distribution-science.pdf',
      source_url: 'https://www.isye.gatech.edu/publicacao-oficial',
    });
    const access = resolveEbookAccess(withSource);
    expect(access.sourceUrl).toBe('https://www.isye.gatech.edu/publicacao-oficial');
    expect(access.file).toEqual({ kind: 'storage', path: 'ebooks/logistica/warehouse-distribution-science.pdf' });
  });

  it('5. source_url nulo ou vazio não gera "Fonte original"', () => {
    expect(resolveEbookAccess(resource({ source_url: null })).sourceUrl).toBeNull();
    expect(resolveEbookAccess(resource({ source_url: '   ' })).sourceUrl).toBeNull();
  });

  it('nunca usa external_url como fonte original silenciosamente', () => {
    expect(resolveEbookAccess(LEGACY_EBOOK).sourceUrl).toBeNull();
  });
});

describe('downloadFileName', () => {
  it('usa o nome real do arquivo do Storage', () => {
    const r = resource({ storage_path: 'ebooks/logistica/warehouse-distribution-science.pdf' });
    expect(downloadFileName(r)).toBe('warehouse-distribution-science.pdf');
  });

  it('cai para um slug do título quando o caminho não termina em .pdf', () => {
    const r = resource({ title: 'Gestão Logística e Tendências', storage_path: 'ebooks/logistica/arquivo' });
    expect(downloadFileName(r)).toBe('gestao-logistica-e-tendencias.pdf');
  });
});

describe('créditos e origem do conteúdo', () => {
  it('6. conteúdo externo mostra autoria, instituição, ano e licença quando cadastrados', () => {
    const r = resource({
      content_origin: 'external',
      authors: ['John J. Bartholdi', 'Steven T. Hackman'],
      publisher: 'Georgia Institute of Technology',
      published_year: 2019,
      subject: 'Logística',
      subcategory: 'Warehouse & Distribuição',
      license_name: 'CC BY 4.0',
      license_url: 'https://creativecommons.org/licenses/by/4.0/',
    });
    expect(isExternalContent(r)).toBe(true);
    expect(creditEntries(r)).toEqual([
      { label: 'Autores', value: 'John J. Bartholdi · Steven T. Hackman' },
      { label: 'Fonte/Instituição', value: 'Georgia Institute of Technology' },
      { label: 'Ano', value: '2019' },
      { label: 'Categoria', value: 'Logística' },
      { label: 'Subcategoria', value: 'Warehouse & Distribuição' },
      { label: 'Licença', value: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' },
    ]);
  });

  it('7. conteúdo I.B não é marcado como externo', () => {
    expect(isExternalContent(LEGACY_CHECKLIST)).toBe(false);
    expect(isExternalContent(resource({ content_origin: 'ib' }))).toBe(false);
  });

  it('material gratuito sem licença cadastrada NÃO ganha linha de licença', () => {
    const free = resource({ content_origin: 'external', publisher: 'The World Bank', license_name: null });
    expect(creditEntries(free).some(c => c.label === 'Licença')).toBe(false);
  });

  it('autoria: singular, plural e ausência (institucional) sem inventar autor', () => {
    expect(authorLine(resource({ authors: ['Luiz Henrique'] }))).toEqual({ label: 'Autor', value: 'Luiz Henrique' });
    expect(authorLine(resource({ authors: ['Elisa Maria Vissotto', 'Bruno Batista Boniati' ] })))
      .toEqual({ label: 'Autores', value: 'Elisa Maria Vissotto · Bruno Batista Boniati' });
    expect(authorLine(resource({ authors: null, publisher: 'NATO' }))).toBeNull();
    expect(authorLine(resource({ authors: [] }))).toBeNull();
  });

  it('metaLine só lista o que existe — página desconhecida não vira zero', () => {
    expect(metaLine(resource({ language: 'Inglês', page_count: null, format: 'PDF', level: 'Avançado' })))
      .toEqual(['Inglês', 'PDF', 'Avançado']);
    expect(metaLine(resource())).toEqual([]);
  });
});

describe('busca e filtros da biblioteca', () => {
  it('8. busca considera autor, instituição, tema, área, subcategoria e idioma', () => {
    const r = resource({
      title: 'Warehouse & Distribution Science',
      authors: ['John J. Bartholdi'],
      publisher: 'Georgia Institute of Technology',
      subject: 'Logística',
      subcategory: 'Warehouse & Distribuição',
      language: 'Inglês',
      themes: ['Supply Chain'],
    });
    for (const term of ['bartholdi', 'georgia', 'logística', 'warehouse & distribuição', 'inglês', 'supply chain']) {
      expect(matchesLibrarySearch(r, term)).toBe(true);
    }
    expect(matchesLibrarySearch(r, 'excel')).toBe(false);
  });

  it('1. recursos antigos continuam encontráveis pelo comportamento de busca atual', () => {
    expect(matchesLibrarySearch(LEGACY_CHECKLIST, 'checklist')).toBe(true);
    expect(matchesLibrarySearch(LEGACY_EBOOK, 'senior')).toBe(true);
    expect(matchesLibrarySearch(LEGACY_EBOOK, '')).toBe(true);
  });

  it('9. opções de filtro derivam só dos registros carregados, ordenadas e sem duplicar', () => {
    const ebooks = [
      resource({ id: 'a', subject: 'Logística', level: 'Avançado', language: 'Inglês' }),
      resource({ id: 'b', subject: 'Excel', level: 'Básico', language: 'Português' }),
      resource({ id: 'c', subject: 'Logística', level: 'Básico', language: 'Português' }),
      resource({ id: 'd', subject: null, level: null, language: null }),
    ];
    expect(deriveEbookFilterOptions(ebooks)).toEqual({
      subjects: ['Excel', 'Logística'],
      levels: ['Avançado', 'Básico'],
      languages: ['Inglês', 'Português'],
    });
    expect(deriveEbookFilterOptions([])).toEqual({ subjects: [], levels: [], languages: [] });
  });

  it('9. filtros combinam área, nível e idioma; "all" não filtra nada', () => {
    const ebooks = [
      resource({ id: 'a', subject: 'Logística', level: 'Avançado', language: 'Inglês' }),
      resource({ id: 'b', subject: 'Logística', level: 'Básico', language: 'Português' }),
      resource({ id: 'c', subject: 'Excel', level: 'Básico', language: 'Português' }),
    ];
    expect(applyEbookFilters(ebooks, EMPTY_EBOOK_FILTERS)).toHaveLength(3);
    expect(applyEbookFilters(ebooks, { ...EMPTY_EBOOK_FILTERS, subject: 'Logística' }).map(r => r.id)).toEqual(['a', 'b']);
    expect(applyEbookFilters(ebooks, { subject: 'Logística', level: 'Básico', language: 'Português' }).map(r => r.id)).toEqual(['b']);
    expect(applyEbookFilters(ebooks, { ...EMPTY_EBOOK_FILTERS, language: 'Espanhol' })).toEqual([]);
  });
});
