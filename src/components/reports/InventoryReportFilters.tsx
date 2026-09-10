// Seleção dos produtos que entram na folha — por endereço, por linha/marca ou
// manual. Só apresentação e estado local de busca/página: toda a lógica de
// faixa, ordenação e associação vive em src/lib/reports/.

import { useMemo, useState } from 'react';
import { ListChecks, MapPin, Search, Tag } from 'lucide-react';
import { Badge, Button, Input, Panel, PanelSection, SegmentedControl, Table, Td, Th, Thead, Tr } from '../ui';
import type { SegmentedOption } from '../ui';
import { matchesProductSearch } from '../../lib/reports/inventoryReportAlgorithm';
import type { ReportProduct, ReportSelectionMode } from '../../lib/reports/inventoryReportTypes';
import type { ProductBrand, ProductLine } from '../../lib/productBrands/productBrandService';

const MODES: SegmentedOption<ReportSelectionMode>[] = [
  { value: 'location', label: 'Por Local', icon: MapPin },
  { value: 'brand', label: 'Por Linha/Marca', icon: Tag },
  { value: 'manual', label: 'Seleção Manual', icon: ListChecks },
];

/** Página da lista manual — nunca joga milhares de linhas no DOM de uma vez. */
const MANUAL_PAGE_SIZE = 50;
/** Sugestões de endereço exibidas por vez no autocomplete nativo. */
const LOCATION_SUGGESTIONS = 60;

interface InventoryReportFiltersProps {
  mode: ReportSelectionMode;
  onModeChange: (mode: ReportSelectionMode) => void;

  products: ReportProduct[];
  locations: string[];

  locationFrom: string;
  locationTo: string;
  onLocationFromChange: (value: string) => void;
  onLocationToChange: (value: string) => void;

  brands: ProductBrand[];
  lines: ProductLine[];
  selectedBrandIds: string[];
  selectedLineIds: string[];
  onToggleBrand: (brandId: string) => void;
  onToggleLine: (lineId: string) => void;

  manualIds: Set<string>;
  onToggleManual: (productId: string) => void;
  onSelectManualMany: (productIds: string[]) => void;
  onClearManual: () => void;

  /** Quantos produtos e endereços a seleção atual já produz. */
  matchedProducts: number;
  matchedLocations: number;
}

function LocationField({
  label,
  value,
  onChange,
  listId,
  locations,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  listId: string;
  locations: string[];
}) {
  // Autocomplete nativo (datalist) sobre os endereços REAIS dos produtos —
  // sem dependência nova e sem cadastro paralelo de endereço.
  const suggestions = useMemo(() => {
    const term = value.trim().toUpperCase();
    const pool = term === '' ? locations : locations.filter(l => l.includes(term));
    return pool.slice(0, LOCATION_SUGGESTIONS);
  }, [locations, value]);

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-subtle">{label}</span>
      <Input
        value={value}
        list={listId}
        placeholder="P1-A002-A"
        onChange={event => onChange(event.target.value)}
        className="font-mono uppercase"
      />
      <datalist id={listId}>
        {suggestions.map(location => (
          <option key={location} value={location} />
        ))}
      </datalist>
    </label>
  );
}

