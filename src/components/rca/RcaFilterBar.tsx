import { PROCESS_AREAS } from '../../lib/rcaAlgorithm';
import { Input, SegmentedControl, type SegmentedOption } from '../ui';
import type { RcaFilters } from '../../lib/rcaService';

interface RcaFilterBarProps {
  filters: RcaFilters;
  onChange: (filters: RcaFilters) => void;
  /** Categorias ativas da empresa (padrão + customizadas) — carregadas pela página, já
   *  que a taxonomia agora é configurável por workspace (rca_cause_categories). */
  causeOptions: { value: string; label: string }[];
}

const ALL = '__all__';

/** Filtros por período/processo/causa/SKU/operador/endereço/fornecedor/recorrência.
 *
 *  Antes cada pill carregava a própria borda (N caixinhas em fila) e cada input
 *  repetia as classes de campo à mão. Agora usa os primitivos compartilhados —
 *  SegmentedControl para causa/processo e Input para os campos — o que também traz os
 *  alvos de toque para 44px, relevante porque este filtro é usado em tablet no
 *  chão de operação. */
export function RcaFilterBar({ filters, onChange, causeOptions }: RcaFilterBarProps) {
  const set = (patch: Partial<RcaFilters>) => onChange({ ...filters, ...patch });

  const causeSelectOptions: SegmentedOption<string>[] = [
    { value: ALL, label: 'Todas as causas' },
    ...causeOptions,
  ];
  const processSelectOptions: SegmentedOption<string>[] = [
    { value: ALL, label: 'Todos os processos' },
    ...PROCESS_AREAS.map(p => ({ value: p.value, label: p.label })),
  ];

  return (
    <div className="space-y-3">
      <SegmentedControl
        label="Processo afetado"
        options={processSelectOptions}
        value={filters.processArea ?? ALL}
        onChange={value => set({ processArea: value === ALL ? undefined : (value as RcaFilters['processArea']) })}
      />

      <SegmentedControl
        label="Categoria de causa"
        options={causeSelectOptions}
        value={filters.causeCategory ?? ALL}
        onChange={value => set({ causeCategory: value === ALL ? undefined : (value as RcaFilters['causeCategory']) })}
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Input
          type="date"
          value={filters.from ?? ''}
          onChange={e => set({ from: e.target.value || undefined })}
          title="De"
          aria-label="Data inicial"
        />
        <Input
          type="date"
          value={filters.to ?? ''}
          onChange={e => set({ to: e.target.value || undefined })}
          title="Até"
          aria-label="Data final"
        />
        <Input
          placeholder="SKU"
          aria-label="SKU"
          value={filters.sku ?? ''}
          onChange={e => set({ sku: e.target.value || undefined })}
        />
        <Input
          placeholder="Operador"
          aria-label="Operador"
          value={filters.operatorName ?? ''}
          onChange={e => set({ operatorName: e.target.value || undefined })}
        />
        <Input
          placeholder="Endereço"
          aria-label="Endereço"
          value={filters.location ?? ''}
          onChange={e => set({ location: e.target.value || undefined })}
        />
        <Input
          placeholder="Fornecedor"
          aria-label="Fornecedor"
          value={filters.supplierName ?? ''}
          onChange={e => set({ supplierName: e.target.value || undefined })}
        />
        <label className="flex min-h-[44px] items-center gap-2 px-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={!!filters.recurringOnly}
            onChange={e => set({ recurringOnly: e.target.checked || undefined })}
          />
          Só recorrentes
        </label>
      </div>
    </div>
  );
}
