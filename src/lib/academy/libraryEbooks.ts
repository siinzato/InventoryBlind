// Biblioteca da I.B Academy — regras puras do catálogo (busca, filtros, créditos e qual
// caminho usar para ler/baixar cada material). Sem I/O: a resolução de signed URL e o
// download real ficam em academyService.ts, para que estas regras sejam testáveis sem
// Supabase — mesmo padrão dos outros módulos de regra do projeto.
import type { LibraryResource } from '../supabase';

export const CATEGORY_LABEL: Record<LibraryResource['category'], string> = {
  pdf: 'PDF',
  checklist: 'Checklist',
  pop: 'POP',
  template: 'Template',
  ebook: 'E-book',
};

/** De onde sai o arquivo de um material. `storage` é o PDF hospedado pelo InventoryBlind;
 *  `legacy` é o arquivo antigo apontado por external_url (compatibilidade com o que já
 *  existe); `null` quando não há arquivo — nesse caso a UI não mostra botão morto. */
export type EbookFileSource =
  | { kind: 'storage'; path: string }
  | { kind: 'legacy'; url: string };

export interface EbookAccess {
  file: EbookFileSource | null;
  /** Origem oficial da obra. Nunca preenchido a partir de external_url. */
  sourceUrl: string | null;
}

function trimmed(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v;
}

/** storage_path tem prioridade sobre external_url; o legado só entra quando não há arquivo no
 *  Storage, o que mantém o e-book já cadastrado (/library/...) funcionando até ser migrado. */
export function resolveEbookAccess(r: LibraryResource): EbookAccess {
  const storagePath = trimmed(r.storage_path);
  const legacyUrl = trimmed(r.external_url);

  return {
    file: storagePath
      ? { kind: 'storage', path: storagePath }
      : legacyUrl ? { kind: 'legacy', url: legacyUrl } : null,
    sourceUrl: trimmed(r.source_url),
  };
}

export function isExternalContent(r: LibraryResource): boolean {
  return r.content_origin === 'external';
}

/** Nome de arquivo sugerido no download — derivado do caminho real, com o título como
 *  último recurso. */
export function downloadFileName(r: LibraryResource): string {
  const access = resolveEbookAccess(r);
  const raw = access.file?.kind === 'storage' ? access.file.path
    : access.file?.kind === 'legacy' ? access.file.url
    : null;
  const fromPath = raw?.split('?')[0].split('/').pop();
  if (fromPath && fromPath.toLowerCase().endsWith('.pdf')) return fromPath;

  const slug = r.title.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'material'}.pdf`;
}

export interface AuthorLine {
  label: 'Autor' | 'Autores';
  value: string;
}

/** null quando não há autoria cadastrada — a UI cai para `publisher` como referência
 *  editorial em vez de inventar um autor. */
export function authorLine(r: LibraryResource): AuthorLine | null {
  const names = (r.authors ?? []).map(a => a.trim()).filter(a => a !== '');
  if (names.length === 0) return null;
  return { label: names.length === 1 ? 'Autor' : 'Autores', value: names.join(' · ') };
}

export function matchesLibrarySearch(r: LibraryResource, term: string): boolean {
  if (!term) return true;
  const haystack = [
    r.title,
    r.description ?? '',
    CATEGORY_LABEL[r.category],
    r.publisher ?? '',
    r.subject ?? '',
    r.subcategory ?? '',
    r.language ?? '',
    r.level ?? '',
    ...(r.authors ?? []),
    ...(r.themes ?? []),
  ].join(' ').toLowerCase();
  return haystack.includes(term);
}

export interface EbookFilters {
  subject: string;
  level: string;
  language: string;
}

export const EMPTY_EBOOK_FILTERS: EbookFilters = { subject: 'all', level: 'all', language: 'all' };

export interface EbookFilterOptions {
  subjects: string[];
  levels: string[];
  languages: string[];
}

/** Opções derivadas SOMENTE dos registros carregados — nada hardcodado, então a Biblioteca
 *  nunca oferece um filtro que não devolve resultado. */
export function deriveEbookFilterOptions(ebooks: LibraryResource[]): EbookFilterOptions {
  const collect = (pick: (r: LibraryResource) => string | null): string[] => {
    const set = new Set<string>();
    for (const r of ebooks) {
      const value = trimmed(pick(r));
      if (value) set.add(value);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };

  return {
    subjects: collect(r => r.subject),
    levels: collect(r => r.level),
    languages: collect(r => r.language),
  };
}

export function applyEbookFilters(ebooks: LibraryResource[], filters: EbookFilters): LibraryResource[] {
  return ebooks.filter(r =>
    (filters.subject === 'all' || trimmed(r.subject) === filters.subject) &&
    (filters.level === 'all' || trimmed(r.level) === filters.level) &&
    (filters.language === 'all' || trimmed(r.language) === filters.language)
  );
}

/** Linha de metadados do card — só o que existe de verdade, na ordem de leitura. */
export function metaLine(r: LibraryResource): string[] {
  const parts: string[] = [];
  const language = trimmed(r.language);
  const format = trimmed(r.format);
  const level = trimmed(r.level);
  if (language) parts.push(language);
  if (r.page_count != null) parts.push(`${r.page_count} páginas`);
  if (format) parts.push(format);
  if (level) parts.push(level);
  return parts;
}

export interface CreditEntry {
  label: string;
  value: string;
  /** Quando presente, o valor é um link (licença com URL conhecida). */
  href?: string;
}

/** Créditos da obra — cada linha só aparece com dado real cadastrado. "Gratuito" nunca é
 *  convertido em licença: sem license_name, a linha de licença simplesmente não existe. */
export function creditEntries(r: LibraryResource): CreditEntry[] {
  const entries: CreditEntry[] = [];

  const authors = authorLine(r);
  if (authors) entries.push({ label: authors.label, value: authors.value });

  const publisher = trimmed(r.publisher);
  if (publisher) entries.push({ label: 'Fonte/Instituição', value: publisher });

  if (r.published_year != null) entries.push({ label: 'Ano', value: String(r.published_year) });

  const subject = trimmed(r.subject);
  if (subject) entries.push({ label: 'Categoria', value: subject });

  const subcategory = trimmed(r.subcategory);
  if (subcategory) entries.push({ label: 'Subcategoria', value: subcategory });

  const license = trimmed(r.license_name);
  if (license) entries.push({ label: 'Licença', value: license, href: trimmed(r.license_url) ?? undefined });

  const rights = trimmed(r.rights_note);
  if (rights) entries.push({ label: 'Direitos', value: rights });

  return entries;
}

/** Aviso institucional para conteúdo de terceiro — discreto, não um alerta jurídico. */
export const EXTERNAL_CONTENT_NOTICE =
  'Material produzido por terceiros e disponibilizado com os respectivos créditos. O InventoryBlind não reivindica autoria sobre esta obra.';