export function InventoryReportFilters(props: InventoryReportFiltersProps) {
  const {
    mode, onModeChange, products, locations,
    locationFrom, locationTo, onLocationFromChange, onLocationToChange,
    brands, lines, selectedBrandIds, selectedLineIds, onToggleBrand, onToggleLine,
    manualIds, onToggleManual, onSelectManualMany, onClearManual,
    matchedProducts, matchedLocations,
  } = props;

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filteredManual = useMemo(
    () => products.filter(product => matchesProductSearch(product, search)),
    [products, search]
  );
  const pageCount = Math.max(1, Math.ceil(filteredManual.length / MANUAL_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleManual = filteredManual.slice(
    currentPage * MANUAL_PAGE_SIZE,
    currentPage * MANUAL_PAGE_SIZE + MANUAL_PAGE_SIZE
  );

  const brandsById = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands]);
  const activeBrands = useMemo(() => brands.filter(b => b.active), [brands]);
  const activeLines = useMemo(() => lines.filter(l => l.active), [lines]);

  return (
    <Panel>
      <PanelSection>
        <h2 className="text-base font-semibold text-fg">1. Seleção dos produtos</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Escolha o que vai na folha. Nada aqui altera o cadastro nem o estoque.
        </p>
        <div className="mt-4">
          <SegmentedControl
            label="Forma de seleção"
            options={MODES}
            value={mode}
            onChange={onModeChange}
          />
        </div>
      </PanelSection>

      {mode === 'location' && (
        <PanelSection>
          <div className="grid gap-4 sm:grid-cols-2 sm:max-w-xl">
            <LocationField
              label="Local inicial"
              value={locationFrom}
              onChange={onLocationFromChange}
              listId="ib-report-loc-from"
              locations={locations}
            />
            <LocationField
              label="Local final"
              value={locationTo}
              onChange={onLocationToChange}
              listId="ib-report-loc-to"
              locations={locations}
            />
          </div>
          <p className="mt-3 text-xs text-fg-subtle">
            A faixa é inclusiva: o local inicial e o final entram no relatório. A ordem
            segue o endereçamento (P1-A2 antes de P1-A10), não a ordem alfabética.
          </p>
        </PanelSection>
      )}

      {mode === 'brand' && (
        <PanelSection>
          {activeBrands.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Nenhuma marca cadastrada neste workspace. Cadastre em Produtos → Linhas e Marcas.
            </p>
          ) : (
            <div className="space-y-5">
              {activeBrands.map(brand => {
                const brandLines = activeLines.filter(line => line.brandId === brand.id);
                const brandSelected = selectedBrandIds.includes(brand.id);
                return (
                  <div key={brand.id}>
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={brandSelected}
                        onChange={() => onToggleBrand(brand.id)}
                        className="h-4 w-4 accent-accent"
                      />
                      <span className="text-sm font-semibold text-fg">{brand.name}</span>
                      <span className="text-xs text-fg-subtle">marca inteira</span>
                    </label>
                    {brandLines.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 pl-7">
                        {brandLines.map(line => (
                          <label key={line.id} className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedLineIds.includes(line.id)}
                              onChange={() => onToggleLine(line.id)}
                              className="h-4 w-4 accent-accent"
                            />
                            <span className="text-sm text-fg-muted">{line.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {selectedLineIds.length > 0 && (
            <p className="mt-4 text-xs text-fg-subtle">
              Linhas selecionadas:{' '}
              {selectedLineIds
                .map(id => {
                  const line = activeLines.find(l => l.id === id);
                  if (!line) return null;
                  const brand = brandsById.get(line.brandId);
                  return brand ? `${brand.name} / ${line.name}` : line.name;
                })
                .filter(Boolean)
                .join(', ')}
            </p>
          )}
        </PanelSection>
      )}

      {mode === 'manual' && (
        <PanelSection>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Input
                icon={<Search />}
                value={search}
                placeholder="Buscar por produto, SKU, EAN ou local"
                onChange={event => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSelectManualMany(filteredManual.map(p => p.id))}
              disabled={filteredManual.length === 0}
            >
              Selecionar todos{search.trim() ? ' os filtrados' : ''}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearManual} disabled={manualIds.size === 0}>
              Limpar seleção
            </Button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-10" />
                  <Th>Produto</Th>
                  <Th>SKU</Th>
                  <Th>EAN</Th>
                  <Th>Local</Th>
                </Tr>
              </Thead>
              <tbody>
                {visibleManual.map(product => (
                  <Tr key={product.id}>
                    <Td>
                      <input
                        type="checkbox"
                        checked={manualIds.has(product.id)}
                        onChange={() => onToggleManual(product.id)}
                        className="h-4 w-4 accent-accent"
                        aria-label={`Incluir ${product.name}`}
                      />
                    </Td>
                    <Td className="max-w-[26rem] truncate">{product.name}</Td>
                    <Td className="font-mono text-xs">{product.sku || '—'}</Td>
                    <Td className="font-mono text-xs">{product.ean || '-'}</Td>
                    <Td className="font-mono text-xs">{product.location || 'Sem endereço'}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {filteredManual.length === 0 && (
              <p className="py-6 text-center text-sm text-fg-muted">Nenhum produto encontrado.</p>
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-fg-subtle">
              <span>
                {filteredManual.length} produtos • página {currentPage + 1} de {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                >
                  Anterior
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={currentPage >= pageCount - 1}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </PanelSection>
      )}

      <PanelSection padding="sm">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge>{matchedProducts} produtos encontrados</Badge>
          <Badge>{matchedLocations} locais encontrados</Badge>
        </div>
      </PanelSection>
    </Panel>
  );
}
